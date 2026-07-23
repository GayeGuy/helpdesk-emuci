// Crée les utilisateurs par défaut (admin + technicien). Idempotent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

const { createStore, id } = await import('./lib/store.js');
const { hashPassword } = await import('./lib/auth.js');

const store = await createStore();

const defaults = [
  { email: 'admin@emuci.local', name: 'Admin EMUCI', role: 'admin', password: 'admin123' },
  { email: 'tech@emuci.local', name: 'Technicien EMUCI', role: 'technician', password: 'tech123' },
];

let created = 0;
for (const d of defaults) {
  if (await store.findUserByEmail(d.email)) continue;
  await store.addUser({
    id: id(),
    email: d.email,
    name: d.name,
    role: d.role,
    passwordHash: hashPassword(d.password),
    createdAt: Date.now(),
  });
  created++;
}

console.log(
  created
    ? `${created} utilisateur(s) créé(s) [${store.backend}]. Login: admin@emuci.local / admin123 — tech@emuci.local / tech123`
    : `Utilisateurs déjà présents [${store.backend}], rien à faire.`,
);
process.exit(0);
