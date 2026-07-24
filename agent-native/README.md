# Agent natif Windows — HelpDesk EMUCI

Prototype d'agent **installé** sur le poste à assister. Contrairement à la page agent
navigateur (qui ne fait que *montrer* l'écran), cet agent permet au technicien de **prendre
le contrôle** : souris et clavier sont injectés dans le système.

## Comment ça marche

- Un process **Node.js** (`agent.mjs`) parle le même protocole de signalisation que le
  serveur (mêmes messages `register-agent`, `session-accept`, `frame`, `control`…).
- Un **pont PowerShell** (`bridge.ps1`) fait le travail natif, **sans aucune dépendance
  compilée** :
  - capture d'écran via `System.Drawing.CopyFromScreen` → JPEG,
  - injection souris/clavier via `user32.dll` (`SetCursorPos`, `mouse_event`, `keybd_event`, `SendKeys`).
- L'écran est diffusé en images JPEG (~7 img/s) ; le technicien renvoie des coordonnées
  normalisées (0..1) que l'agent remappe sur la résolution réelle du poste.

## Prérequis

- Windows, **Node.js 20+**.
- Une session de bureau interactive (la capture ne fonctionne pas sur le bureau sécurisé / écran de connexion).

## Lancer

```bash
cd agent-native
npm install
npm start
```

Par défaut il se connecte au serveur de production. Variables d'environnement :

| Variable | Défaut | Rôle |
|---|---|---|
| `HELPDESK_SERVER` | `wss://helpdesk-emuci.onrender.com/ws` | URL WebSocket du serveur |
| `HELPDESK_NAME` | `Poste-<COMPUTERNAME>` | Nom affiché côté technicien |
| `HELPDESK_FPS` | `7` | Images par seconde visées |
| `HELPDESK_AUTOACCEPT` | `1` | `0` pour désactiver l'acceptation automatique |

L'identifiant du poste est généré au premier lancement et conservé dans `.agent-id`.

## Limites (prototype)

- **Acceptation automatique par défaut** (`HELPDESK_AUTOACCEPT=1`) : pratique pour la démo,
  mais à passer à `0` (ou remplacer par une vraie invite de consentement) avant tout usage réel.
- Combinaisons de touches (Ctrl/Alt/Win) non transmises ; frappe simple et touches spéciales
  (Entrée, Backspace, flèches…) uniquement.
- Débit JPEG plutôt que codec vidéo → conçu pour le LAN / faible latence, pas pour la vidéo plein écran fluide.
- Un seul écran (bureau virtuel complet) capturé.

Ces points correspondent au périmètre « agent natif » restant du cahier des charges ; toute
l'infrastructure serveur (auth, sessions, audit, signalisation) est déjà partagée avec le reste de l'app.
