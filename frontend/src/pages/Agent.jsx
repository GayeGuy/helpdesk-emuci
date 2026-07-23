import { useEffect, useRef, useState } from 'react';
import { WS_URL } from '../api.js';
import Chat from '../components/Chat.jsx';

const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

function detectOS() {
  const ua = navigator.userAgent;
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac')) return 'macOS';
  if (ua.includes('Linux')) return 'Linux';
  return 'inconnu';
}

function getAgentId() {
  let id = localStorage.getItem('hd_agent_id');
  if (!id) {
    id = 'AGENT-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    localStorage.setItem('hd_agent_id', id);
  }
  return id;
}

// Poste contrôlé : s'enregistre, reçoit les demandes, partage l'écran après consentement.
export default function Agent() {
  const [agentId] = useState(getAgentId);
  const [connected, setConnected] = useState(false);
  const [request, setRequest] = useState(null); // demande en attente
  const [status, setStatus] = useState('idle'); // idle | sharing
  const [name] = useState(() => localStorage.getItem('hd_agent_name') || `Poste ${detectOS()}`);

  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const sessionRef = useRef(null);
  const previewRef = useRef(null);
  const bus = useRef({ handlers: {}, on(t, fn) { this.handlers[t] = fn; }, off(t) { delete this.handlers[t]; }, emit(t, m) { this.handlers[t]?.(m); } });

  const send = (obj) => wsRef.current?.readyState === 1 && wsRef.current.send(JSON.stringify(obj));

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      ws.send(
        JSON.stringify({
          type: 'register-agent',
          agentId,
          name,
          os: `${detectOS()} (navigateur)`,
          resolution: `${screen.width}x${screen.height}`,
        }),
      );
    };
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      switch (msg.type) {
        case 'session-request':
          setRequest(msg);
          break;
        case 'session-start':
          startSharing(msg.sessionId);
          break;
        case 'signal':
          handleSignal(msg.payload);
          break;
        case 'chat':
        case 'chat-ack':
          bus.current.emit(msg.type, msg);
          break;
        case 'session-end':
          stopSharing();
          break;
        default:
          break;
      }
    };
    return () => ws.close();
  }, []);

  function accept() {
    sessionRef.current = request.sessionId;
    send({ type: 'session-accept', sessionId: request.sessionId });
    setRequest(null);
  }

  function reject() {
    send({ type: 'session-reject', sessionId: request.sessionId });
    setRequest(null);
  }

  async function startSharing(sessionId) {
    sessionRef.current = sessionId;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (previewRef.current) previewRef.current.srcObject = stream;
      stream.getVideoTracks()[0].addEventListener('ended', () => endSession());

      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      pc.onicecandidate = (e) => {
        if (e.candidate)
          send({ type: 'signal', sessionId, payload: { kind: 'ice', data: e.candidate } });
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ type: 'signal', sessionId, payload: { kind: 'offer', data: offer } });
      setStatus('sharing');
    } catch {
      // Refus du partage d'écran par l'utilisateur → on termine la session.
      endSession();
    }
  }

  async function handleSignal(payload) {
    const pc = pcRef.current;
    if (!pc) return;
    if (payload.kind === 'answer') {
      await pc.setRemoteDescription(payload.data);
    } else if (payload.kind === 'ice') {
      try {
        await pc.addIceCandidate(payload.data);
      } catch {}
    }
  }

  function stopSharing() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    streamRef.current = null;
    pcRef.current = null;
    sessionRef.current = null;
    setStatus('idle');
  }

  function endSession() {
    if (sessionRef.current) send({ type: 'session-end', sessionId: sessionRef.current });
    stopSharing();
  }

  return (
    <div className="center agent-page">
      <div className="card agent-panel">
        <h1>
          HelpDesk <span className="accent">EMUCI</span> — Agent
        </h1>

        <div className="agent-id-row">
          <div>
            <div className="muted small">Identifiant de ce poste</div>
            <div className="agent-id">{agentId}</div>
          </div>
          <span className={`status ${connected ? 'online' : 'offline'}`}>
            {connected ? '🟢 Connecté au serveur' : '🔴 Déconnecté'}
          </span>
        </div>

        <ul className="agent-info">
          <li>Nom : <strong>{name}</strong></li>
          <li>OS : {detectOS()}</li>
          <li>Résolution : {screen.width}×{screen.height}</li>
        </ul>

        {status === 'sharing' ? (
          <div className="sharing">
            <div className="banner ok">🔴 Écran partagé — une session est en cours</div>
            <video ref={previewRef} className="preview" autoPlay playsInline muted />
            <button className="btn danger" onClick={endSession}>
              ⏹ Arrêter le partage
            </button>
            <Chat
              me="agent"
              bus={bus.current}
              disabled={false}
              onSend={(text) => send({ type: 'chat', sessionId: sessionRef.current, text })}
            />
          </div>
        ) : (
          <p className="muted">
            En attente. Ce poste est visible par les techniciens. Une demande de connexion
            s'affichera ici et nécessitera votre accord.
          </p>
        )}
      </div>

      {request && (
        <div className="modal-backdrop">
          <div className="card modal">
            <h2>⚠️ Demande d'accès</h2>
            <p>
              <strong>{request.technician?.name || request.technician?.email}</strong> souhaite
              prendre le contrôle de votre écran.
            </p>
            <p className="muted">Raison : {request.reason || '—'}</p>
            <p className="muted small">IP technicien : {request.ip || '—'}</p>
            <div className="modal-actions">
              <button className="btn danger" onClick={reject}>
                Refuser
              </button>
              <button className="btn primary" onClick={accept}>
                Accepter
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
