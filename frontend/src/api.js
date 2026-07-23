// Client API REST + gestion des tokens JWT (access + refresh).
// En dev : backend séparé sur :3001. En prod : même origine que le frontend servi par Express.
const DEV = import.meta.env.DEV;
const BASE = import.meta.env.VITE_API_URL || (DEV ? 'http://localhost:3001/api' : '/api');
export const WS_URL =
  import.meta.env.VITE_WS_URL ||
  (DEV
    ? 'ws://localhost:3001/ws'
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);

const tokens = {
  get access() {
    return localStorage.getItem('hd_access');
  },
  get refresh() {
    return localStorage.getItem('hd_refresh');
  },
  set({ accessToken, refreshToken }) {
    if (accessToken) localStorage.setItem('hd_access', accessToken);
    if (refreshToken) localStorage.setItem('hd_refresh', refreshToken);
  },
  clear() {
    localStorage.removeItem('hd_access');
    localStorage.removeItem('hd_refresh');
  },
};

async function req(path, opts = {}, retry = true) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401 && retry && tokens.refresh && !path.startsWith('/auth/')) {
    const ok = await refresh();
    if (ok) return req(path, opts, false);
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const b = await res.json();
      if (b?.error) msg = b.error;
    } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

async function refresh() {
  try {
    const res = await fetch(BASE + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refresh }),
    });
    if (!res.ok) return false;
    tokens.set(await res.json());
    return true;
  } catch {
    return false;
  }
}

export const api = {
  tokens,
  isLoggedIn: () => !!tokens.access,
  async login(email, password) {
    const data = await req('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    tokens.set(data);
    return data.user;
  },
  logout() {
    tokens.clear();
  },
  me: () => req('/auth/me'),
  agents: () => req('/agents'),
  sessions: () => req('/sessions'),
  audit: () => req('/audit'),
};
