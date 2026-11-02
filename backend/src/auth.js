import crypto from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import { HttpError } from './errors.js';

const scrypt = promisify(crypto.scrypt);

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, s, k] = String(stored).split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const expected = Buffer.from(k, 'base64');
  const actual = await scrypt(password, Buffer.from(s, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export const signToken = (config, user) =>
  jwt.sign({ role: user.role }, config.jwtSecret, { algorithm: 'HS256', expiresIn: config.jwtExpiresIn, subject: String(user.id) });

/** Verifies the JWT, then re-loads the user so disabling an account takes effect immediately. */
export const authenticate = (db, config) => (req, _res, next) => {
  try {
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in required');
    let claims;
    try {
      claims = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    } catch {
      throw new HttpError(401, 'UNAUTHENTICATED', 'Session expired. Sign in again.');
    }
    const user = db.prepare('SELECT id, username, role, active FROM users WHERE id=?').get(Number(claims.sub));
    if (!user || !user.active) throw new HttpError(401, 'UNAUTHENTICATED', 'Account is not active');
    req.user = { id: user.id, username: user.username, role: user.role }; // role comes from the DB, not the token
    next();
  } catch (e) {
    next(e);
  }
};

export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user?.role) ? next() : next(new HttpError(403, 'FORBIDDEN', 'You do not have access to this action'));
