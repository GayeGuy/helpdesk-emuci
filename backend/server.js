// HelpDesk EMUCI — serveur de coordination : REST (auth/admin) + signalisation WebSocket.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import cors from 'cors';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Chargement minimal du .env (évite une dépendance dotenv).
(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

const { createStore } = await import('./lib/store.js');
const { requireAuth, requireRole, issueTokens, verifyToken, verifyPassword } = await import('./lib/auth.js');
const { attachSignaling } = await import('./lib/signaling.js');

const store = await createStore();

const app = express();

// CORS : une ou plusieurs origines séparées par des virgules.
const origins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim());
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || origins.includes('*') || origins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
  }),
);
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true, backend: store.backend, ts: Date.now() }));

// --- Auth ---
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = await store.findUserByEmail(email || '');
  if (!user || !verifyPassword(password || '', user.passwordHash)) {
    await store.audit({ type: 'login-failed', email });
    return res.status(401).json({ error: 'Identifiants invalides' });
  }
  const tokens = issueTokens(user);
  await store.audit({ type: 'login', email: user.email });
  res.json({ ...tokens, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

app.post('/api/auth/refresh', async (req, res) => {
  const decoded = verifyToken((req.body || {}).refreshToken || '');
  if (!decoded || decoded.type !== 'refresh') {
    return res.status(401).json({ error: 'Refresh token invalide' });
  }
  const user = await store.findUserById(decoded.sub);
  if (!user) return res.status(401).json({ error: 'Utilisateur inconnu' });
  res.json(issueTokens(user));
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ email: req.user.email, name: req.user.name, role: req.user.role });
});

// --- Données (techniciens authentifiés) ---
app.get('/api/agents', requireAuth, async (_req, res) => res.json(await store.listAgents()));
app.get('/api/sessions', requireAuth, async (_req, res) => res.json(await store.listSessions()));
app.get('/api/audit', requireAuth, requireRole('admin'), async (_req, res) =>
  res.json(await store.listAudit()),
);

// --- Frontend statique (production : servi par le backend, même origine) ---
const distPath = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const PORT = Number(process.env.PORT) || 3001;
const server = http.createServer(app);
attachSignaling(server, store);

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  server.listen(PORT, () =>
    console.log(`HelpDesk EMUCI — serveur sur :${PORT} (stockage: ${store.backend})`),
  );
}

export { app, server, store };
