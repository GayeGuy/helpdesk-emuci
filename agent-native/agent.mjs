// HelpDesk EMUCI — agent natif Windows (prototype).
// Réutilise le protocole de signalisation du serveur : il s'enregistre comme agent
// « natif », diffuse l'écran en images JPEG (messages 'frame') et exécute les
// commandes souris/clavier reçues (messages 'control') via un pont PowerShell.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SERVER = process.env.HELPDESK_SERVER || 'wss://helpdesk-emuci.onrender.com/ws';
const NAME = process.env.HELPDESK_NAME || `Poste-${process.env.COMPUTERNAME || 'Windows'}`;
const AUTO_ACCEPT = process.env.HELPDESK_AUTOACCEPT !== '0';
const TARGET_FPS = Number(process.env.HELPDESK_FPS || 7);
const FRAME_INTERVAL = Math.max(60, Math.round(1000 / TARGET_FPS));

// agent-id persistant
const idFile = path.join(__dirname, '.agent-id');
let agentId = fs.existsSync(idFile) ? fs.readFileSync(idFile, 'utf8').trim() : '';
if (!agentId) {
  agentId = 'AGENT-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  fs.writeFileSync(idFile, agentId);
}

// --- Pont PowerShell ---
const bridge = spawn(
  'powershell',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'bridge.ps1')],
  { stdio: ['pipe', 'pipe', 'pipe'] },
);
bridge.stderr.on('data', (d) => process.stderr.write(`[bridge] ${d}`));
bridge.on('exit', (c) => {
  console.error(`Pont PowerShell terminé (code ${c}). Arrêt.`);
  process.exit(1);
});
const toBridge = (line) => bridge.stdin.write(line + '\n');

// Écran réel (rempli par le message SIZE du pont)
const screen = { x: 0, y: 0, w: 1920, h: 1080, ready: false };

let ws = null;
let sessionId = null;
let capturing = false;
let pendingFrameResolve = null;

// Lecture ligne par ligne du pont
let buf = '';
bridge.stdout.on('data', (chunk) => {
  buf += chunk.toString('latin1');
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).replace(/\r$/, '');
    buf = buf.slice(nl + 1);
    handleBridgeLine(line);
  }
});

function handleBridgeLine(line) {
  if (line.startsWith('SIZE ')) {
    const [, x, y, w, h] = line.split(' ');
    Object.assign(screen, { x: +x, y: +y, w: +w, h: +h, ready: true });
    console.log(`Écran détecté : ${screen.w}x${screen.h} (origine ${screen.x},${screen.y})`);
    connect();
  } else if (line.startsWith('FRAME ')) {
    const first = line.indexOf(' ');
    const second = line.indexOf(' ', first + 1);
    const third = line.indexOf(' ', second + 1);
    const w = +line.slice(first + 1, second);
    const h = +line.slice(second + 1, third);
    const data = line.slice(third + 1);
    if (ws && ws.readyState === 1 && sessionId) {
      ws.send(JSON.stringify({ type: 'frame', sessionId, data, w, h }));
    }
    if (pendingFrameResolve) {
      pendingFrameResolve();
      pendingFrameResolve = null;
    }
  }
}

// --- Boucle de capture ---
async function captureLoop() {
  while (capturing && sessionId) {
    const t0 = Date.now();
    await new Promise((res) => {
      pendingFrameResolve = res;
      toBridge('CAP');
      setTimeout(res, 3000); // garde-fou anti-blocage
    });
    const wait = FRAME_INTERVAL - (Date.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}

// --- Traduction des événements de contrôle ---
function applyControl(ev) {
  const px = () => Math.round(screen.x + ev.x * screen.w);
  const py = () => Math.round(screen.y + ev.y * screen.h);
  switch (ev.kind) {
    case 'move': toBridge(`M ${px()} ${py()}`); break;
    case 'down': toBridge(`M ${px()} ${py()}`); toBridge(`D ${ev.button || 'left'}`); break;
    case 'up': toBridge(`U ${ev.button || 'left'}`); break;
    case 'click': toBridge(`M ${px()} ${py()}`); toBridge(`C ${ev.button || 'left'}`); break;
    case 'scroll': toBridge(`S ${ev.dy > 0 ? 1 : -1}`); break;
    case 'key': toBridge(`K ${ev.key}`); break;
    case 'type': toBridge(`T ${Buffer.from(ev.text, 'utf8').toString('base64')}`); break;
    default: break;
  }
}

// --- Connexion signalisation ---
function connect() {
  ws = new WebSocket(SERVER);
  ws.on('open', () => {
    console.log(`Connecté à ${SERVER}`);
    ws.send(
      JSON.stringify({
        type: 'register-agent',
        agentId,
        name: NAME,
        os: `${process.platform === 'win32' ? 'Windows' : process.platform} (natif)`,
        resolution: `${screen.w}x${screen.h}`,
        native: true,
      }),
    );
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    switch (msg.type) {
      case 'registered':
        console.log(`Enregistré : ${msg.agentId} — en attente de connexions.`);
        break;
      case 'session-request':
        console.log(`\n>>> Demande de ${msg.technician?.email} — motif : ${msg.reason || '—'}`);
        if (AUTO_ACCEPT) {
          console.log('>>> Acceptation automatique (prototype).');
          ws.send(JSON.stringify({ type: 'session-accept', sessionId: msg.sessionId }));
        }
        break;
      case 'session-start':
        sessionId = msg.sessionId;
        capturing = true;
        console.log('Session démarrée — diffusion de l\'écran + contrôle actif.');
        captureLoop();
        break;
      case 'control':
        applyControl(msg.event);
        break;
      case 'chat':
        console.log(`[chat technicien] ${msg.text}`);
        break;
      case 'session-end':
        console.log('Session terminée.\n');
        capturing = false;
        sessionId = null;
        break;
      default:
        break;
    }
  });
  ws.on('close', () => {
    console.log('Déconnecté. Reconnexion dans 3 s…');
    capturing = false;
    sessionId = null;
    setTimeout(connect, 3000);
  });
  ws.on('error', (e) => console.error('WS erreur:', e.message));
}

console.log(`HelpDesk EMUCI — agent natif\n  id: ${agentId}\n  nom: ${NAME}\n  serveur: ${SERVER}`);
process.on('SIGINT', () => {
  try { bridge.stdin.end(); } catch {}
  process.exit(0);
});
