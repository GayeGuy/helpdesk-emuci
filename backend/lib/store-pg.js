// Backend de stockage PostgreSQL (Neon en production). Interface asynchrone commune.
import crypto from 'node:crypto';
import pg from 'pg';

const uuid = () => crypto.randomUUID();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at BIGINT
);
CREATE TABLE IF NOT EXISTS agents (
  agent_id TEXT PRIMARY KEY,
  name TEXT,
  os TEXT,
  resolution TEXT,
  ip TEXT,
  status TEXT,
  last_seen BIGINT,
  native BOOLEAN DEFAULT false
);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS native BOOLEAN DEFAULT false;
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  agent_id TEXT,
  technician_id UUID,
  technician_email TEXT,
  reason TEXT,
  status TEXT,
  started_at BIGINT,
  ended_at BIGINT,
  duration_ms BIGINT,
  end_reason TEXT,
  created_at BIGINT
);
CREATE TABLE IF NOT EXISTS audit (
  id UUID PRIMARY KEY,
  ts BIGINT,
  type TEXT,
  payload JSONB
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit (ts DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions (created_at DESC);
`;

const agentRow = (r) =>
  r && {
    agentId: r.agent_id,
    name: r.name,
    os: r.os,
    resolution: r.resolution,
    ip: r.ip,
    status: r.status,
    lastSeen: r.last_seen != null ? Number(r.last_seen) : null,
    native: !!r.native,
  };

const sessionRow = (r) =>
  r && {
    id: r.id,
    agentId: r.agent_id,
    technicianId: r.technician_id,
    technicianEmail: r.technician_email,
    reason: r.reason,
    status: r.status,
    startedAt: r.started_at != null ? Number(r.started_at) : null,
    endedAt: r.ended_at != null ? Number(r.ended_at) : null,
    durationMs: r.duration_ms != null ? Number(r.duration_ms) : null,
    endReason: r.end_reason,
    createdAt: r.created_at != null ? Number(r.created_at) : null,
  };

const SESSION_COLS = {
  status: 'status',
  startedAt: 'started_at',
  endedAt: 'ended_at',
  durationMs: 'duration_ms',
  endReason: 'end_reason',
};

export function createPgStore(connectionString) {
  const pool = new pg.Pool({
    connectionString,
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  const q = (text, params) => pool.query(text, params);

  return {
    async init() {
      await pool.query(SCHEMA);
    },
    async reset() {
      await pool.query('TRUNCATE users, agents, sessions, audit');
    },

    async findUserByEmail(email) {
      const { rows } = await q('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
      return rows[0] ? mapUser(rows[0]) : null;
    },
    async findUserById(id) {
      const { rows } = await q('SELECT * FROM users WHERE id = $1', [id]);
      return rows[0] ? mapUser(rows[0]) : null;
    },
    async addUser(user) {
      await q(
        'INSERT INTO users (id, email, name, role, password_hash, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [user.id, user.email, user.name, user.role, user.passwordHash, user.createdAt],
      );
      return user;
    },

    async listAgents() {
      const { rows } = await q('SELECT * FROM agents ORDER BY name');
      return rows.map(agentRow);
    },
    async findAgentById(agentId) {
      const { rows } = await q('SELECT * FROM agents WHERE agent_id = $1', [agentId]);
      return agentRow(rows[0]);
    },
    async upsertAgent(a) {
      await q(
        `INSERT INTO agents (agent_id, name, os, resolution, ip, status, last_seen, native)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (agent_id) DO UPDATE SET
           name=EXCLUDED.name, os=EXCLUDED.os, resolution=EXCLUDED.resolution,
           ip=EXCLUDED.ip, status=EXCLUDED.status, last_seen=EXCLUDED.last_seen,
           native=EXCLUDED.native`,
        [a.agentId, a.name, a.os, a.resolution, a.ip, a.status, a.lastSeen, !!a.native],
      );
      return this.findAgentById(a.agentId);
    },
    async setAgentStatus(agentId, patch) {
      const { rows } = await q(
        'UPDATE agents SET status = COALESCE($2, status), last_seen = COALESCE($3, last_seen) WHERE agent_id = $1 RETURNING *',
        [agentId, patch.status ?? null, patch.lastSeen ?? null],
      );
      return agentRow(rows[0]);
    },

    async listSessions() {
      const { rows } = await q('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 500');
      return rows.map(sessionRow);
    },
    async findSession(id) {
      const { rows } = await q('SELECT * FROM sessions WHERE id = $1', [id]);
      return sessionRow(rows[0]);
    },
    async addSession(s) {
      await q(
        `INSERT INTO sessions (id, agent_id, technician_id, technician_email, reason, status, started_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [s.id, s.agentId, s.technicianId, s.technicianEmail, s.reason, s.status, s.startedAt, s.createdAt],
      );
      return s;
    },
    async updateSession(id, patch) {
      const sets = [];
      const vals = [id];
      for (const [k, col] of Object.entries(SESSION_COLS)) {
        if (k in patch) {
          vals.push(patch[k]);
          sets.push(`${col} = $${vals.length}`);
        }
      }
      if (!sets.length) return this.findSession(id);
      const { rows } = await q(
        `UPDATE sessions SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
        vals,
      );
      return sessionRow(rows[0]);
    },

    async listAudit(limit = 200) {
      const { rows } = await q('SELECT * FROM audit ORDER BY ts DESC LIMIT $1', [limit]);
      return rows.map((r) => ({ id: r.id, ts: Number(r.ts), ...r.payload }));
    },
    async audit(event) {
      const entry = { id: uuid(), ts: Date.now(), ...event };
      const { id, ts, ...payload } = entry;
      await q('INSERT INTO audit (id, ts, type, payload) VALUES ($1,$2,$3,$4)', [
        id,
        ts,
        event.type,
        payload,
      ]);
      return entry;
    },
  };
}

const mapUser = (r) => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: r.role,
  passwordHash: r.password_hash,
  createdAt: r.created_at != null ? Number(r.created_at) : null,
});
