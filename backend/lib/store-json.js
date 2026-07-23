// Backend de stockage JSON atomique (local / tests). Interface asynchrone commune.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const EMPTY = { users: [], agents: [], sessions: [], audit: [] };

const uuid = () => crypto.randomUUID();

export function createJsonStore() {
  let db = structuredClone(EMPTY);

  function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  function persist() {
    ensureDir();
    const tmp = `${DB_PATH}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_PATH);
  }

  return {
    async init() {
      ensureDir();
      if (fs.existsSync(DB_PATH)) {
        try {
          db = { ...structuredClone(EMPTY), ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };
        } catch {
          db = structuredClone(EMPTY);
        }
      }
    },
    async reset(data = EMPTY) {
      db = structuredClone({ ...EMPTY, ...data });
      persist();
    },

    async findUserByEmail(email) {
      return db.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase()) || null;
    },
    async findUserById(uid) {
      return db.users.find((u) => u.id === uid) || null;
    },
    async addUser(user) {
      db.users.push(user);
      persist();
      return user;
    },

    async listAgents() {
      return db.agents.map(({ secretHash, ...rest }) => rest);
    },
    async findAgentById(agentId) {
      return db.agents.find((a) => a.agentId === agentId) || null;
    },
    async upsertAgent(agent) {
      const existing = db.agents.find((a) => a.agentId === agent.agentId);
      if (existing) Object.assign(existing, agent);
      else db.agents.push(agent);
      persist();
      return db.agents.find((a) => a.agentId === agent.agentId);
    },
    async setAgentStatus(agentId, patch) {
      const a = db.agents.find((x) => x.agentId === agentId);
      if (!a) return null;
      Object.assign(a, patch);
      persist();
      return a;
    },

    async listSessions() {
      return [...db.sessions].sort((a, b) => b.createdAt - a.createdAt);
    },
    async findSession(sessionId) {
      return db.sessions.find((s) => s.id === sessionId) || null;
    },
    async addSession(session) {
      db.sessions.push(session);
      persist();
      return session;
    },
    async updateSession(sessionId, patch) {
      const s = db.sessions.find((x) => x.id === sessionId);
      if (!s) return null;
      Object.assign(s, patch);
      persist();
      return s;
    },

    async listAudit(limit = 200) {
      return [...db.audit].sort((a, b) => b.ts - a.ts).slice(0, limit);
    },
    async audit(event) {
      const entry = { id: uuid(), ts: Date.now(), ...event };
      db.audit.push(entry);
      persist();
      return entry;
    },
  };
}
