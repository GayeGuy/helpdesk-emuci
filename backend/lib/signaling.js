// Serveur de signalisation WebSocket : enregistrement des agents, authentification
// des techniciens, négociation WebRTC (offer/answer/ICE relayés), chat, audit.
import { WebSocketServer } from 'ws';
import { verifyToken } from './auth.js';
import { id } from './store.js';

const send = (ws, obj) => {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
};

export function attachSignaling(httpServer, store) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // État vivant (en mémoire), distinct de la persistance.
  const agentSockets = new Map(); // agentId -> ws
  const technicianSockets = new Set(); // ws de techniciens authentifiés
  const liveSessions = new Map(); // sessionId -> { agentId, technicianWs, agentWs, technician }

  async function broadcastAgents() {
    const agents = await store.listAgents();
    for (const ws of technicianSockets) send(ws, { type: 'agents-update', agents });
  }

  async function endSession(sessionId, reason) {
    const live = liveSessions.get(sessionId);
    if (!live) return;
    const session = await store.findSession(sessionId);
    if (session && !session.endedAt) {
      const endedAt = Date.now();
      await store.updateSession(sessionId, {
        status: 'ended',
        endedAt,
        durationMs: endedAt - (session.startedAt || endedAt),
        endReason: reason,
      });
      await store.audit({
        type: 'session-end',
        sessionId,
        agentId: live.agentId,
        technician: live.technician?.email,
        reason,
      });
    }
    send(live.technicianWs, { type: 'session-end', sessionId, reason });
    send(live.agentWs, { type: 'session-end', sessionId, reason });
    liveSessions.delete(sessionId);
  }

  wss.on('connection', (ws, req) => {
    ws.meta = { role: null };
    ws.ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      handle(ws, msg).catch((err) => console.error('WS handler error:', err));
    });
    ws.on('close', () => cleanup(ws).catch((err) => console.error('WS cleanup error:', err)));
  });

  async function handle(ws, msg) {
    switch (msg.type) {
      // --- Technicien s'authentifie ---
      case 'auth': {
        const decoded = verifyToken(msg.token);
        if (!decoded || decoded.type === 'refresh') {
          send(ws, { type: 'auth-error', error: 'Token invalide' });
          return;
        }
        ws.meta = { role: 'technician', user: decoded };
        technicianSockets.add(ws);
        send(ws, {
          type: 'auth-ok',
          user: { email: decoded.email, name: decoded.name, role: decoded.role },
        });
        send(ws, { type: 'agents-update', agents: await store.listAgents() });
        break;
      }

      // --- Agent s'enregistre ---
      case 'register-agent': {
        const agentId = msg.agentId || `AGENT-${id().slice(0, 8).toUpperCase()}`;
        const agent = await store.upsertAgent({
          agentId,
          name: msg.name || agentId,
          os: msg.os || 'inconnu',
          resolution: msg.resolution || '',
          ip: ws.ip,
          status: 'online',
          lastSeen: Date.now(),
        });
        ws.meta = { role: 'agent', agentId };
        agentSockets.set(agentId, ws);
        await store.audit({ type: 'agent-online', agentId, ip: ws.ip });
        send(ws, { type: 'registered', agentId, agent });
        await broadcastAgents();
        break;
      }

      // --- Technicien demande une session ---
      case 'session-request': {
        if (ws.meta.role !== 'technician') return;
        const agentWs = agentSockets.get(msg.agentId);
        const sessionId = id();
        const technician = ws.meta.user;
        await store.addSession({
          id: sessionId,
          agentId: msg.agentId,
          technicianId: technician.sub,
          technicianEmail: technician.email,
          reason: msg.reason || '',
          status: 'pending',
          startedAt: null,
          createdAt: Date.now(),
        });
        await store.audit({
          type: 'session-request',
          sessionId,
          agentId: msg.agentId,
          technician: technician.email,
          reason: msg.reason || '',
        });
        if (!agentWs) {
          await store.updateSession(sessionId, { status: 'unreachable' });
          send(ws, { type: 'session-error', error: 'Agent hors ligne', agentId: msg.agentId });
          return;
        }
        liveSessions.set(sessionId, { agentId: msg.agentId, technicianWs: ws, agentWs, technician });
        send(agentWs, {
          type: 'session-request',
          sessionId,
          technician: { email: technician.email, name: technician.name },
          reason: msg.reason || '',
          ip: ws.ip,
        });
        send(ws, { type: 'session-pending', sessionId, agentId: msg.agentId });
        break;
      }

      // --- Agent accepte ---
      case 'session-accept': {
        if (ws.meta.role !== 'agent') return;
        const live = liveSessions.get(msg.sessionId);
        if (!live) return;
        await store.updateSession(msg.sessionId, { status: 'active', startedAt: Date.now() });
        await store.audit({ type: 'session-accept', sessionId: msg.sessionId, agentId: live.agentId });
        send(live.technicianWs, { type: 'session-accept', sessionId: msg.sessionId, agentId: live.agentId });
        send(live.agentWs, { type: 'session-start', sessionId: msg.sessionId });
        break;
      }

      // --- Agent refuse ---
      case 'session-reject': {
        if (ws.meta.role !== 'agent') return;
        const live = liveSessions.get(msg.sessionId);
        await store.updateSession(msg.sessionId, { status: 'rejected', endedAt: Date.now() });
        await store.audit({ type: 'session-reject', sessionId: msg.sessionId, agentId: ws.meta.agentId });
        if (live) {
          send(live.technicianWs, { type: 'session-reject', sessionId: msg.sessionId });
          liveSessions.delete(msg.sessionId);
        }
        break;
      }

      // --- Relais WebRTC (SDP / ICE) ---
      case 'signal': {
        const live = liveSessions.get(msg.sessionId);
        if (!live) return;
        const target = ws === live.agentWs ? live.technicianWs : live.agentWs;
        send(target, { type: 'signal', sessionId: msg.sessionId, payload: msg.payload });
        break;
      }

      // --- Chat temps réel ---
      case 'chat': {
        const live = liveSessions.get(msg.sessionId);
        if (!live) return;
        const from = ws.meta.role;
        const target = ws === live.agentWs ? live.technicianWs : live.agentWs;
        send(target, { type: 'chat', sessionId: msg.sessionId, from, text: msg.text, ts: Date.now() });
        send(ws, { type: 'chat-ack', sessionId: msg.sessionId, text: msg.text, ts: Date.now() });
        await store.audit({
          type: 'chat',
          sessionId: msg.sessionId,
          agentId: live.agentId,
          from,
          length: String(msg.text || '').length,
        });
        break;
      }

      // --- Fin de session (par l'une ou l'autre partie) ---
      case 'session-end': {
        await endSession(msg.sessionId, ws.meta.role === 'agent' ? 'agent' : 'technician');
        break;
      }

      default:
        break;
    }
  }

  async function cleanup(ws) {
    if (ws.meta?.role === 'technician') {
      technicianSockets.delete(ws);
      for (const [sid, live] of liveSessions) {
        if (live.technicianWs === ws) await endSession(sid, 'technician-disconnect');
      }
    }
    if (ws.meta?.role === 'agent') {
      const { agentId } = ws.meta;
      agentSockets.delete(agentId);
      await store.setAgentStatus(agentId, { status: 'offline', lastSeen: Date.now() });
      await store.audit({ type: 'agent-offline', agentId });
      for (const [sid, live] of liveSessions) {
        if (live.agentWs === ws) await endSession(sid, 'agent-disconnect');
      }
      await broadcastAgents();
    }
  }

  return wss;
}
