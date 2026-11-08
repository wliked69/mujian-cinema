export function createClient(env = process.env) {
  const base = new URL(env.SCREENROOM_URL || 'http://127.0.0.1:3210');
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname) || base.username || base.password || base.pathname !== '/') throw new Error('调试客户端仅允许本机 http://127.0.0.1:端口 或 http://localhost:端口。');
  const token = env.SCREENROOM_TOKEN;
  if (!token) throw new Error('请先在管理员后台生成令牌，并通过 SCREENROOM_TOKEN 环境变量提供。');
  return async (route, data) => {
    const response = await fetch(new URL(route, base), { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }), signal: AbortSignal.timeout(20000), redirect: 'error' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return result;
  };
}
export function summarizeMovies(library, query = '', limit = 50) {
  const term = String(query).toLowerCase();
  return { total: library.movies.length, movies: library.movies.filter(m => [m.title, m.originalTitle, m.cast, m.director, ...(m.genres || []), ...(m.studios || []), ...(m.series || [])].join(' ').toLowerCase().includes(term)).slice(0, Math.max(1, Math.min(100, Number(limit) || 50))).map(({ id, title, originalTitle, year, director, cast, genres, metadataGenres, studios, series, duration, rating, kind, playable }) => ({ id, title, originalTitle, year, director, cast, genres, metadataGenres, studios, series, duration, rating, kind, playable })) };
}
