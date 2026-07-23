import { useEffect, useRef, useState } from 'react';
import Chat from '../components/Chat.jsx';

const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// Vue technicien : reçoit le flux d'écran de l'agent (répondeur WebRTC) + chat.
export default function Session({ session, agent, user, send, bus, onClose }) {
  const videoRef = useRef(null);
  const pcRef = useRef(null);
  const [elapsed, setElapsed] = useState(0);
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    if (session.status !== 'active') return undefined;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);

    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;
    pc.ontrack = (e) => {
      if (videoRef.current) videoRef.current.srcObject = e.streams[0];
      setStreaming(true);
    };
    pc.onicecandidate = (e) => {
      if (e.candidate)
        send({ type: 'signal', sessionId: session.id, payload: { kind: 'ice', data: e.candidate } });
    };

    bus.on('signal', async ({ payload }) => {
      if (payload.kind === 'offer') {
        await pc.setRemoteDescription(payload.data);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send({ type: 'signal', sessionId: session.id, payload: { kind: 'answer', data: answer } });
      } else if (payload.kind === 'ice') {
        try {
          await pc.addIceCandidate(payload.data);
        } catch {}
      }
    });

    return () => {
      clearInterval(timer);
      bus.off('signal');
      pc.close();
    };
  }, [session.status]);

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <div className="session">
      <header className="session-bar">
        <button className="btn ghost" onClick={onClose}>
          ← Retour
        </button>
        <div className="session-title">
          <strong>{agent.name || agent.agentId}</strong>
          <span className="muted"> · {agent.os || ''} · {user.name}</span>
        </div>
        <div className="session-timer">
          {session.status === 'active' ? `⏱ ${mmss}` : 'En attente…'}
        </div>
        <button className="btn danger" onClick={onClose}>
          ⏹ Terminer
        </button>
      </header>

      <div className="session-body">
        <div className="viewport">
          {session.status !== 'active' ? (
            <div className="waiting">
              <div className="spinner" />
              <p>Demande envoyée à {agent.name || agent.agentId}…</p>
              <p className="muted">En attente de l'acceptation par l'utilisateur.</p>
            </div>
          ) : (
            <>
              {!streaming && (
                <div className="waiting overlay">
                  <div className="spinner" />
                  <p>Négociation du flux d'écran…</p>
                </div>
              )}
              <video ref={videoRef} autoPlay playsInline muted />
            </>
          )}
        </div>

        <Chat
          disabled={session.status !== 'active'}
          me="technician"
          bus={bus}
          onSend={(text) => send({ type: 'chat', sessionId: session.id, text })}
        />
      </div>
    </div>
  );
}
