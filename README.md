# HelpDesk EMUCI

Application de **bureau à distance / support technique** — MVP web validant l'architecture
d'assistance à distance décrite dans le cahier des charges : un **technicien** prend le
contrôle visuel de l'écran d'un **agent** (poste assisté) après consentement explicite.

Le flux vidéo passe en **WebRTC P2P** (chiffré DTLS-SRTP) ; le serveur ne fait que la
**signalisation**, l'**authentification** et l'**audit**. Le partage d'écran s'appuie sur
l'API navigateur `getDisplayMedia` — aucun agent natif à installer pour cette démonstration.

## Architecture

```
Technicien (React)  ──WS signalisation──┐
                                        ▼
                              Serveur Node (Express + ws)
                                   auth JWT · sessions · audit
                                        ▲
Agent / poste (React) ──WS signalisation┘
        └──────────── WebRTC P2P (flux écran) ────────────┘
```

- `backend/` — Node.js + Express (REST auth/admin) + `ws` (signalisation WebSocket). Stockage **PostgreSQL/Neon** si `DATABASE_URL` est défini, sinon JSON atomique (dev/tests). En production, le backend sert aussi le frontend compilé.
- `frontend/` — React + Vite : console technicien (`/`) et page agent (`/#/agent`).

## Déploiement (Git → Neon → Render)

Voir **[DEPLOY.md](DEPLOY.md)**. En résumé : un service web Render unique (API + WebSocket + frontend),
base **Neon PostgreSQL** (schéma auto-créé), configuration via [`render.yaml`](render.yaml).

## Démarrage rapide

```bash
npm install && npm run install:all
npm run seed        # crée les comptes de démo
npm run dev         # backend :3001 + frontend :5173
```

Puis :
1. Ouvrir <http://localhost:5173> → se connecter en technicien.
2. Ouvrir <http://localhost:5173/#/agent> dans un autre onglet/poste → le poste s'enregistre.
3. Côté technicien, cliquer **Se connecter** sur l'agent ; côté agent, **Accepter** et choisir la fenêtre/écran à partager.

## Comptes de démo

| Rôle       | Email               | Mot de passe |
|------------|---------------------|--------------|
| Admin      | admin@emuci.local   | admin123     |
| Technicien | tech@emuci.local    | tech123      |

L'onglet **Audit** n'est visible que pour le rôle admin.

## Tests

```bash
npm test   # tests d'intégration REST + signalisation (node:test)
```

## Sécurité

- Mots de passe hachés (bcrypt), JWT access court (15 min) + refresh token.
- Agents isolés : un agent ne voit jamais les autres.
- Journal d'audit horodaté (connexions, demandes, acceptations/refus, chat, durées).
- Flux vidéo chiffré de bout en bout par WebRTC.

## Limites du MVP & suite

- **Agent natif** (capture 30 FPS multi-OS, démarrage service, installeurs `.msi`/`.dmg`/`.deb`)
  à développer en Rust/C++ + Electron — hors périmètre de ce MVP.
- **TURN** requis en production pour traverser NAT/pare-feux (seul STUN public est configuré ici).
- **PostgreSQL + Redis** : le stockage JSON est prévu pour être remplacé (schéma compatible).

Voir [`cahier-des-charges.md`](cahier-des-charges.md) pour le détail des user stories et critères d'acceptation.
