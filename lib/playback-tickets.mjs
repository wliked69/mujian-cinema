import { randomBytes, createHash } from 'node:crypto';
const hash = value => createHash('sha256').update(value).digest('hex');
export const PLAYBACK_TTL = 6 * 60 * 60 * 1000;

/** Memory-only, single-media capability; never an account/API session credential. */
export function createPlaybackTickets({ now = Date.now } = {}) {
  const entries = new Map();
  function prune() { for (const [key, entry] of entries) if (entry.expiresAt <= now()) entries.delete(key); }
  return {
    issue({ userId, authVersion, sessionId, movieId, episodeId = '' }) {
      if (!userId || !sessionId || !movieId) throw new Error('需要有效登录才能生成播放地址。');
      prune();
      const owned = [...entries].filter(([, entry]) => entry.userId === userId);
      for (const [key] of owned.slice(0, Math.max(0, owned.length - 7))) entries.delete(key);
      while (entries.size >= 200) entries.delete(entries.keys().next().value);
      const token = randomBytes(32).toString('base64url'), expiresAt = now() + PLAYBACK_TTL;
      entries.set(hash(token), { userId, authVersion, sessionId, movieId, episodeId, expiresAt });
      return { token, expiresAt };
    },
    get(token) {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      prune(); return entries.get(hash(token)) || null;
    },
  };
}
