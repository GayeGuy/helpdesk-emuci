# Déploiement — HelpDesk EMUCI (Git → Neon → Render)

L'application se déploie en **un seul service web Render** : le backend Node sert à la fois
l'API REST, la signalisation WebSocket **et** le frontend React compilé (même origine).
La base de données est **Neon PostgreSQL**.

## 1. Git / GitHub

Le dépôt est déjà initialisé et commité en local. Pour le pousser sur GitHub :

```bash
cd C:\helpdesk-emuci
git remote add origin https://github.com/<votre-compte>/helpdesk-emuci.git
git branch -M main
git push -u origin main
```

(ou créez le dépôt via l'interface GitHub puis copiez l'URL `origin`.)

## 2. Neon (PostgreSQL)

1. Sur <https://console.neon.tech> → **New Project** (région proche, ex. Europe `eu-central-1`).
2. Créez une base, ex. `helpdesk`.
3. Copiez la **connection string** (format *pooled* recommandé) :
   ```
   postgresql://user:password@ep-xxxx.eu-central-1.aws.neon.tech/helpdesk?sslmode=require
   ```
4. Le schéma (`users`, `agents`, `sessions`, `audit`) est **créé automatiquement** au démarrage
   du serveur, et les comptes de démo sont insérés par `npm run seed` (lancé au déploiement).

## 3. Render

### Option A — Blueprint (recommandé, via `render.yaml`)
1. <https://dashboard.render.com> → **New** → **Blueprint** → connectez le repo GitHub.
2. Render détecte [`render.yaml`](render.yaml) et propose le service `helpdesk-emuci`.
3. Avant de valider, renseignez la variable **`DATABASE_URL`** (la connection string Neon).
   `JWT_SECRET` est généré automatiquement.
4. **Apply** → build (`npm run build:all`) puis démarrage (`npm run start:prod`).

### Option B — manuelle
1. **New** → **Web Service** → repo GitHub.
2. Runtime **Node**, Build `npm run build:all`, Start `npm run start:prod`, Health check `/api/health`.
3. Variables d'environnement : `DATABASE_URL` (Neon), `JWT_SECRET` (chaîne aléatoire longue),
   `NODE_VERSION=20`.

Une fois déployé, l'application est disponible sur `https://helpdesk-emuci.onrender.com` :
- Console technicien : `/`
- Poste agent : `/#/agent`

Les URLs API/WebSocket sont **auto-détectées** (même origine, `wss://` en HTTPS) — rien à configurer côté frontend.

## 4. Après déploiement

- Connexion : `admin@emuci.local` / `admin123` (⚠️ **changez ces identifiants de démo** en production).
- Le plan **free** de Render met le service en veille après inactivité (premier appel plus lent).
- WebRTC en production derrière NAT/pare-feu strict nécessitera un **serveur TURN**
  (ajouter l'entrée dans `iceServers`, côté `Agent.jsx` et `Session.jsx`).

## Vérification locale avec PostgreSQL (Docker)

```bash
docker compose up --build
# → http://localhost:3001  (Postgres + app, schéma auto-créé, comptes de démo insérés)
```
