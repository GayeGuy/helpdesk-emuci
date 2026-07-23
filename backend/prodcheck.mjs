// Smoke test de bout en bout contre une instance déployée (chemin PostgreSQL réel).
// Usage : npm run smoke   —   ou   TARGET=https://mon-service.onrender.com npm run smoke
// Vérifie : auth, upsert agent, cycle de session complet, chat, relais WebRTC, audit.
import { WebSocket } from 'ws';

const BASE = process.env.TARGET || 'https://helpdesk-emuci.onrender.com';
const WSURL = BASE.replace('https://', 'wss://') + '/ws';
const open = (ws) => new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
const once = (ws, type, ms = 15000) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout ' + type)), ms);
    ws.on('message', function l(d) {
      const m = JSON.parse(d);
      if (m.type === type) { clearTimeout(t); ws.off('message', l); res(m); }
    });
  });
const api = async (path, token) =>
  (await fetch(BASE + path, token ? { headers: { Authorization: `Bearer ${token}` } } : {})).json();

const ok = (label, cond, extra = '') =>
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`);

// 1. Login admin (lecture users + insert audit)
const login = await (
  await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@emuci.local', password: 'admin123' }),
  })
).json();
ok('login admin (SELECT users + INSERT audit)', !!login.accessToken, login.user?.role);
const token = login.accessToken;

// 2. Agent s'enregistre (UPSERT agents)
const AID = 'AGENT-PROD-' + Math.random().toString(36).slice(2, 6).toUpperCase();
const agent = new WebSocket(WSURL);
await open(agent);
agent.send(JSON.stringify({ type: 'register-agent', agentId: AID, name: 'Test prod', os: 'Windows 11', resolution: '1920x1080' }));
await once(agent, 'registered');
const agents = await api('/api/agents', token);
ok('upsertAgent + listAgents', agents.some((a) => a.agentId === AID && a.status === 'online'), `${agents.length} agent(s)`);

// 3. Technicien + cycle de session complet
const tech = new WebSocket(WSURL);
await open(tech);
tech.send(JSON.stringify({ type: 'auth', token }));
await once(tech, 'auth-ok');

const reqP = once(agent, 'session-request');
tech.send(JSON.stringify({ type: 'session-request', agentId: AID, reason: 'Verif prod' }));
const { sessionId } = await reqP;
ok('addSession (INSERT sessions)', !!sessionId);

const accP = once(tech, 'session-accept');
agent.send(JSON.stringify({ type: 'session-accept', sessionId }));
await accP;
ok('updateSession active (UPDATE sessions)', true);

const chatP = once(tech, 'chat');
agent.send(JSON.stringify({ type: 'chat', sessionId, text: 'ping prod' }));
ok('chat relayé + audit', (await chatP).text === 'ping prod');

const sigP = once(tech, 'signal');
agent.send(JSON.stringify({ type: 'signal', sessionId, payload: { kind: 'offer', data: { sdp: 'X' } } }));
ok('relais WebRTC (offer)', (await sigP).payload.kind === 'offer');

const endP = once(agent, 'session-end');
tech.send(JSON.stringify({ type: 'session-end', sessionId }));
await endP;

// 4. Relectures (findSession, listSessions, listAudit)
const sessions = await api('/api/sessions', token);
const s = sessions.find((x) => x.id === sessionId);
ok('listSessions + durée calculée', s?.status === 'ended' && s.durationMs >= 0, `status=${s?.status} duree=${s?.durationMs}ms`);

const audit = await api('/api/audit', token);
const types = audit.map((a) => a.type);
ok('listAudit (JSONB)', ['session-request', 'session-accept', 'session-end', 'chat'].every((t) => types.includes(t)), `${audit.length} événements`);

agent.close();
tech.close();
setTimeout(() => process.exit(0), 1500);
