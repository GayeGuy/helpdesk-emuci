// Authentification JWT (access + refresh) et hachage bcrypt.
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const SECRET = process.env.JWT_SECRET || 'dev-change-me-please-use-a-long-random-string';
const JWT_TTL = process.env.JWT_TTL || '15m';
const REFRESH_TTL = process.env.REFRESH_TTL || '7d';

export const hashPassword = (plain) => bcrypt.hashSync(plain, 10);
export const verifyPassword = (plain, hash) => bcrypt.compareSync(plain, hash);

export function issueTokens(user) {
  const payload = { sub: user.id, email: user.email, role: user.role, name: user.name };
  const accessToken = jwt.sign(payload, SECRET, { expiresIn: JWT_TTL });
  const refreshToken = jwt.sign({ sub: user.id, type: 'refresh' }, SECRET, {
    expiresIn: REFRESH_TTL,
  });
  return { accessToken, refreshToken };
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

// Middleware Express : exige un access token valide.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const decoded = token && verifyToken(token);
  if (!decoded || decoded.type === 'refresh') {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  req.user = decoded;
  next();
}

// Middleware Express : exige un rôle précis.
export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    next();
  };
}
