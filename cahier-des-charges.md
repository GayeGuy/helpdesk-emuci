# HelpDesk EMUCI — Cahier des charges (MVP)

**Version** 1.0 — MVP web validant le concept de bureau à distance / support technique.

## 1. Contexte & objectifs
Solution interne de support technique à distance : un **technicien** prend le contrôle
visuel du poste d'un **agent** (utilisateur assisté) après consentement explicite.
Le MVP valide toute la chaîne (signalisation, auth, sessions, audit, chat, flux vidéo P2P)
en s'appuyant sur WebRTC dans le navigateur (`getDisplayMedia`), sans agent natif.
Objectif : prouver l'architecture et l'UX avant d'investir dans les agents natifs multi-OS.

## 2. Périmètre fonctionnel (US must-have)
- **US1** — Le technicien se connecte (JWT + refresh, rôles `admin`/`technicien`).
- **US2** — Un agent s'enregistre avec un `agent-id` persistant et apparaît en ligne.
- **US3** — Le technicien voit le tableau de bord des agents (statut, OS, IP, dernière session).
- **US4** — Le technicien demande une session ; l'agent reçoit une notification et accepte/refuse.
- **US5** — Après acceptation, l'agent partage son écran (WebRTC P2P) ; le technicien le voit.
- **US6** — Chat texte temps réel technicien ↔ agent pendant la session.
- **US7** — Fin de session par l'une ou l'autre partie ; durée calculée.
- **US8** — Journal d'audit centralisé (connexions, demandes, acceptations/refus, durées).

## 3. Parcours principal
1. Technicien se connecte au dashboard. 2. Agent ouvre sa page et s'enregistre.
3. Technicien clique « Se connecter » sur l'agent. 4. Agent voit la demande et accepte.
5. Négociation WebRTC (offer/answer/ICE via le serveur de signalisation).
6. Le flux d'écran s'affiche chez le technicien ; échange de chat. 7. « Terminer » → audit + durée.

## 4. Non-fonctionnel
- **Sécurité** : mots de passe hashés (bcrypt), JWT TTL court + refresh, agent authentifié par clé, WebRTC (DTLS-SRTP) chiffré de bout en bout, isolation entre agents.
- **Perf** : flux vidéo P2P (pas via serveur) ; signalisation < 100 ms en LAN.
- **Traçabilité** : chaque événement horodaté et persistant.

## 5. Technique
- **Backend** : Node.js + Express (REST auth/admin) + `ws` (WebSocket signalisation), stockage JSON atomique (`users`, `agents`, `sessions`, `audit`).
- **Frontend** : React + Vite. Pages : Login, Dashboard technicien, Session (contrôleur), Agent.
- **Transport** : WebSocket pour signalisation + chat + notifications ; WebRTC pour la vidéo.
- **Endpoints REST** : `POST /api/auth/login`, `POST /api/auth/refresh`, `GET /api/auth/me`, `GET /api/agents`, `GET /api/sessions`, `GET /api/audit` (admin).
- **Messages WS** : `register-agent`, `auth`, `agents-update`, `session-request`, `session-accept`, `session-reject`, `signal` (sdp/ice), `chat`, `session-end`.

## 6. Critères d'acceptation
1. Login refusé si mauvais mot de passe, JWT émis sinon.
2. Un agent enregistré apparaît dans `GET /api/agents` avec statut `online`.
3. Une demande de session crée un événement d'audit `session-request`.
4. Un refus agent notifie le technicien et journalise `session-reject`.
5. Une acceptation ouvre un canal de signalisation relayant offer/answer/ICE.
6. Les messages de chat sont relayés et journalisés.
7. La fin de session enregistre une durée > 0.
8. Un agent ne peut jamais voir la liste des autres agents.

## 7. Risques & écueils
- **Agent natif hors périmètre MVP** : capture 30 FPS multi-OS = code natif (Rust/C++) à faire ensuite.
- **NAT/pare-feu** : WebRTC en prod nécessitera un serveur TURN (documenté, non fourni MVP).
- **Postgres** : JSON suffit pour le MVP ; schéma pensé pour migration PG ultérieure.
