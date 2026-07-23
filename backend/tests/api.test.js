// Tests d'intégration REST + signalisation WebSocket.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

process.env.PORT = '3199';
process.env.JWT_SECRET = 'test-secret';
process.env.CORS_ORIGIN = 'http://localhost:5173';

const { app, server, store } = await import('../server.js');
const { hashPassword } = await import('../lib/auth.js');
const { id } = await import('../lib/store.js');

const BASE = 'http://localhost:3199';
const WSURL = 'ws://localhost:3199/ws';

async function seedUsers() {
  await store.reset({
    users: [
      { id: id(), email: 'admin@test.local', name: 'Admin', role: 'admin', passwordHash: hashPassword('adminpw') },
      { id: id(), email: 'tech@test.local', name: 'Tech', role: 'technician', passwordHash: hashPassword('techpw') },
    ],
  });
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return res;
}

function wsOnce(ws, type, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout en attendant ${type}`)), timeout);
    ws.on('message', function listener(data) {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off('message', listener);
        resolve(msg);
      }
    });
  });
}

const open = (ws) => new Promise((r) => ws.on('open', r));

before(async () => {
  await seedUsers();
  await new Promise((r) => server.listen(3199, r));
});

after(async () => {
  await new Promise((r) => server.close(r));
});

test('health répond ok', async () => {
  const res = await fetch(`${BASE}/api/health`);
  const body = await res.json();
  assert.equal(body.ok, true);
});

test('login échoue avec mauvais mot de passe', async () => {
  const res = await login('admin@test.local', 'wrong');
  assert.equal(res.status, 401);
});

test('login réussit et renvoie un JWT', async () => {
  const res = await login('tech@test.local', 'techpw');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.accessToken);
  assert.equal(body.user.role, 'technician');
});

test('GET /api/agents exige un token', async () => {
  const res = await fetch(`${BASE}/api/agents`);
  assert.equal(res.status, 401);
});

test('GET /api/audit interdit au technicien (rôle admin requis)', async () => {
  const login1 = await (await login('tech@test.local', 'techpw')).json();
  const res = await fetch(`${BASE}/api/audit`, {
    headers: { Authorization: `Bearer ${login1.accessToken}` },
  });
  assert.equal(res.status, 403);
});

test('un agent enregistré apparaît en ligne dans /api/agents', async () => {
  const agent = new WebSocket(WSURL);
  await open(agent);
  agent.send(JSON.stringify({ type: 'register-agent', agentId: 'AGENT-TEST1', name: 'PC-Test', os: 'Windows 11' }));
  await wsOnce(agent, 'registered');

  const { accessToken } = await (await login('tech@test.local', 'techpw')).json();
  const res = await fetch(`${BASE}/api/agents`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const agents = await res.json();
  const found = agents.find((a) => a.agentId === 'AGENT-TEST1');
  assert.ok(found);
  assert.equal(found.status, 'online');
  agent.close();
});

test('flux complet : demande → acceptation → chat → fin, avec audit', async () => {
  await seedUsers();
  const { accessToken } = await (await login('tech@test.local', 'techpw')).json();

  const agent = new WebSocket(WSURL);
  await open(agent);
  agent.send(JSON.stringify({ type: 'register-agent', agentId: 'AGENT-FLOW', name: 'PC-Flow', os: 'Linux' }));
  await wsOnce(agent, 'registered');

  const tech = new WebSocket(WSURL);
  await open(tech);
  tech.send(JSON.stringify({ type: 'auth', token: accessToken }));
  await wsOnce(tech, 'auth-ok');

  // Le technicien demande une session
  const reqOnAgent = wsOnce(agent, 'session-request');
  tech.send(JSON.stringify({ type: 'session-request', agentId: 'AGENT-FLOW', reason: 'Dépannage' }));
  const reqMsg = await reqOnAgent;
  const sessionId = reqMsg.sessionId;
  assert.ok(sessionId);

  // L'agent accepte
  const acceptOnTech = wsOnce(tech, 'session-accept');
  agent.send(JSON.stringify({ type: 'session-accept', sessionId }));
  await acceptOnTech;

  // Chat de l'agent vers le technicien
  const chatOnTech = wsOnce(tech, 'chat');
  agent.send(JSON.stringify({ type: 'chat', sessionId, text: 'Bonjour' }));
  const chat = await chatOnTech;
  assert.equal(chat.text, 'Bonjour');

  // Fin de session
  const endOnAgent = wsOnce(agent, 'session-end');
  tech.send(JSON.stringify({ type: 'session-end', sessionId }));
  await endOnAgent;

  const session = (await store.listSessions()).find((s) => s.id === sessionId);
  assert.equal(session.status, 'ended');
  assert.ok(session.durationMs >= 0);

  const auditTypes = (await store.listAudit()).map((a) => a.type);
  assert.ok(auditTypes.includes('session-request'));
  assert.ok(auditTypes.includes('session-accept'));
  assert.ok(auditTypes.includes('session-end'));

  agent.close();
  tech.close();
});

test('un refus notifie le technicien et journalise session-reject', async () => {
  await seedUsers();
  const { accessToken } = await (await login('tech@test.local', 'techpw')).json();

  const agent = new WebSocket(WSURL);
  await open(agent);
  agent.send(JSON.stringify({ type: 'register-agent', agentId: 'AGENT-REJ', name: 'PC-Rej', os: 'macOS' }));
  await wsOnce(agent, 'registered');

  const tech = new WebSocket(WSURL);
  await open(tech);
  tech.send(JSON.stringify({ type: 'auth', token: accessToken }));
  await wsOnce(tech, 'auth-ok');

  const reqOnAgent = wsOnce(agent, 'session-request');
  tech.send(JSON.stringify({ type: 'session-request', agentId: 'AGENT-REJ', reason: 'Test' }));
  const { sessionId } = await reqOnAgent;

  const rejectOnTech = wsOnce(tech, 'session-reject');
  agent.send(JSON.stringify({ type: 'session-reject', sessionId }));
  await rejectOnTech;

  assert.ok((await store.listAudit()).some((a) => a.type === 'session-reject'));
  agent.close();
  tech.close();
});
