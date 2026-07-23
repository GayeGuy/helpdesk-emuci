import { useEffect, useRef, useState } from 'react';

// Chat temps réel. `me` = rôle local ('technician' | 'agent').
export default function Chat({ bus, me, onSend, disabled }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    bus.on('chat', (m) => setMessages((prev) => [...prev, { from: m.from, text: m.text, ts: m.ts }]));
    bus.on('chat-ack', (m) => setMessages((prev) => [...prev, { from: me, text: m.text, ts: m.ts }]));
    return () => {
      bus.off('chat');
      bus.off('chat-ack');
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function submit(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  }

  return (
    <aside className="chat">
      <div className="chat-head">💬 Chat</div>
      <div className="chat-log">
        {messages.length === 0 && <div className="muted small">Aucun message.</div>}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.from === me ? 'mine' : 'theirs'}`}>
            <span className="msg-text">{m.text}</span>
            <span className="msg-time">
              {new Date(m.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className="chat-input" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={disabled ? 'Session inactive' : 'Message…'}
          disabled={disabled}
        />
        <button className="btn primary" disabled={disabled}>
          Envoyer
        </button>
      </form>
    </aside>
  );
}
