import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { clean } from './catalog.mjs';
import { libraryAccess } from './library-access.mjs';

const scrypt = promisify(scryptCallback);
const digest = value => createHash('sha256').update(value).digest('hex');
export const safeUser = user => ({ id: user.id, username: user.username, displayName: user.displayName, role: user.role, enabled: user.enabled, createdAt: user.createdAt, libraryAccess: user.libraryAccess ?? libraryAccess() });
export function validateUsername(value) {
  const name = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,32}$/.test(name)) throw new Error('用户名需为 3–32 位英文字母、数字、下划线、点或短横线。');
  return name;
}
export async function hashPassword(password) {
  if (typeof password !== 'string' || password === '') throw new Error('密码不能为空。');
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password === '') return false;
  const [salt, hash] = (stored || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function makeUser(input, role = 'user') {
  return { id: randomUUID(), username: validateUsername(input.username), displayName: clean(input.displayName || input.username, 50),
    passwordHash: await hashPassword(input.password), role, enabled: true, authVersion: 1, createdAt: new Date().toISOString() };
}
export function describeDevice(userAgent = '') {
  const ua = String(userAgent);
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '其他浏览器';
  const system = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Macintosh|Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : '未知系统';
  return `${browser} · ${system}`;
}
const DAY = 86400000;
export function createAuth(state, { now = Date.now } = {}) {
  state.users ||= []; state.profiles ||= {}; state.apiTokens ||= []; state.audit ||= []; state.sessions ||= {}; state.loginEvents ||= [];
  const attempts = new Map();
  let dirty = false;
  const cookieValue = req => req.headers.cookie?.match(/(?:^|;\s*)screenroom_session=([^;]+)/)?.[1];
  const validSession = entry => entry && entry.expiresAt > now() && state.users.some(u => u.id === entry.userId && u.enabled && u.authVersion === entry.version);
  const writeCookie = (res, raw, remember) => res.setHeader('Set-Cookie', `screenroom_session=${raw}; HttpOnly; SameSite=Strict; Path=/${remember ? '; Max-Age=7776000' : ''}`);
  const requestInfo = req => ({ device: describeDevice(req.headers['user-agent']), ip: String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 64) });
  function sessionsFor(userId) {
    return Object.values(state.sessions).filter(entry => validSession(entry) && (!userId || entry.userId === userId)).map(({ id, userId, createdAt, lastSeenAt, expiresAt, remember, device, ip }) => ({
      id, userId, createdAt: new Date(createdAt).toISOString(), lastSeenAt: new Date(lastSeenAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(), remember, device, ip,
      online: now() - lastSeenAt <= 180000,
    })).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }
  return {
    profile(id) { return state.profiles[id] ||= { favorites: {}, history: {} }; },
    audit(user, action, result = 'ok', targetId = '') {
      state.audit.push({ at: new Date().toISOString(), username: user?.username || 'anonymous', action, result, targetId });
      if (state.audit.length > 500) state.audit.splice(0, state.audit.length - 500);
    },
    checkRate(key) {
      const attempt = attempts.get(key);
      if (attempt && attempt.until > Date.now() && attempt.count >= 10) { const e = new Error('登录尝试过多，请在 15 分钟后重试。'); e.status = 429; throw e; }
    },
    failed(key) { const old = attempts.get(key); attempts.set(key, { count: old?.until > Date.now() ? old.count + 1 : 1, until: Date.now() + 900000 }); },
    clearAttempts(key) { attempts.delete(key); },
    consumeDirty() { const result = dirty; dirty = false; return result; },
    session(user, req, res, remember = true) {
      for (const [key, entry] of Object.entries(state.sessions)) if (!validSession(entry)) delete state.sessions[key];
      const old = cookieValue(req); if (old) delete state.sessions[digest(old)];
      const raw = randomBytes(32).toString('base64url');
      const time = now();
      state.sessions[digest(raw)] = { id: randomUUID(), userId: user.id, version: user.authVersion, createdAt: time, lastSeenAt: time, renewedAt: time,
        expiresAt: time + (remember ? 90 : 1) * DAY, remember, ...requestInfo(req) };
      const owned = Object.entries(state.sessions).filter(([, s]) => s.userId === user.id).sort((a, b) => b[1].createdAt - a[1].createdAt);
      for (const [key] of owned.slice(20)) delete state.sessions[key];
      user.lastLoginAt = new Date(time).toISOString(); user.lastSeenAt = user.lastLoginAt; user.loginCount = (user.loginCount || 0) + 1;
      writeCookie(res, raw, remember); dirty = true;
    },
    recordLogin(req, username, success, user = null) {
      state.loginEvents.push({ id: randomUUID(), at: new Date(now()).toISOString(), username: clean(username, 80), userId: user?.id || '', success, ...requestInfo(req) });
      if (state.loginEvents.length > 500) state.loginEvents.splice(0, state.loginEvents.length - 500);
      dirty = true;
    },
    logout(req, res) {
      const raw = cookieValue(req);
      if (raw) delete state.sessions[digest(raw)];
      res.setHeader('Set-Cookie', 'screenroom_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      dirty = true;
    },
    actor(req, res) {
      const bearer = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
      if (bearer) {
        const hash = digest(bearer), token = state.apiTokens.find(t => t.hash === hash && !t.revoked && new Date(t.expiresAt).getTime() > Date.now());
        const user = token && state.users.find(u => u.id === token.userId && u.enabled && u.role === 'admin' && u.authVersion === token.authVersion);
        return user ? { user, token } : null;
      }
      const raw = cookieValue(req);
      if (!raw) return null;
      const key = digest(raw), entry = state.sessions[key];
      if (!validSession(entry)) { if (entry) { delete state.sessions[key]; dirty = true; } return null; }
      const user = state.users.find(u => u.id === entry.userId && u.enabled && u.authVersion === entry.version);
      if (now() - entry.lastSeenAt >= 30000) { entry.lastSeenAt = now(); entry.ip = requestInfo(req).ip; user.lastSeenAt = new Date(now()).toISOString(); dirty = true; }
      if (entry.remember && res && now() - entry.renewedAt >= DAY) { entry.expiresAt = now() + 90 * DAY; entry.renewedAt = now(); writeCookie(res, raw, true); dirty = true; }
      return user ? { user, token: null, session: entry } : null;
    },
    sessions: sessionsFor,
    userSummaries() { return state.users.map(user => {
      const devices = sessionsFor(user.id);
      return { ...safeUser(user), lastLoginAt: user.lastLoginAt || null, lastSeenAt: user.lastSeenAt || null, loginCount: user.loginCount || 0,
        online: devices.some(s => s.online), activeSessions: devices.length, recentDevice: devices[0]?.device || '', recentIp: devices[0]?.ip || '' };
    }); },
    revokeSession(id) { const pair = Object.entries(state.sessions).find(([, s]) => s.id === id); if (!pair) return false; delete state.sessions[pair[0]]; dirty = true; return true; },
    issueToken(user, input) {
      if (state.apiTokens.filter(t => !t.revoked && new Date(t.expiresAt).getTime() > Date.now()).length >= 20) throw new Error('最多保留 20 个有效令牌，请先撤销旧令牌。');
      const raw = `sr_${randomBytes(32).toString('base64url')}`;
      const token = { id: randomUUID(), name: clean(input.name || '本地调试', 80), hash: digest(raw), prefix: raw.slice(0, 10), userId: user.id, authVersion: user.authVersion,
        scope: ['write', 'classify'].includes(input.scope) ? input.scope : 'read', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + Math.max(1, Math.min(90, Number(input.days) || 7)) * 86400000).toISOString(), revoked: false };
      state.apiTokens.push(token); return { raw, token };
    },
  };
}
