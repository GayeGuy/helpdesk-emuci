import { useEffect, useMemo, useRef, useState } from 'react';
import { api, WS_URL } from '../api.js';
import Session from './Session.jsx';
import AuditPanel from '../components/AuditPanel.jsx';

const OS_ICON = { Windows: '🪟', macOS: '🍎', Linux: '🐧' };
const osIcon = (os = '') =>
  Object.entries(OS_ICON).find(([k]) => os.includes(k))?.[1] || '💻';

export default function Dashboard({ user, onLogout }) {
  const [connected, setConnected] = useState(false);
  const [agents, setAgents] = useState([]);
  const [view, setView] = useState('agents');
  const [session, setSession] = useState(null);
  const wsRef = useRef(null);
  // Bus de messages pour la vue Session active (WebRTC + chat).
  const bus = useRef({ handlers: {}, on(t, fn) { this.handlers[t] = fn; }, off(t) { delete this.handlers[t]; }, emit(t, m) { this.handlers[t]?.(m); } });

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: api.tokens.access }));
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      switch (msg.type) {
        case 'auth-ok':
          setConnected(true);
          break;
        case 'agents-update':
          setAgents(msg.agents);
          break;
        case 'session-pending':
          setSession({ id: msg.sessionId, agentId: msg.agentId, status: 'pending' });
          break;
        case 'session-accept':
          setSession((s) => (s ? { ...s, status: 'active' } : s));
          break;
        case 'session-reject':
          setSession(null);
          alert("L'agent a refusé la demande de connexion.");
          break;
        case 'session-error':
          setSession(null);
          alert(msg.error);
          break;
        case 'signal':
        case 'frame':
        case 'chat':
        case 'chat-ack':
        case 'session-end':
          bus.current.emit(msg.type, msg);
          if (msg.type === 'session-end') setSession(null);
          break;
        default:
          break;
      }
    };
    return () => ws.close();
  }, []);

  const send = (obj) => wsRef.current?.readyState === 1 && wsRef.current.send(JSON.stringify(obj));

  function requestSession(agent) {
    const reason = prompt(`Raison de la connexion à ${agent.name} ?`, 'Dépannage');
    if (reason === null) return;
    send({ type: 'session-request', agentId: agent.agentId, reason });
  }

  const online = useMemo(() => agents.filter((a) => a.status === 'online'), [agents]);

  if (session) {
    const agent = agents.find((a) => a.agentId === session.agentId) || { agentId: session.agentId };
    return (
      <Session
        session={session}
        agent={agent}
        user={user}
        send={send}
        bus={bus.current}
        onClose={() => {
          send({ type: 'session-end', sessionId: session.id });
          setSession(null);
        }}
      />
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          HelpDesk <span className="accent">EMUCI</span>
        </div>
        <nav className="tabs">
          <button className={view === 'agents' ? 'on' : ''} onClick={() => setView('agents')}>
            Agents <span className="badge">{online.length}/{agents.length}</span>
          </button>
          <button className={view === 'sessions' ? 'on' : ''} onClick={() => setView('sessions')}>
            Historique
          </button>
          {user.role === 'admin' && (
            <button className={view === 'audit' ? 'on' : ''} onClick={() => setView('audit')}>
              Audit
            </button>
          )}
        </nav>
        <div className="userbox">
          <span className={`dot ${connected ? 'ok' : 'off'}`} />
          {user.name} · {user.role}
          <button className="btn ghost" onClick={onLogout}>
            Déconnexion
          </button>
        </div>
      </header>

      <main className="content">
        {view === 'agents' && (
          <AgentsGrid agents={agents} onConnect={requestSession} osIcon={osIcon} />
        )}
        {view === 'sessions' && <SessionsHistory />}
        {view === 'audit' && <AuditPanel />}
      </main>
    </div>
  );
}

function AgentsGrid({ agents, onConnect, osIcon }) {
  if (!agents.length)
    return (
      <div className="empty">
        Aucun agent enregistré. Ouvrez la page agent (<code>#/agent</code>) sur un poste à assister.
      </div>
    );
  return (
    <div className="grid">
      {agents.map((a) => (
        <div className="card agent" key={a.agentId}>
          <div className="agent-head">
            <span className="os">{osIcon(a.os)}</span>
            <div>
              <div className="agent-name">{a.name}</div>
              <div className="muted small">{a.agentId}</div>
            </div>
            <span className={`status ${a.status}`}>{a.status === 'online' ? '🟢 En ligne' : '⚪ Hors ligne'}</span>
          </div>
          <div className="agent-meta">
            <span>{a.os}</span>
            {a.resolution && <span>{a.resolution}</span>}
            {a.ip && <span>{a.ip}</span>}
            <span className={a.native ? 'tag-native' : ''}>
              {a.native ? '🖥️ natif · contrôle' : '🌐 navigateur · vue'}
            </span>
          </div>
          <button
            className="btn primary"
            disabled={a.status !== 'online'}
            onClick={() => onConnect(a)}
          >
            Se connecter
          </button>
        </div>
      ))}
    </div>
  );
}

function SessionsHistory() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api.sessions().then(setRows).catch(() => setRows([]));
  }, []);
  if (!rows) return <div className="muted">Chargement…</div>;
  if (!rows.length) return <div className="empty">Aucune session enregistrée.</div>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Agent</th>
          <th>Technicien</th>
          <th>Raison</th>
          <th>Statut</th>
          <th>Durée</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.id}>
            <td>{new Date(s.createdAt).toLocaleString('fr-FR')}</td>
            <td>{s.agentId}</td>
            <td>{s.technicianEmail}</td>
            <td>{s.reason || '—'}</td>
            <td>
              <span className={`pill ${s.status}`}>{s.status}</span>
            </td>
            <td>{s.durationMs ? `${Math.round(s.durationMs / 1000)}s` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
