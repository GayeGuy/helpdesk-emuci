import { useEffect, useState } from 'react';
import { api } from '../api.js';

const LABEL = {
  login: '🔓 Connexion technicien',
  'login-failed': '⛔ Échec de connexion',
  'agent-online': '🟢 Agent en ligne',
  'agent-offline': '⚪ Agent hors ligne',
  'session-request': '📨 Demande de session',
  'session-accept': '✅ Session acceptée',
  'session-reject': '🚫 Session refusée',
  'session-end': '⏹ Fin de session',
  chat: '💬 Message',
};

export default function AuditPanel() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api.audit().then(setRows).catch(() => setRows([]));
  }, []);

  if (!rows) return <div className="muted">Chargement…</div>;
  if (!rows.length) return <div className="empty">Aucun événement d'audit.</div>;

  return (
    <table className="table">
      <thead>
        <tr>
          <th>Horodatage</th>
          <th>Événement</th>
          <th>Agent</th>
          <th>Technicien</th>
          <th>Détail</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => (
          <tr key={e.id}>
            <td>{new Date(e.ts).toLocaleString('fr-FR')}</td>
            <td>{LABEL[e.type] || e.type}</td>
            <td>{e.agentId || '—'}</td>
            <td>{e.technician || e.email || '—'}</td>
            <td className="muted small">{e.reason || (e.length != null ? `${e.length} car.` : '') || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
