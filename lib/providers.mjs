import { normalizeMovie, webUrl } from './catalog.mjs';

export async function fetchJson(url, token = '', fetcher = fetch) {
  if (!webUrl(url)) throw new Error('API 地址必须为 http:// 或 https://，且不能包含用户名或密码。');
  let response;
  try { response = await fetcher(url, { headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(15000), redirect: 'error' }); }
  catch { throw new Error('无法连接 API（15 秒超时、重定向或网络错误），请检查接口地址。'); }
  if (!response.ok) throw new Error(`API 返回 HTTP ${response.status}${[401, 403].includes(response.status) ? '，请检查访问令牌和权限' : ''}。`);
  if (Number(response.headers.get('content-length')) > 10_000_000) throw new Error('API 响应超过 10 MB。');
  const reader = response.body.getReader();
  let size = 0; const chunks = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 10_000_000) { await reader.cancel(); throw new Error('API 响应超过 10 MB。'); } chunks.push(value); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('API 未返回有效 JSON。'); }
}
export function extractList(data) {
  if (Array.isArray(data)) return data;
  for (const list of [data?.movies, data?.list, data?.results, data?.data?.list, data?.data?.movies, data?.data]) if (Array.isArray(list)) return list;
  throw new Error('未找到影片数组。支持数组、{ movies: [] }、{ list: [] }、{ results: [] } 或 { data: { list: [] } }。');
}
export async function fetchSource(source, fetcher = fetch) {
  const movies = [];
  const pages = Math.max(1, Math.min(10, Number(source.pages) || 1));
  if (source.provider === 'tmdb') {
    if (!source.token) throw new Error('请填写 TMDB API Read Access Token（读取访问令牌），不是 v3 API Key。');
    const base = 'https://api.themoviedb.org/3';
    const genres = await fetchJson(`${base}/genre/movie/list?language=zh-CN`, source.token, fetcher);
    const genreMap = new Map((genres.genres || []).map(g => [g.id, g.name]));
    for (let page = 1; page <= pages; page++) {
      const data = await fetchJson(`${base}/discover/movie?language=zh-CN&include_adult=false&sort_by=popularity.desc&page=${page}`, source.token, fetcher);
      for (const item of extractList(data)) movies.push(normalizeMovie({ ...item,
        genres: (item.genre_ids || []).map(id => genreMap.get(id) || '未分类'),
        poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '',
        backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : '',
      }, source.id, movies.length));
      if (page >= (data.total_pages || 1)) break;
    }
  } else {
    if (!webUrl(source.url)) throw new Error('请填写有效的 API 地址。');
    for (let page = 1; page <= pages; page++) {
      const url = new URL(source.url);
      if (source.provider === 'maccms') { url.searchParams.set('ac', 'detail'); url.searchParams.set('pg', page); }
      else if (page > 1 || pages > 1) url.searchParams.set('page', page);
      const data = await fetchJson(url.href, source.token, fetcher);
      const list = extractList(data);
      list.slice(0, 2000).forEach((item, i) => { if (item && typeof item === 'object') movies.push(normalizeMovie(item, source.id, i)); });
      if (!list.length || page >= Number(data.pagecount || data.total_pages || pages)) break;
    }
  }
  const deduped = new Map(movies.filter(Boolean).map(m => [m.id, m]));
  if (!deduped.size) throw new Error('接口没有返回可导入的影片，现有片库保持不变。');
  return { movies: [...deduped.values()], warnings: [] };
}
