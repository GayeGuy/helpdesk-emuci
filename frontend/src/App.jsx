import { useEffect, useState } from 'react';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Agent from './pages/Agent.jsx';

// Routage minimal par hash :
//   #/agent  -> poste contrôlé (aucune authentification)
//   sinon    -> application technicien (login puis dashboard)
export default function App() {
  const [route, setRoute] = useState(window.location.hash);
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (window.location.hash === '#/agent') {
      setReady(true);
      return;
    }
    if (api.isLoggedIn()) {
      api
        .me()
        .then((u) => setUser(u))
        .catch(() => api.logout())
        .finally(() => setReady(true));
    } else {
      setReady(true);
    }
  }, []);

  if (route === '#/agent') return <Agent />;
  if (!ready) return <div className="center muted">Chargement…</div>;
  if (!user) return <Login onLogin={setUser} />;
  return (
    <Dashboard
      user={user}
      onLogout={() => {
        api.logout();
        setUser(null);
      }}
    />
  );
}
