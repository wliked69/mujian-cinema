import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createStore } from './lib/store.mjs';
import { clean, names, publicMovie, toolMovie, webUrl, actorProfiles, releaseDate } from './lib/catalog.mjs';
import { scanDirectory, within } from './lib/scanner.mjs';
import { fetchSource, fetchJson } from './lib/providers.mjs';
import { createAuth, safeUser, makeUser, hashPassword, verifyPassword } from './lib/auth.mjs';
import { openapi } from './lib/openapi.mjs';
import { createPlayerService } from './lib/players.mjs';
import { preserveGenres, setGenres, genrePlan, upgradeGenres } from './lib/genres.mjs';
import { preferences } from './lib/preferences.mjs';
import { editableFacts } from './lib/facts.mjs';
import { addComment, publicComment } from './lib/comments.mjs';
import { networkSettings, isLoopback, allowedHost, accessUrls, startListening, closeListeners } from './lib/network.mjs';
import { startDiscovery } from './lib/discovery.mjs';
import { createPlaybackTickets } from './lib/playback-tickets.mjs';
import { sendMovieBackup } from './lib/movie-backup.mjs';
import { planLocalRelocation } from './lib/relocation.mjs';
import { libraryAccess, movieAccess, canViewMovie, canViewSource, visibleLibraries, referencesImage } from './lib/library-access.mjs';
import { initializeLibraries, planLibrary } from './lib/libraries.mjs';
import { initializePortraits, portraitMap, actorKey, movieActors, readPortrait, savePortraitFile } from './lib/actor-portraits.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.mov': 'video/quicktime', '.ts': 'video/mp2t' };
const safeSource = s => ({ id: s.id, type: s.type, name: s.name, path: s.path || '', category: s.category || '', provider: s.provider || '',
  url: (() => { try { const u = new URL(s.url); for (const k of [...u.searchParams.keys()]) if (/key|token|secret|password|auth/i.test(k)) u.searchParams.set(k, '••••••'); return u.href; } catch { return ''; } })(),
  pages: s.pages || 1, hasToken: !!s.token, lastSync: s.lastSync || null, count: s.count ?? 0, lastError: s.lastError || '' });
function applyManualFacts(movie) {
  if (!movie.manualFacts) return;
  Object.assign(movie, movie.manualFacts);
  if (movie.manualFacts.releaseDate) movie.year = Number(movie.manualFacts.releaseDate.slice(0, 4));
  if (Object.hasOwn(movie.manualFacts, 'cast')) {
    const known = new Map((movie.actors || []).map(a => [a.name, a]));
    movie.actors = names(movie.cast).map(name => known.get(name) || { name, photo: '' });
  }
}

