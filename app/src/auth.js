import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto';
import { JsonStore } from './store.js';

const users = new JsonStore('users.json');

// In-memory session table: token -> { userId, username, role, createdAt }.
// Sessions are ephemeral by design (cleared on restart), matching the app's
// zero-dependency, single-process nature.
const sessions = new Map();
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

// ---- password hashing (scrypt, salted) ----
function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const derived = scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(String(password), salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sanitize(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, role: u.role, createdAt: u.createdAt };
}

const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5]{2,24}$/;

export async function register({ username, password }) {
  username = String(username || '').trim();
  password = String(password || '');
  if (!USERNAME_RE.test(username)) {
    throw new Error('用户名需为 2–24 位字母、数字、下划线或中文');
  }
  if (password.length < 6) throw new Error('密码至少 6 位');

  return users.update((list) => {
    if (list.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
      throw new Error('用户名已被注册');
    }
    const user = {
      id: randomUUID(),
      username,
      role: 'visitor',
      password: hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    return { result: sanitize(user), next: [...list, user] };
  });
}

export async function login({ username, password }) {
  username = String(username || '').trim();
  const list = await users.readAll();
  const user = list.find((u) => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !verifyPassword(password, user.password)) {
    throw new Error('用户名或密码错误');
  }
  const token = randomBytes(24).toString('hex');
  sessions.set(token, {
    userId: user.id,
    username: user.username,
    role: user.role,
    createdAt: Date.now(),
  });
  return { token, user: sanitize(user) };
}

export function logout(token) {
  if (token) sessions.delete(token);
}

// Resolve a session token to a live user record (role may have changed since login).
export async function userFromToken(token) {
  if (!token) return null;
  const sess = sessions.get(token);
  if (!sess) return null;
  if (Date.now() - sess.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  const list = await users.readAll();
  const user = list.find((u) => u.id === sess.userId);
  return sanitize(user);
}

// Ensure a first admin exists. Credentials come from env, else sensible defaults.
// The generated/known password is logged once at startup so the operator can log in.
export async function ensureAdmin() {
  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASS || 'admin12345';
  const created = await users.update((list) => {
    const existing = list.find((u) => u.username.toLowerCase() === username.toLowerCase());
    if (existing) {
      // Promote to admin if somehow it isn't.
      if (existing.role !== 'admin') {
        existing.role = 'admin';
        return { result: false, next: list };
      }
      return { result: false, next: undefined };
    }
    const user = {
      id: randomUUID(),
      username,
      role: 'admin',
      password: hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    return { result: true, next: [...list, user] };
  });
  return { username, password, created };
}