export async function createApp({ dataDir = path.join(HERE, 'data'), fetcher = fetch, playerService = createPlayerService(), portOverride, onShutdown } = {}) {
  const store = await createStore(dataDir);
  const coversDir = path.join(dataDir, 'covers');
  const actorsDir = path.join(dataDir, 'actors');
  let backingUp = false, relocating = false;
  let closing = false, shutdownTask, syncTask;
  const requests = new Set();
  const canShutdown = typeof onShutdown === 'function';
  const state = store.state;
  initializeLibraries(state);
  initializePortraits(state);
  let actorPortraitLookup = portraitMap(state.actorPortraits), portraitBusy = false;
  const exposedMovie = (movie, favorites) => publicMovie(movie, favorites, actorPortraitLookup);
  for (const movie of state.movies) {
    if (movie.kind === 'local' && movie.genreModel !== 2) {
      const group = state.sources.find(source => source.id === movie.sourceId)?.category;
      if (group) movie.folderCategory = group;
    }
    upgradeGenres(movie);
  }
  state.comments ||= [];
  const auth = createAuth(state);
  const playbackTickets = createPlaybackTickets();
  const discovery = { status: 'disabled', error: '', port: 43210, close: async () => {} };
  state.network = networkSettings(state.network);
  const listenConfig = { ...state.network, ...(portOverride ? { port: networkSettings({ port: portOverride }).port } : {}) };
  let authSaveTimer = null;
  function scheduleAuthSave() {
    if (authSaveTimer) return;
    authSaveTimer = setTimeout(() => { authSaveTimer = null; store.save().catch(() => console.error('登录活动保存失败，请检查数据目录权限。')); }, 1000);
    authSaveTimer.unref();
  }
  let setupInProgress = false;
  let lastPlayerLaunch = 0;
  const demo = JSON.parse(await fs.readFile(path.join(HERE, 'demo.json'), 'utf8'));
  let job = { status: 'idle', found: 0, folders: 0, warnings: [], message: '' };
  const getMovies = () => state.useDemo !== false && !state.movies.length ? demo : state.movies;
  const findMovie = id => getMovies().find(m => m.id === id);
  const json = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  async function body(req) {
    let text = '';
    for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 1_000_000) throw new Error('请求过大。'); }
    try { return JSON.parse(text || '{}'); } catch { throw new Error('请求不是有效 JSON。'); }
  }
  async function sync(sources) {
    job = { status: 'running', found: 0, folders: 0, warnings: [], message: '正在连接片库…', startedAt: Date.now() };
    let failures = 0, imported = 0;
    for (const source of sources) {
      job.sourceName = source.name; job.message = `正在${source.type === 'local' ? '扫描' : '同步'}「${source.name}」…`;
      try {
        const result = source.type === 'local' ? await scanDirectory(source, p => Object.assign(job, p)) : await fetchSource(source, fetcher);
        // A rescan updates paths and sidecars without discarding a user-confirmed TMDB match.
        const old = new Map(state.movies.filter(m => m.sourceId === source.id).map(m => [m.id, m]));
        for (const movie of result.movies) {
          let previous = old.get(movie.id) || movie.episodes?.map(e => old.get(e.id)).find(Boolean);
          if (!old.has(movie.id) && movie.episodes?.length) {
            const manual = movie.episodes.map(e => old.get(e.id)?.manualGenres).filter(Array.isArray);
            if (manual.length) previous = { ...previous, manualGenres: [...new Set(manual.flat())].slice(0, 12) };
          }
          if (previous?.tmdbId && source.type === 'local' && (movie.mediaType !== 'tv' || previous.mediaType === 'tv')) {
            for (const key of ['title', 'originalTitle', 'year', 'releaseDate', 'overview', 'rating', 'duration', 'director', 'cast', 'actors', 'country', 'poster', 'backdrop', 'tmdbId', 'studios', 'series']) movie[key] = previous[key];
            if (previous.metadataGenres) movie.metadataGenres = previous.metadataGenres;
          }
          preserveGenres(movie, previous);
          if (previous?.manualFacts) { movie.manualFacts = { ...previous.manualFacts }; applyManualFacts(movie); }
          if (movie.episodes?.length) {
            const ids = new Set(movie.episodes.map(e => e.id));
            for (const p of Object.values(state.profiles || {})) {
              if (movie.episodes.some(e => p.favorites?.[e.id])) { p.favorites ||= {}; p.favorites[movie.id] = true; }
              const recent = movie.episodes.map(e => ({ ...p.history?.[e.id], episodeId: e.id })).filter(h => h.updatedAt).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0];
              if (recent && !p.history?.[movie.id]) { p.history ||= {}; p.history[movie.id] = recent; }
            }
            for (const c of state.comments) if (ids.has(c.movieId)) c.movieId = movie.id;
          }
        }
        state.movies = [...state.movies.filter(m => m.sourceId !== source.id), ...result.movies];
        state.useDemo = false;
        source.count = result.movies.length; source.lastSync = new Date().toISOString(); source.lastError = '';
        job.warnings.push(...result.warnings); imported += result.movies.length;
      } catch (error) {
        failures++; source.lastError = source.type === 'local' && error.code === 'ENOENT' ? '找不到目录，请检查挂载盘符或 NAS 共享路径。' : source.type === 'local' && error.code === 'EACCES' ? '目录无权限，请检查 Windows 账户权限。' : error.message;
        job.warnings.push(`${source.name}：${source.lastError}`);
      }
    }
    state.updatedAt = new Date().toISOString();
    await store.save();
    job = { ...job, status: failures === sources.length ? 'error' : 'done', found: imported, finishedAt: Date.now(),
      message: failures === sources.length ? '同步失败，原有片库未改动' : `已更新 ${imported} 部影片${failures ? `，${failures} 个来源失败` : ''}` };
  }
  function startSync(sources) {
    if (closing) throw new Error('网站正在关闭，不能开始扫描。');
    if (relocating) throw new Error('片库目录正在迁移，请稍后扫描。');
    if (job.status === 'running') throw new Error('已有扫描正在进行，请等待完成。');
    if (!sources.length) throw new Error('请先添加 NAS 文件夹或 API 来源。');
    syncTask = sync(sources).catch(error => { job = { ...job, status: 'error', message: `保存失败：${error.message}` }; });
  }
  async function sendFile(req, res, filename, media = false) {
    const stat = await fs.stat(filename);
    if (!stat.isFile()) throw new Error('文件不存在。');
    const asset = !['.html', '.js', '.css', '.json'].includes(path.extname(filename).toLowerCase());
    const headers = { 'Content-Type': TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': media ? 'private, no-store' : asset ? 'public, max-age=3600' : 'no-store' };
    const range = req.headers.range;
    let start = 0, end = stat.size - 1, status = 200;
    if (range && media) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
      if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }
    headers['Content-Length'] = Math.max(0, end - start + 1);
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || !stat.size) return res.end();
    const stream = createReadStream(filename, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy()); stream.pipe(res);
  }
  const handleRequest = async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https: http: data:; media-src 'self' https: http: blob:; connect-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      res.setHeader('X-Request-ID', randomUUID());
      if (!allowedHost(req.headers.host, listenConfig.allowLan, { enableIpv6: listenConfig.enableIpv6 })) return json(res, 403, { error: '访问地址未获允许，请使用本机地址或后台显示的局域网地址。' });
      if (closing) return json(res, 503, { error: '网站正在关闭。' });
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith('/play/')) {
        if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: '播放地址仅允许读取视频。' });
        const ticket = playbackTickets.get(pathname.slice(6));
        const owner = ticket && state.users.find(u => u.id === ticket.userId && u.enabled && u.authVersion === ticket.authVersion);
        if (!owner || !auth.sessions(owner.id).some(s => s.id === ticket.sessionId)) return json(res, 403, { error: '播放地址已失效，请从 App 重新播放。' });
        const movie = state.movies.find(m => m.id === ticket.movieId);
        const episode = ticket.episodeId ? movie?.episodes?.find(e => e.id === ticket.episodeId) : null;
        const filename = ticket.episodeId ? episode?.filePath : movie?.filePath;
        if (!canViewMovie(owner, movie, state.libraries) || movie.kind !== 'local' || !filename) return json(res, 404, { error: '影片或集数不存在或无权访问。' });
        const actual = await fs.realpath(filename);
        if (!within(movie.rootPath, actual)) return json(res, 403, { error: '文件超出已授权片库。' });
        return await sendFile(req, res, actual, true);
      }
      if (!['GET', 'HEAD'].includes(req.method)) {
        if ((!req.headers.authorization && req.headers['x-cinema-client'] !== 'local') || (req.headers.origin && req.headers.origin !== url.origin)) return json(res, 403, { error: '拒绝跨站请求。' });
      }
      const actor = auth.actor(req, res);
      if (auth.consumeDirty()) scheduleAuthSave();
      if (req.method === 'GET' && pathname === '/api/auth/me') return actor?.token ? json(res, 403, { error: '令牌不能用于浏览器账号登录。' }) : json(res, 200, { needsSetup: state.users.length === 0, user: actor ? safeUser(actor.user) : null });
      if (req.method === 'POST' && pathname === '/api/auth/setup') {
        if (!isLoopback(req.socket.remoteAddress)) return json(res, 403, { error: '首次创建管理员需要在服务器本机完成。' });
        if (state.users.length || setupInProgress) return json(res, 409, { error: '管理员已创建，请登录。' });
        setupInProgress = true;
        try {
          const input = await body(req), user = await makeUser(input, 'admin');
          state.users.push(user); state.profiles[user.id] = { favorites: state.favorites || {}, history: state.history || {} }; delete state.favorites; delete state.history;
          auth.audit(user, 'admin.setup'); auth.session(user, req, res, input.remember !== false); auth.recordLogin(req, user.username, true, user); await store.save();
          return json(res, 201, { user: safeUser(user) });
        } finally { setupInProgress = false; }
      }
      if (req.method === 'POST' && pathname === '/api/auth/login') {
        const key = req.socket.remoteAddress; auth.checkRate(key);
        const input = await body(req), username = String(input.username || '').trim().toLowerCase();
        const user = state.users.find(u => u.username === username);
        const valid = await verifyPassword(input.password, user?.passwordHash);
        if (!user?.enabled || !valid) { auth.failed(key); auth.audit(null, 'auth.login', 'denied'); auth.recordLogin(req, username, false, user); await store.save(); return json(res, 401, { error: '用户名或密码不正确，或账号已停用。' }); }
        auth.clearAttempts(key); auth.session(user, req, res, input.remember !== false); auth.recordLogin(req, user.username, true, user); auth.audit(user, 'auth.login'); await store.save();
        return json(res, 200, { user: safeUser(user) });
      }
      if (pathname.startsWith('/api/') || pathname.startsWith('/media/')) {
        if (!actor) return json(res, 401, { error: '请先登录。' });
        const personal = /\/favorite$|\/progress$/.test(pathname) || pathname === '/api/auth/password' || pathname === '/api/auth/logout';
        const requiresAdmin = pathname.startsWith('/api/admin/') || pathname === '/api/sources' || pathname.startsWith('/api/sources/') || pathname === '/api/sync' || /\/(match|enrich|file|genres|facts)$/.test(pathname) || pathname === '/api/movies/genres/batch' || pathname === '/api/openapi.json';
        if (requiresAdmin && actor.user.role !== 'admin') return json(res, 403, { error: '此操作需要管理员权限。' });
        if (actor.token) {
          if (!isLoopback(req.socket.remoteAddress)) return json(res, 403, { error: '调试令牌仅允许从服务器本机调用。' });
          const allowedRead = actor.token.scope === 'classify'
            ? req.method === 'GET' && ['/api/library', '/api/job', '/api/openapi.json'].includes(pathname)
            : req.method === 'GET' && ['/api/library', '/api/job', '/api/admin/diagnostics', '/api/admin/audit', '/api/openapi.json'].includes(pathname) || req.method === 'POST' && /^\/api\/movies\/[^/]+\/match$/.test(pathname);
          const allowedWrite = actor.token.scope === 'write' && req.method === 'POST' && (pathname === '/api/sync' || /^\/api\/movies\/[^/]+\/enrich$/.test(pathname));
          const allowedClassify = ['write', 'classify'].includes(actor.token.scope) && req.method === 'POST' && (/^\/api\/movies\/[^/]+\/genres$/.test(pathname) || pathname === '/api/movies/genres/batch');
          const allowedFacts = ['write', 'classify'].includes(actor.token.scope) && req.method === 'POST' && /^\/api\/movies\/[^/]+\/facts$/.test(pathname);
          if ((!allowedRead && !allowedWrite && !allowedClassify && !allowedFacts) || personal) return json(res, 403, { error: '该令牌不允许访问此接口。' });
        }
      }
      const user = actor?.user, profile = user ? auth.profile(user.id) : { favorites: {}, history: {} };
      // Apply authorization before any movie read/write or media handler, not just the catalog UI.
      const requestedMovie = pathname.match(/^\/api\/movies\/([^/]+)(?:\/|$)/) || pathname.match(/^\/media\/([^/]+)\/(?:poster|backdrop|video|actor)$/);
      if (requestedMovie && user?.role !== 'admin' && pathname !== '/api/movies/genres/batch'
          && !canViewMovie(user, findMovie(requestedMovie[1]), state.libraries)) return json(res, 404, { error: '影片不存在或无权访问。' });
      if (req.method === 'POST' && pathname === '/api/auth/logout') { auth.logout(req, res); auth.audit(user, 'auth.logout'); await store.save(); return json(res, 200, { ok: true }); }
      if (req.method === 'POST' && pathname === '/api/auth/heartbeat') return json(res, 200, { ok: true });
      if (req.method === 'POST' && pathname === '/api/auth/password') {
        const input = await body(req); if (!await verifyPassword(input.currentPassword, user.passwordHash)) throw new Error('当前密码不正确。');
        user.passwordHash = await hashPassword(input.password); user.authVersion++; auth.logout(req, res); auth.audit(user, 'auth.password'); await store.save(); return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && pathname === '/api/admin/users') return json(res, 200, { users: auth.userSummaries() });
      if (['POST', 'DELETE'].includes(req.method) && pathname === '/api/admin/actors/portrait') {
        if (actor.token || !actor.session) return json(res, 403, { error: '请使用管理员网页会话上传头像。' });
        const inputName = url.searchParams.get('name') || '', name = clean(inputName, 100), key = actorKey(name);
        if (!name || inputName.length > 100 || !state.movies.some(m => movieActors(m).some(a => actorKey(a) === key))) return json(res, 404, { error: '请先选择已导入影片中的演员。' });
        if (portraitBusy) return json(res, 409, { error: '已有头像正在保存，请稍后重试。' });
        portraitBusy = true;
        const previous = state.actorPortraits;
        try {
          const photo = req.method === 'POST' ? await savePortraitFile(dataDir, await readPortrait(req)) : '';
          state.actorPortraits = [...previous.filter(p => actorKey(p.name) !== key), ...(photo ? [{ name, photo, updatedAt: new Date().toISOString() }] : [])];
          auth.audit(user, photo ? 'actor.portrait.upload' : 'actor.portrait.reset', 'ok', name);
          try { await store.save(); } catch (error) { state.actorPortraits = previous; throw error; }
          actorPortraitLookup = portraitMap(state.actorPortraits);
          return json(res, 200, { name, photo, reset: !photo });
        } finally { portraitBusy = false; }
      }
      if (req.method === 'GET' && pathname === '/api/admin/movie-backup') {
        if (actor.token || !actor.session || req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: '请在网站后台使用管理员账号下载备份。' });
        if (backingUp) return json(res, 429, { error: '已有备份正在下载，请稍后重试。' });
        backingUp = true;
        try { await sendMovieBackup(res, state, coversDir); }
        finally { backingUp = false; }
        return;
      }
      if (req.method === 'GET' && pathname === '/api/admin/logins') return json(res, 200, { users: auth.userSummaries(), sessions: auth.sessions(), events: state.loginEvents.slice(-100).reverse(), onlineWindowSeconds: 180 });
      const revokeSession = pathname.match(/^\/api\/admin\/sessions\/([^/]+)\/revoke$/);
      if (req.method === 'POST' && revokeSession) {
        if (!auth.revokeSession(revokeSession[1])) return json(res, 404, { error: '登录设备不存在或已退出。' });
        auth.audit(user, 'session.revoke', 'ok', revokeSession[1]); await store.save(); return json(res, 200, { ok: true });
      }
      const networkInfo = () => {
        const running = { port: server.address()?.port || listenConfig.port, allowLan: listenConfig.allowLan, enableIpv6: ipv6Server.listening, enableDiscovery: listenConfig.enableDiscovery };
        return { saved: state.network, running, discovery: { status: discovery.status, error: discovery.error, port: discovery.port }, portOverride: !!portOverride, restartRequired: running.port !== state.network.port || running.allowLan !== state.network.allowLan || running.enableIpv6 !== state.network.enableIpv6 || running.enableDiscovery !== state.network.enableDiscovery,
          urls: accessUrls(running), canShutdown };
      };
      if (req.method === 'GET' && pathname === '/api/admin/network') return json(res, 200, networkInfo());
      if (pathname === '/api/admin/shutdown') {
        if (req.method !== 'POST') return json(res, 405, { error: '只能从管理员设置确认关闭。' });
        if (!actor.session || req.headers.origin !== url.origin || req.headers['sec-fetch-site'] === 'cross-site') {
          return json(res, 403, { error: '请在当前网站的管理员设置中关闭。' });
        }
        const input = await body(req);
        if (input?.confirm !== true) return json(res, 400, { error: '请确认要关闭网站。' });
        if (!canShutdown) return json(res, 503, { error: '当前启动方式不支持网页关闭，请使用启动器停止服务。' });
        if (closing || backingUp || relocating || job.status === 'running') {
          return json(res, 409, { error: '正在关闭、扫描、迁移或备份。请等待当前操作完成后重试。' });
        }
        const current = auth.actor(req);
        if (current?.user.role !== 'admin' || !current.session) return json(res, 403, { error: '管理员会话已失效。' });
        closing = true;
        try {
          auth.audit(current.user, 'service.shutdown', 'requested');
          await store.save();
        } catch (error) { closing = false; throw error; }
        // Do not close the socket until the acceptance response has been sent.
        let requested = false;
        const stop = () => {
          if (requested) return;
          requested = true;
          setImmediate(onShutdown);
        };
        res.once('finish', stop);
        res.once('close', stop);
        res.setHeader('Connection', 'close');
        json(res, 202, { message: '已收到关闭请求。网站将断开所有设备；需要时请在服务器上重新启动。' });
        if (res.destroyed) stop();
        return;
      }
      if (req.method === 'POST' && pathname === '/api/admin/network') {
        const input = await body(req), updated = networkSettings(input, state.network);
        if (updated.allowLan && !state.network.allowLan && input.confirmLan !== true) throw new Error('请确认已了解局域网开放范围与 HTTP 登录风险。');
        if (updated.allowLan && updated.enableIpv6 && !(state.network.allowLan && state.network.enableIpv6) && input.confirmIpv6 !== true)
          throw new Error('请确认 IPv6 网络监听可能包含公网地址；HTTP 不加密，且本程序不会修改防火墙。');
        state.network = updated; auth.audit(user, 'network.save'); await store.save();
        return json(res, 200, { ...networkInfo(), message: '已保存。停止并重新启动服务后生效；不会自动修改防火墙。' });
      }
      if (req.method === 'GET' && pathname === '/api/preferences') return json(res, 200, preferences({}, profile.preferences));
      if (req.method === 'POST' && pathname === '/api/preferences') {
        profile.preferences = preferences(await body(req), profile.preferences); await store.save(); return json(res, 200, profile.preferences);
      }
      if (req.method === 'POST' && pathname === '/api/admin/users') {
        const input = await body(req); if (state.users.length >= 100) throw new Error('最多创建 100 个用户。');
        const access = libraryAccess(input.libraryAccess);
        const created = await makeUser(input, input.role === 'admin' ? 'admin' : 'user');
        // Re-check after hashing so two concurrent requests cannot create duplicate usernames.
        if (state.users.some(u => u.username === created.username)) throw new Error('该用户名已存在。');
        created.enabled = input.enabled !== false;
        created.libraryAccess = access;
        state.users.push(created); auth.audit(user, 'user.create', 'ok', created.id); await store.save(); return json(res, 201, safeUser(created));
      }
      const editUser = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
      if (req.method === 'POST' && editUser) {
        const input = await body(req), target = state.users.find(u => u.id === editUser[1]);
        if (!target) return json(res, 404, { error: '用户不存在。' });
        const newRole = input.role === undefined ? target.role : input.role === 'admin' ? 'admin' : 'user';
        const enabled = input.enabled === undefined ? target.enabled : input.enabled === true;
        const access = libraryAccess(input.libraryAccess === undefined ? target.libraryAccess : input.libraryAccess);
        if (Array.isArray(target.libraryAccess?.sourceIds) && access.sourceIds === null && input.confirmLibraryMigration !== true)
          throw new Error('请确认将旧版来源限制替换为自定义影片库权限。');
        const passwordHash = input.password ? await hashPassword(input.password) : null;
        if (target.role === 'admin' && target.enabled && (!enabled || newRole !== 'admin') && state.users.filter(u => u.role === 'admin' && u.enabled).length <= 1) throw new Error('不能停用或降级最后一个管理员。');
        target.role = newRole; target.enabled = enabled; target.libraryAccess = access; if (input.displayName) target.displayName = clean(input.displayName, 50);
        if (passwordHash) target.passwordHash = passwordHash; target.authVersion++;
        auth.audit(user, passwordHash ? 'user.password-reset' : 'user.update', 'ok', target.id); await store.save(); return json(res, 200, safeUser(target));
      }
      if (req.method === 'GET' && pathname === '/api/admin/tokens') return json(res, 200, { tokens: state.apiTokens.map(({ hash, authVersion, ...t }) => t) });
      if (req.method === 'POST' && pathname === '/api/admin/tokens') {
        const result = auth.issueToken(user, await body(req)); auth.audit(user, 'token.create', 'ok', result.token.id); await store.save();
        return json(res, 201, { token: result.raw, id: result.token.id, expiresAt: result.token.expiresAt });
      }
      const revokeToken = pathname.match(/^\/api\/admin\/tokens\/([^/]+)$/);
      if (req.method === 'DELETE' && revokeToken) {
        const token = state.apiTokens.find(t => t.id === revokeToken[1]); if (!token) throw new Error('令牌不存在。');
        token.revoked = true; auth.audit(user, 'token.revoke', 'ok', token.id); await store.save(); return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && pathname === '/api/openapi.json') return json(res, 200, { ...openapi, servers: [{ url: url.origin }] });
      if (req.method === 'GET' && pathname === '/api/admin/diagnostics') return json(res, 200, { app: 'screen-room', version: '1.6.1', node: process.version, platform: process.platform, uptime: Math.round(process.uptime()),
        users: state.users.length, sources: state.sources.length, movies: state.movies.length, job: { status: job.status, found: job.found, folders: job.folders }, updatedAt: state.updatedAt, externalCredentials: { tmdbConfigured: state.sources.some(s => s.provider === 'tmdb' && !!s.token) },
        capabilities: ['nas-scan', 'nfo', 'range-streaming', 'tmdb-match', 'roles', 'scoped-debug-token', 'manual-genres', 'windows-external-player', 'unified-settings', 'full-site-theme', 'random-nine', 'ai-classification', 'metadata-facets', 'local-comments', 'random-page', 'duration-probe', 'actor-gallery', 'tv-episodes', 'release-date', 'ipv6-dual-stack', 'lan-discovery', 'mobile-playback-ticket'], transcoding: false });
      if (req.method === 'GET' && pathname === '/api/admin/audit') return json(res, 200, { events: state.audit.slice(-100).reverse() });
      if (actor && req.method !== 'GET' && req.method !== 'HEAD' && !/\/(progress|favorite)$/.test(pathname)) auth.audit(user, `api.${req.method.toLowerCase()}`, 'requested', pathname.replace(/[^/]+$/, ':id'));
      if (req.method === 'GET' && pathname === '/api/library') {
        const visible = getMovies().filter(movieAccess(user, state.libraries)), ids = new Set(visible.map(m => m.id));
        return json(res, 200, { movies: visible.map(m => actor.token ? toolMovie(m) : exposedMovie(m, profile.favorites)),
          libraries: visibleLibraries(user, state.libraries).map(l => ({ ...l, count: visible.filter(m => l.sourceIds.includes(m.sourceId)).length })),
          unassignedSourceIds: user.role === 'admin' && !actor.token ? state.sources.filter(s => !state.libraries.some(l => l.sourceIds.includes(s.id))).map(s => s.id) : undefined,
          sources: state.sources.filter(s => canViewSource(user, s, state.libraries)).map(s => user.role === 'admin' && !actor.token ? safeSource(s) : { id: s.id, type: s.type, name: s.name, count: visible.filter(m => m.sourceId === s.id).length }),
          history: actor.token ? {} : Object.fromEntries(Object.entries(profile.history || {}).filter(([id]) => ids.has(id))), preferences: actor.token ? undefined : preferences({}, profile.preferences),
          canLaunchLocalPlayer: !actor.token && isLoopback(req.socket.remoteAddress), user: actor.token ? undefined : safeUser(user), isDemo: getMovies() === demo && visible.length > 0, updatedAt: state.updatedAt, job: user.role === 'admin' && !actor.token ? job : { status: job.status } });
      }
      if (req.method === 'GET' && pathname === '/api/admin/libraries') return json(res, 200, { libraries: state.libraries });
      if (req.method === 'POST' && pathname === '/api/admin/libraries') {
        const updated = planLibrary(state.libraries, state.sources, await body(req));
        const previous = state.libraries;
        state.libraries = previous.some(l => l.id === updated.id) ? previous.map(l => l.id === updated.id ? updated : l) : [...previous, updated];
        auth.audit(user, 'library.save', 'ok', updated.id);
        try { await store.save(); } catch (error) { state.libraries = previous; throw error; }
        return json(res, 200, updated);
      }
      const deleteLibrary = pathname.match(/^\/api\/admin\/libraries\/([^/]+)$/);
      if (req.method === 'DELETE' && deleteLibrary) {
        const input = await body(req), previous = state.libraries, target = previous.find(l => l.id === deleteLibrary[1]);
        if (!target) return json(res, 404, { error: '影片库不存在。' });
        if (input.confirm !== true || input.revision !== (target.revision || 1)) return json(res, 409, { error: '请刷新后确认移除此影片库。' });
        state.libraries = previous.filter(l => l !== target);
        auth.audit(user, 'library.delete', 'ok', target.id);
        try { await store.save(); } catch (error) { state.libraries = previous; throw error; }
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && pathname === '/api/job') return json(res, 200, user.role === 'admin' && !actor.token ? job : { status: job.status });
      if (req.method === 'GET' && pathname === '/api/players') return json(res, 200, isLoopback(req.socket.remoteAddress) ? await playerService.list() : { supported: false, players: [], note: '局域网设备请使用网页播放，不能远程启动服务器电脑上的播放器。' });
      const mobilePlayback = pathname.match(/^\/api\/movies\/([^/]+)\/playback-ticket$/);
      if (req.method === 'POST' && mobilePlayback) {
        if (actor.token || !actor.session) return json(res, 403, { error: '需要浏览器账号登录。' });
        const movie = state.movies.find(m => m.id === mobilePlayback[1]);
        if (!movie || movie.kind !== 'local') return json(res, 400, { error: '此接口只用于本地 / NAS 视频。' });
        const input = await body(req);
        const episode = input.episodeId ? movie.episodes?.find(e => e.id === input.episodeId) : movie.episodes?.[0];
        if (input.episodeId && !episode) return json(res, 404, { error: '集数不存在。' });
        const filename = episode?.filePath || movie.filePath;
        if (!filename || !within(movie.rootPath, await fs.realpath(filename))) return json(res, 403, { error: '视频不可读取。' });
        const issued = playbackTickets.issue({ userId: user.id, authVersion: user.authVersion, sessionId: actor.session.id, movieId: movie.id, episodeId: episode?.id || '' });
        return json(res, 200, { url: `${url.origin}/play/${issued.token}`, expiresAt: new Date(issued.expiresAt).toISOString(), title: movie.title, mime: TYPES[path.extname(filename).toLowerCase()] || 'video/*' });
      }
      const relocation = pathname.match(/^\/api\/admin\/sources\/([^/]+)\/relocate$/);
      if (req.method === 'POST' && relocation) {
        const input = await body(req);
        if (relocating || job.status === 'running') return json(res, 409, { error: '请等待当前扫描或迁移完成。' });
        const source = state.sources.find(s => s.id === relocation[1] && s.type === 'local');
        if (!source) return json(res, 404, { error: '本地来源不存在。' });
        if (input?.confirm !== true) return json(res, 400, { error: '请先确认已把同一批文件放到新目录。' });
        relocating = true;
        try {
          const plan = await planLocalRelocation(source, state.movies.filter(m => m.sourceId === source.id), input.path);
          const old = { ...source }, undo = [];
          for (const movie of state.movies) {
            const fields = plan.updates.get(movie.id);
            if (movie.sourceId !== source.id || !fields) continue;
            undo.push([movie, Object.fromEntries(Object.keys(fields).map(key => [key, movie[key]]))]);
            Object.assign(movie, fields);
          }
          Object.assign(source, { path: plan.nextPath, identityRootPath: plan.identityRootPath, lastError: '' });
          if (typeof input.name === 'string') source.name = clean(input.name || source.name, 80);
          if (typeof input.category === 'string') source.category = clean(input.category, 40);
          try { await store.save(); }
          catch (error) { Object.assign(source, old, { identityRootPath: old.identityRootPath }); for (const [movie, fields] of undo) Object.assign(movie, fields); throw error; }
          return json(res, 200, { ...safeSource(source), moved: plan.updates.size });
        } finally { relocating = false; }
      }
      if (req.method === 'POST' && pathname === '/api/sources') {
        const input = await body(req);
        if (relocating || job.status === 'running') return json(res, 409, { error: '请等待当前扫描或迁移完成。' });
        const previous = state.sources.find(s => s.id === input.id);
        if (!previous && state.sources.length >= 10) throw new Error('最多添加 10 个来源。');
        const type = input.type === 'local' ? 'local' : 'api';
        const source = { ...previous, id: previous?.id || randomUUID(), type, name: clean(input.name || (type === 'local' ? '我的 NAS' : 'API 片库'), 80) };
        if (type === 'local') {
          source.path = String(input.path || '').trim(); source.category = clean(input.category, 40);
          if (previous?.type === 'local' && previous.path !== source.path && state.movies.some(m => m.sourceId === previous.id)) {
            return json(res, 409, { error: '该来源已有影片，请在后台使用「迁移目录」保留原资料。' });
          }
          if (!path.isAbsolute(source.path)) throw new Error('目录需要绝对路径，例如 Z:\\电影 或 \\\\NAS\\movies。');
        } else {
          source.provider = ['tmdb', 'generic', 'maccms'].includes(input.provider) ? input.provider : 'generic';
          source.url = String(input.url || '').trim();
          // Keep the original URL if the UI has only shown its redacted value.
          if (previous && source.url.includes('••••••')) source.url = previous.url;
          if (source.provider !== 'tmdb' && !webUrl(source.url)) throw new Error('请填写 http:// 或 https:// API 地址。');
          source.token = input.clearToken ? '' : (String(input.token || '').trim() || previous?.token || '');
          if (source.token.length > 10000 || /[\r\n]/.test(source.token)) throw new Error('访问令牌格式不正确。');
          source.pages = Math.max(1, Math.min(10, Number(input.pages) || 1));
        }
        if (previous) state.sources[state.sources.indexOf(previous)] = source; else state.sources.push(source);
        await store.save(); return json(res, 200, safeSource(source));
      }
      const sourceMatch = pathname.match(/^\/api\/sources\/([^/]+)$/);
      if (req.method === 'DELETE' && sourceMatch) {
        if (relocating) return json(res, 409, { error: '请等待目录迁移完成。' });
        if (job.status === 'running') throw new Error('请等待当前扫描完成。');
        const id = sourceMatch[1]; state.sources = state.sources.filter(s => s.id !== id); state.movies = state.movies.filter(m => m.sourceId !== id);
        state.libraries = state.libraries.map(l => l.sourceIds.includes(id) ? { ...l, sourceIds: l.sourceIds.filter(sourceId => sourceId !== id), revision: (l.revision || 1) + 1 } : l);
        await store.save(); return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && pathname === '/api/sync') {
        const input = await body(req); startSync(input.sourceId ? state.sources.filter(s => s.id === input.sourceId) : state.sources);
        return json(res, 202, job);
      }
      const favorite = pathname.match(/^\/api\/movies\/([^/]+)\/favorite$/);
      if (req.method === 'POST' && favorite) {
        if (!findMovie(favorite[1])) return json(res, 404, { error: '影片不存在。' });
        const input = await body(req); if (input.favorite) profile.favorites[favorite[1]] = true; else delete profile.favorites[favorite[1]];
        await store.save(); return json(res, 200, { favorite: !!profile.favorites[favorite[1]] });
      }
      const history = pathname.match(/^\/api\/movies\/([^/]+)\/progress$/);
      if (req.method === 'POST' && history) {
        if (!findMovie(history[1])) return json(res, 404, { error: '影片不存在。' });
        const input = await body(req);
        const position = Math.max(0, Math.min(1e7, Number(input.position) || 0));
        const duration = Math.max(0, Math.min(1e7, Number(input.duration) || 0));
        const movie = findMovie(history[1]);
        if (input.episodeId && !movie.episodes?.some(e => e.id === input.episodeId)) throw new Error('集数不存在。');
        profile.history[history[1]] = { position, duration, ...(input.episodeId ? { episodeId: input.episodeId } : {}), updatedAt: new Date().toISOString() };
        await store.save(); return json(res, 200, { ok: true });
      }
      const commentsRoute = pathname.match(/^\/api\/movies\/([^/]+)\/comments(?:\/([^/]+))?$/);
      if (commentsRoute) {
        const [, movieId, commentId] = commentsRoute;
        if (!findMovie(movieId)) return json(res, 404, { error: '影片不存在。' });
        if (req.method === 'GET' && !commentId) {
          const all = state.comments.filter(c => c.movieId === movieId).reverse();
          const page = Math.max(1, Math.min(100, Number(url.searchParams.get('page')) || 1));
          const offset = (Math.floor(page) - 1) * 50;
          return json(res, 200, { total: all.length, page: Math.floor(page), hasMore: all.length > offset + 50, comments: all.slice(offset, offset + 50).map(c => publicComment(c, state.users, user)) });
        }
        if (req.method === 'POST' && !commentId) {
          const input = await body(req), comment = addComment(state.comments, movieId, user.id, input.text);
          auth.audit(user, 'comment.create', 'ok', comment.id); await store.save(); return json(res, 201, publicComment(comment, state.users, user));
        }
        if (req.method === 'DELETE' && commentId) {
          const comment = state.comments.find(c => c.id === commentId && c.movieId === movieId);
          if (!comment) return json(res, 404, { error: '评论不存在。' });
          if (user.role !== 'admin' && comment.userId !== user.id) return json(res, 403, { error: '只能删除自己的评论。' });
          state.comments = state.comments.filter(c => c !== comment); auth.audit(user, 'comment.delete', 'ok', commentId); await store.save(); return json(res, 200, { ok: true });
        }
        return json(res, 405, { error: '不支持的评论操作。' });
      }
      const factsRoute = pathname.match(/^\/api\/movies\/([^/]+)\/facts$/);
      if (req.method === 'POST' && factsRoute) {
        if (job.status === 'running') throw new Error('请等待扫描结束再修改资料。');
        const movie = state.movies.find(m => m.id === factsRoute[1]);
        if (!movie) return json(res, 404, { error: '示例片库不可编辑，请先导入自己的影片。' });
        const facts = editableFacts(await body(req));
        const { actorPhotos, metadataGenres, ...restFacts } = facts;
        movie.manualFacts = { ...movie.manualFacts, ...restFacts }; applyManualFacts(movie);
        if (metadataGenres) {
          movie.metadataGenres = [...metadataGenres];
          if (!Array.isArray(movie.manualGenres)) { movie.autoGenres = [...metadataGenres]; movie.genres = [...metadataGenres]; }
        }
        if (actorPhotos) {
          const portraitNames = [...new Set([...names(movie.cast || ''), ...Object.keys(actorPhotos)])];
          movie.actors = portraitNames.map(name => ({ name, photo: actorPhotos[name] || '' }));
        }
        auth.audit(user, 'movie.facts', 'ok', movie.id); await store.save(); return json(res, 200, exposedMovie(movie, profile.favorites));
      }
      const originalFile = pathname.match(/^\/api\/movies\/([^/]+)\/file$/);
      if (req.method === 'POST' && originalFile) {
        const movie = state.movies.find(m => m.id === originalFile[1]);
        if (!movie?.filePath) return json(res, 404, { error: '本地视频不存在。' });
        const input = await body(req), episode = input.episodeId ? movie.episodes?.find(e => e.id === input.episodeId) : movie.episodes?.[0];
        if (input.episodeId && !episode) throw new Error('集数不存在。');
        return json(res, 200, { path: episode?.filePath || movie.filePath });
      }
      if (req.method === 'POST' && pathname === '/api/movies/genres/batch') {
        if (job.status === 'running') throw new Error('请等待扫描结束再修改分类。');
        const input = await body(req), plan = genrePlan(state.movies, input.updates);
        if (input.dryRun !== undefined && typeof input.dryRun !== 'boolean') throw new Error('dryRun 需要是布尔值。');
        const dryRun = input.dryRun !== false;
        if (!dryRun) {
          const updates = new Map(plan.map(p => [p.movie.id, p.movie]));
          const previous = state.movies; state.movies = state.movies.map(m => updates.get(m.id) || m);
          auth.audit(user, 'movie.genres.batch', 'ok', String(plan.length));
          try { await store.save(); } catch (error) { state.movies = previous; throw error; }
        }
        return json(res, 200, { dryRun, count: plan.length, changes: plan.map(p => p.change) });
      }
      const editGenres = pathname.match(/^\/api\/movies\/([^/]+)\/genres$/);
      if (req.method === 'POST' && editGenres) {
        if (job.status === 'running') throw new Error('请等待扫描结束再修改分类。');
        const movie = state.movies.find(m => m.id === editGenres[1]);
        if (!movie) return json(res, 404, { error: '请先导入自己的影片，示例片库不可编辑。' });
        setGenres(movie, await body(req));
        auth.audit(user, 'movie.genres', 'ok', movie.id); await store.save();
        return json(res, 200, actor.token ? toolMovie(movie) : exposedMovie(movie, profile.favorites));
      }
      const openExternal = pathname.match(/^\/api\/movies\/([^/]+)\/open-external$/);
      if (req.method === 'POST' && openExternal) {
        if (!isLoopback(req.socket.remoteAddress)) return json(res, 403, { error: '只能在服务器本机启动外部播放器，局域网设备请使用网页播放。' });
        const movie = state.movies.find(m => m.id === openExternal[1]);
        if (!movie) return json(res, 404, { error: '影片不存在，示例电影不包含视频。' });
        const input = await body(req);
        if (lastPlayerLaunch && Date.now() - lastPlayerLaunch < 2000) return json(res, 429, { error: '已发送打开请求，请稍等再试。' });
        const target = {};
        if (movie.filePath) {
          const episode = input.episodeId ? movie.episodes?.find(e => e.id === input.episodeId) : movie.episodes?.[0];
          if (input.episodeId && !episode) throw new Error('集数不存在。');
          const actual = await fs.realpath(episode?.filePath || movie.filePath);
          if (!within(movie.rootPath, actual)) return json(res, 403, { error: '文件超出已授权片库。' });
          if (!(await fs.stat(actual)).isFile()) throw new Error('视频文件不存在。');
          target.filePath = actual;
        } else {
          const index = input.streamIndex ?? 0;
          if (!Number.isInteger(index) || index < 0 || !movie.streams?.[index]) throw new Error('请选择有效的播放线路。');
          target.url = movie.streams[index].url;
        }
        // A launch is reserved before awaiting the OS to prevent double-click races.
        const reserved = Date.now(); lastPlayerLaunch = reserved;
        try {
          const result = await playerService.open(target, input.player || 'default');
          auth.audit(user, 'player.open', 'ok', movie.id); await store.save(); return json(res, 200, result);
        } catch (error) { if (lastPlayerLaunch === reserved) lastPlayerLaunch = 0; throw error; }
      }
      const match = pathname.match(/^\/api\/movies\/([^/]+)\/(match|enrich)$/);
      if (req.method === 'POST' && match) {
        if (job.status === 'running') throw new Error('扫描期间暂不能修改影片资料。');
        const movie = state.movies.find(m => m.id === match[1]);
        if (!movie) throw new Error('请先导入自己的片库。');
        if (movie.mediaType === 'tv') throw new Error('电视剧请使用 tvshow.nfo 或自己的资料接口；电影匹配接口不适用于电视剧。');
        const tmdb = state.sources.find(s => s.provider === 'tmdb' && s.token);
        if (!tmdb) throw new Error('请先在「左下角设置 → 片库来源 → API 接口」添加 TMDB 读取访问令牌。');
        if (match[2] === 'match') {
          const input = await body(req);
          const query = new URLSearchParams({ query: clean(input.query || movie.title, 200), language: 'zh-CN', include_adult: 'false' });
          const results = await fetchJson(`https://api.themoviedb.org/3/search/movie?${query}`, tmdb.token, fetcher);
          return json(res, 200, { results: (results.results || []).slice(0, 6).map(m => ({ id: m.id, title: clean(m.title), year: m.release_date?.slice(0, 4), overview: clean(m.overview, 250), poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : '' })) });
        }
        const input = await body(req);
        if (!/^\d+$/.test(String(input.tmdbId))) throw new Error('无效的 TMDB 影片 ID。');
        const detail = await fetchJson(`https://api.themoviedb.org/3/movie/${input.tmdbId}?language=zh-CN&append_to_response=credits`, tmdb.token, fetcher);
        movie.title = clean(detail.title) || movie.title; movie.originalTitle = clean(detail.original_title); movie.overview = clean(detail.overview, 6000) || movie.overview;
        movie.year = Number(detail.release_date?.slice(0, 4)) || movie.year;
        movie.releaseDate = releaseDate(detail.release_date);
        const importedGenres = detail.genres?.map(g => clean(g.name, 40)).filter(Boolean);
        movie.metadataGenres = importedGenres?.length ? importedGenres : movie.metadataGenres || [];
        movie.genres = importedGenres?.length ? importedGenres : movie.autoGenres || [];
        preserveGenres(movie, movie); movie.rating = Number(detail.vote_average) || null;
        movie.director = (detail.credits?.crew || []).filter(p => p.job === 'Director').map(p => clean(p.name)).join(' / ');
        movie.cast = (detail.credits?.cast || []).slice(0, 64).map(p => clean(p.name)).join(' / ');
        movie.actors = actorProfiles((detail.credits?.cast || []).slice(0, 64));
        movie.duration = detail.runtime ? `${detail.runtime} 分钟` : '';
        movie.studios = names(detail.production_companies);
        movie.series = names(detail.belongs_to_collection);
        applyManualFacts(movie);
        if (detail.poster_path) movie.poster = `https://image.tmdb.org/t/p/w500${detail.poster_path}`;
        if (detail.backdrop_path) movie.backdrop = `https://image.tmdb.org/t/p/w1280${detail.backdrop_path}`;
        movie.tmdbId = detail.id; await store.save(); return json(res, 200, exposedMovie(movie, profile.favorites));
      }
      const cachedCover = pathname.match(/^\/media\/covers\/([A-Za-z0-9_-]+)\.(jpg|jpeg|png|webp)$/i);
      if (['GET', 'HEAD'].includes(req.method) && cachedCover) {
        if (user.role !== 'admin' && !getMovies().some(m => canViewMovie(user, m, state.libraries) && referencesImage(m, pathname, actorPortraitLookup))) return json(res, 404, { error: '封面不存在或无权访问。' });
        const file = path.join(coversDir, `${cachedCover[1]}.${cachedCover[2].toLowerCase()}`);
        if (!existsSync(file)) return json(res, 404, { error: '封面不存在。' });
        return await sendFile(req, res, await fs.realpath(file), true);
      }
      const cachedAvatar = pathname.match(/^\/media\/actors\/([A-Za-z0-9_-]+)\.(jpg|jpeg|png|webp)$/i);
      if (['GET', 'HEAD'].includes(req.method) && cachedAvatar) {
        if (user.role !== 'admin' && !getMovies().some(m => canViewMovie(user, m, state.libraries) && referencesImage(m, pathname, actorPortraitLookup))) return json(res, 404, { error: '头像不存在或无权访问。' });
        const file = path.join(actorsDir, `${cachedAvatar[1]}.${cachedAvatar[2].toLowerCase()}`);
        if (!existsSync(file)) return json(res, 404, { error: '头像不存在。' });
        return await sendFile(req, res, await fs.realpath(file), true);
      }
      const media = pathname.match(/^\/media\/([^/]+)\/(poster|backdrop|video|actor)$/);
      if (['GET', 'HEAD'].includes(req.method) && media) {
        const movie = state.movies.find(m => m.id === media[1]);
        const episodeId = url.searchParams.get('episode');
        const episode = episodeId ? movie?.episodes?.find(e => e.id === episodeId) : movie?.episodes?.[0];
        if (media[2] === 'video' && episodeId && !episode) return json(res, 404, { error: '集数不存在。' });
        const photoIndex = Number(url.searchParams.get('index'));
        const filename = movie && (media[2] === 'video' ? episode?.filePath || movie.filePath : media[2] === 'actor' ? Number.isInteger(photoIndex) && photoIndex >= 0 ? movie.actorPhotoFiles?.[photoIndex]?.filePath : null : movie[{ poster: 'posterFile', backdrop: 'backdropFile' }[media[2]]]);
        if (!filename) return json(res, 404, { error: '文件不存在。' });
        const actual = await fs.realpath(filename);
        if (!within(movie.rootPath, actual)) return json(res, 403, { error: '文件超出已授权片库。' });
        return await sendFile(req, res, actual, true);
      }
      if (pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(req.method)) return json(res, 404, { error: '接口不存在。' });
      const target = path.resolve(PUBLIC, `.${['/', '/random', '/random/', '/admin', '/admin/'].includes(pathname) ? '/index.html' : pathname}`);
      if (!within(PUBLIC, target)) return json(res, 403, { error: '禁止访问。' });
      const actual = await fs.realpath(target);
      if (!within(PUBLIC, actual)) return json(res, 403, { error: '禁止访问。' });
      await sendFile(req, res, actual);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      const code = error.status || (error.code === 'ENOENT' ? 404 : ['EACCES', 'EPERM'].includes(error.code) ? 403 : 400);
      const message = code === 404 ? '文件不存在或 NAS 已断开。' : ['EACCES', 'EPERM'].includes(error.code) ? '文件访问被拒绝，请联系管理员检查 NAS 权限。' : error.code ? '本地文件或请求处理失败，请联系管理员检查服务。' : error.message || '请求失败。';
      json(res, code, { error: message });
    }
  };
  function requestHandler(req, res) {
    const task = handleRequest(req, res);
    requests.add(task);
    void task.then(() => requests.delete(task), error => { requests.delete(task); res.destroy(error); });
  }
  const server = http.createServer(requestHandler), ipv6Server = http.createServer(requestHandler);
  const clearAuthTimer = () => { if (!server.listening && !ipv6Server.listening) clearTimeout(authSaveTimer); };
  server.on('close', clearAuthTimer); ipv6Server.on('close', clearAuthTimer);
  async function flush() {
    if (authSaveTimer) {
      clearTimeout(authSaveTimer); authSaveTimer = null;
      await store.save();
    }
    await store.flush();
  }
  function shutdown() {
    closing = true;
    return shutdownTask ??= (async () => {
      const results = await Promise.allSettled([discovery.close(), closeListeners({ server, ipv6Server })]);
      await Promise.allSettled(requests);
      await syncTask;
      await flush();
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    })();
  }
  return { server, ipv6Server, store, listenConfig, discovery, flush, shutdown, getJob: () => relocating ? { status: 'running' } : job };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createApp({ portOverride: process.env.PORT, onShutdown: () => stop() });
  const stop = () => { app.shutdown().catch(() => { console.error('关闭服务时保存或清理失败。'); process.exitCode = 1; }); };
  const { listenConfig } = app;
  try {
    const port = await startListening(app);
    await startDiscovery({ ...listenConfig, httpPort: port, state: app.discovery });
    const url = `http://127.0.0.1:${port}`;
    console.log(`\n  幕间 SCREEN ROOM\n  电影网站已启动：${url}\n  ${listenConfig.allowLan ? `允许网络访问（所有 IPv4${listenConfig.enableIpv6 ? ' / IPv6' : ''} 接口，可能包含公网地址），请检查防火墙` : '仅限本机访问'} · IPv6 ${listenConfig.enableIpv6 ? '已启用' : '未启用'} · Ctrl+C 停止\n`);
    for (const address of accessUrls({ ...listenConfig, port }).slice(1)) console.log(`  访问地址：${address}`);
    if (app.discovery.status === 'error') console.warn('  App 自动搜索不可用，请手动填写服务器地址。');
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    if (process.argv.includes('--open')) {
      if (process.platform === 'win32') spawn('explorer.exe', [url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    }
  } catch (error) {
    console.error(error.code === 'EADDRINUSE' ? `端口 ${listenConfig.port} 的 IPv4 或 IPv6 地址已被占用，已停止全部监听。请关闭旧进程或更换端口。`
      : ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT'].includes(error.code) ? '当前系统无法启用 IPv6，已停止全部监听。请检查系统 IPv6 支持，或将 data/library.json 中 network.enableIpv6 改为 false 后启动。'
      : `服务启动失败，已停止全部监听：${error.message}`);
    process.exitCode = 1;
  }
}
