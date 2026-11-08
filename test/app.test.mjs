import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createApp } from '../server.mjs';
import { normalizeMovie, publicMovie } from '../lib/catalog.mjs';
import { inferName, parseNfo, scanDirectory, within } from '../lib/scanner.mjs';
import { extractList, fetchSource, fetchJson } from '../lib/providers.mjs';
import { createStore } from '../lib/store.mjs';

test('电影字段规范化、去除 HTML、拒绝危险媒体协议', () => {
  const movie = normalizeMovie({ vod_id: 12, vod_name: '<b>测试电影</b>', vod_pic: 'javascript:alert(1)', vod_year: '2024', type_name: '剧情,科幻', vod_score: '8.8', vod_content: '<p>剧情</p>', vod_play_from: 'direct', vod_play_url: '正片$https://example.com/a.mp4#恶意$javascript:alert(1)$$$备用$https://example.com/b.mp4' }, 'source');
  assert.equal(movie.title, '测试电影'); assert.equal(movie.poster, ''); assert.equal(movie.year, 2024);
  assert.deepEqual(movie.genres, ['剧情', '科幻']); assert.equal(movie.streams.length, 2); assert.equal(movie.overview, '剧情');
  assert.equal(normalizeMovie({}, 'x'), null);
  const safe = publicMovie({ ...movie, filePath: '/private/movie.mkv', rootPath: '/private', posterFile: '/private/poster.jpg' });
  assert.equal(safe.filePath, undefined); assert.equal(safe.rootPath, undefined); assert.equal(safe.playable, true); assert.match(safe.poster, /^\/media\//);
});

test('文件名推断、NFO 元数据与目录边界', () => {
  assert.deepEqual(inferName('Interstellar.2014.1080p.BluRay.mkv'), { title: 'Interstellar', year: 2014 });
  assert.deepEqual(inferName('星际穿越 (2014).mp4'), { title: '星际穿越', year: 2014 });
  const nfo = parseNfo('<movie><title>星际穿越</title><plot><![CDATA[剧情 &amp; 简介]]></plot><year>2014</year><rating>8.7</rating><genre>科幻</genre><genre>冒险</genre><actor><name>演员</name></actor></movie>');
  assert.equal(nfo.title, '星际穿越'); assert.equal(nfo.overview, '剧情 & 简介'); assert.deepEqual(nfo.genres, ['科幻', '冒险']); assert.equal(nfo.cast, '演员');
  assert.equal(within(path.resolve('test'), path.resolve('test/a.mp4')), true);
  assert.equal(within(path.resolve('test'), path.resolve('test-other/a.mp4')), false);
});

test('API JSON 适配、分页去重与错误处理', async () => {
  assert.deepEqual(extractList({ data: { list: [1] } }), [1]); assert.throws(() => extractList({ code: 0 }), /影片数组/);
  const calls = [];
  const fake = async (url, options) => { calls.push([url, options]); return new Response(JSON.stringify({ list: [{ vod_id: 1, vod_name: '电影', vod_pic: 'https://example.com/poster.jpg', type_name: '剧情' }], pagecount: 2 })); };
  const result = await fetchSource({ id: 'api', provider: 'maccms', url: 'https://example.com/api.php?x=1', token: 'test-token', pages: 2 }, fake);
  assert.equal(result.movies.length, 1); assert.equal(calls.length, 2); assert.match(calls[1][0], /pg=2/); assert.equal(calls[0][1].headers.Authorization, 'Bearer test-token');
  await assert.rejects(fetchJson('https://example.com', '', async () => new Response('no', { status: 401 })), /401/);
  await assert.rejects(fetchJson('https://example.com', '', async () => new Response('not json')), /有效 JSON/);
  await assert.rejects(fetchJson('file:///private'), /API 地址/);
});

test('TMDB 热门资料适配', async () => {
  const fake = async url => new Response(JSON.stringify(url.includes('/genre/') ? { genres: [{ id: 878, name: '科幻' }] } : { results: [{ id: 1, title: '星际', genre_ids: [878], poster_path: '/test.jpg', vote_average: 8.2 }], total_pages: 1 }));
  const { movies } = await fetchSource({ id: 'tmdb', provider: 'tmdb', token: 'fixture', pages: 1 }, fake);
  assert.deepEqual(movies[0].genres, ['科幻']); assert.equal(movies[0].poster, 'https://image.tmdb.org/t/p/w500/test.jpg'); assert.equal(movies[0].streams.length, 0);
});

test('损坏的片库文件不被静默覆盖', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'screen-room-corrupt-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'library.json'), 'invalid'); await assert.rejects(createStore(dir), /片库文件损坏/);
  assert.equal(await fs.readFile(path.join(dir, 'library.json'), 'utf8'), 'invalid');
});

test('本地/NAS 扫描、API 集成、Range 播放与持久化', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'screen-room-test-'));
  const mediaRoot = path.join(dir, 'movies'), movieDir = path.join(mediaRoot, '科幻');
  await fs.mkdir(movieDir, { recursive: true });
  const original = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
  const videoPath = path.join(movieDir, 'Interstellar.2014.mp4');
  await fs.writeFile(videoPath, original); await fs.writeFile(path.join(movieDir, 'poster.jpg'), Buffer.from([255, 216, 255, 217]));
  await fs.writeFile(path.join(movieDir, 'movie.nfo'), '<movie><title>星际穿越</title><year>2014</year><genre>科幻</genre><rating>8.7</rating><plot>测试简介</plot></movie>');
  await fs.writeFile(path.join(movieDir, 'ignore.txt'), 'ignore');
  const scan = await scanDirectory({ id: 'fixture', path: mediaRoot });
  assert.equal(scan.movies.length, 1); assert.equal(scan.movies[0].title, '星际穿越'); assert.ok(scan.movies[0].posterFile);
  const dataDir = path.join(dir, 'data');
  const launched = [];
  const app = await createApp({ dataDir, playerService: { list: async () => ({ supported: true, players: [{ id: 'default', name: '测试播放器' }] }), open: async (target, player) => { launched.push({ target, player }); return { message: '测试启动请求已发送' }; } }, fetcher: async url => new Response(JSON.stringify(url.includes('/search/') ? { results: [{ id: 123, title: '星际穿越', release_date: '2014-11-01' }] } : { id: 123, title: '星际穿越（匹配）', original_title: 'Interstellar', genres: [{ name: '科幻' }], overview: '匹配简介', vote_average: 8.6, credits: { cast: [], crew: [] } })) });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = '';
  const request = async (url, data, method = 'POST', headers = {}) => fetch(`${base}${url}`, data === undefined ? { headers: { Cookie: cookie, ...headers } } : { method, headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Cinema-Client': 'local', ...headers }, body: JSON.stringify(data) });
  assert.equal((await request('/api/library')).status, 401);
  assert.equal((await (await request('/api/auth/me')).json()).needsSetup, true);
  const setup = await request('/api/auth/setup', { username: 'test-admin', displayName: '管理员', password: 'a' });
  assert.equal(setup.status, 201); cookie = setup.headers.get('set-cookie').split(';')[0];
  const adminUser = (await setup.json()).user;
  assert.equal(adminUser.passwordHash, undefined);
  assert.equal((await request('/api/auth/setup', { username: 'second', password: 'fixture-password' })).status, 409);
  let library = await (await request('/api/library')).json(); assert.equal(library.isDemo, true); assert.equal(library.movies.length, 12);
  assert.equal((await request('/')).status, 200); assert.equal((await request('/data/library.json')).status, 404);
  assert.equal((await fetch(`${base}/api/sources`, { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await request('/api/sources', {}, 'POST', { Origin: 'https://malicious.example' })).status, 403);
  const source = await (await request('/api/sources', { type: 'local', name: 'Fixture NAS', path: mediaRoot })).json();
  assert.ok(source.id);
  async function sync(sourceId) {
    assert.equal((await request('/api/sync', { sourceId })).status, 202);
    for (let i = 0; i < 100; i++) { if (app.getJob().status !== 'running') break; await new Promise(r => setTimeout(r, 10)); }
    assert.equal(app.getJob().status, 'done');
  }
  await sync(source.id);
  library = await (await request('/api/library')).json(); assert.equal(library.isDemo, false); assert.equal(library.movies.length, 1);
  const movie = library.movies[0]; assert.equal(movie.title, '星际穿越'); assert.equal(movie.filePath, undefined);
  const range = await fetch(`${base}${movie.mediaUrl}`, { headers: { Cookie: cookie, Range: 'bytes=4-9' } });
  assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), 'bytes 4-9/36'); assert.equal(await range.text(), '456789');
  const suffix = await fetch(`${base}${movie.mediaUrl}`, { headers: { Cookie: cookie, Range: 'bytes=-3' } }); assert.equal(await suffix.text(), 'xyz');
  assert.equal((await fetch(`${base}${movie.mediaUrl}`, { headers: { Cookie: cookie, Range: 'bytes=999-' } })).status, 416);
  assert.equal((await fetch(`${base}${movie.mediaUrl}`, { method: 'HEAD', headers: { Cookie: cookie } })).headers.get('content-length'), '36');
  assert.equal((await fetch(`${base}${movie.poster}`, { headers: { Cookie: cookie } })).status, 200);
  await request(`/api/movies/${movie.id}/favorite`, { favorite: true });
  await request(`/api/movies/${movie.id}/progress`, { position: 20, duration: 100 });
  assert.equal((await (await request(`/api/movies/${movie.id}/file`, {})).json()).path, videoPath);
  const tmdb = await (await request('/api/sources', { type: 'api', provider: 'tmdb', token: 'private-fixture-token', name: 'TMDB' })).json();
  assert.equal(tmdb.hasToken, true); assert.equal(tmdb.token, undefined);
  const candidates = await (await request(`/api/movies/${movie.id}/match`, {})).json(); assert.equal(candidates.results[0].id, 123);
  await request(`/api/movies/${movie.id}/enrich`, { tmdbId: 123 });
  await sync(source.id);
  library = await (await request('/api/library')).json(); assert.equal(library.movies[0].title, '星际穿越（匹配）'); assert.equal(library.movies[0].favorite, true); assert.equal(library.history[movie.id].position, 20);
  await t.test('手动分类在扫描与资料更新后保留，且可以恢复自动分类', async () => {
    assert.equal((await request(`/api/movies/${movie.id}/genres`, { genres: [] })).status, 200);
    const edited = await (await request(`/api/movies/${movie.id}/genres`, { genres: ['家庭收藏', '待看'] })).json();
    assert.deepEqual(edited.genres, ['家庭收藏', '待看']);
    await sync(source.id);
    await request(`/api/movies/${movie.id}/enrich`, { tmdbId: 123 });
    const refreshed = await (await request('/api/library')).json();
    assert.deepEqual(refreshed.movies[0].genres, ['家庭收藏', '待看']);
    const stored = await createStore(dataDir); assert.deepEqual(stored.state.movies[0].manualGenres, ['家庭收藏', '待看']);
    const reset = await (await request(`/api/movies/${movie.id}/genres`, { reset: true })).json();
    assert.deepEqual(reset.genres, ['科幻']); assert.equal(reset.manualGenres, undefined);
    await request(`/api/movies/${movie.id}/genres`, { genres: [] });
    await sync(source.id); await request(`/api/movies/${movie.id}/enrich`, { tmdbId: 123 });
    const cleared = (await (await request('/api/library')).json()).movies[0];
    assert.deepEqual(cleared.genres, []); assert.deepEqual(cleared.manualGenres, []); assert.equal(cleared.folderCategory, '科幻');
    await request(`/api/movies/${movie.id}/genres`, { reset: true });
  });
  assert.equal(JSON.stringify(library).includes('private-fixture-token'), false);
  const reloaded = await createStore(dataDir); assert.equal(reloaded.state.profiles[adminUser.id].favorites[movie.id], true);
  assert.equal((await fs.readFile(path.join(dataDir, 'library.json'), 'utf8')).includes('fixture-admin-password'), false);
  await t.test('角色授权、独立收藏和观看记录、最后管理员保护', async () => {
    assert.equal((await request('/api/admin/libraries',{name:'测试合集',sourceIds:app.store.state.sources.map(s=>s.id)})).status,200);
    const regular = await (await request('/api/admin/users', { username: 'viewer', displayName: '普通用户', password: 'fixture-viewer-password', role: 'user' })).json();
    assert.equal(regular.role, 'user');
    const logged = await request('/api/auth/login', { username: 'viewer', password: 'fixture-viewer-password' }, 'POST', { Cookie: '' });
    const viewerCookie = logged.headers.get('set-cookie').split(';')[0];
    const asViewer = { Cookie: viewerCookie };
    const viewerLibrary = await (await request('/api/library', undefined, 'GET', asViewer)).json();
    assert.equal(viewerLibrary.movies[0].favorite, false); assert.deepEqual(viewerLibrary.history, {});
    assert.equal(viewerLibrary.sources[0].path, undefined);
    for (const route of ['/api/admin/users', '/api/admin/diagnostics', '/api/admin/tokens', '/api/openapi.json']) assert.equal((await request(route, undefined, 'GET', asViewer)).status, 403);
    assert.equal((await request('/api/sync', {}, 'POST', asViewer)).status, 403);
    assert.equal((await request(`/api/movies/${movie.id}/enrich`, { tmdbId: 123 }, 'POST', asViewer)).status, 403);
    assert.equal((await request(`/api/movies/${movie.id}/file`, {}, 'POST', asViewer)).status, 403);
    assert.equal((await request(`/api/movies/${movie.id}/genres`, { genres: ['越权修改'] }, 'POST', asViewer)).status, 403);
    assert.equal((await request('/api/players', undefined, 'GET', asViewer)).status, 200);
    const externalRoute = `/api/movies/${movie.id}/open-external`;
    assert.equal((await fetch(`${base}${externalRoute}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: viewerCookie }, body: '{}' })).status, 403);
    const indexedMovie = app.store.state.movies.find(m => m.id === movie.id);
    const outside = path.join(dir, 'outside.mp4'); await fs.writeFile(outside, 'outside authorized root');
    indexedMovie.filePath = outside;
    try { assert.equal((await request(externalRoute, { player: 'default' }, 'POST', asViewer)).status, 403); }
    finally { indexedMovie.filePath = videoPath; }
    assert.equal(launched.length, 0);
    assert.equal((await request(externalRoute, { player: 'default', filePath: 'C:\\unregistered.mp4', url: 'https://malicious.example/file' }, 'POST', asViewer)).status, 200);
    assert.equal(launched.length, 1); assert.equal(launched[0].target.filePath, videoPath); assert.equal(launched[0].target.url, undefined);
    assert.equal((await request(externalRoute, { player: 'default' }, 'POST', asViewer)).status, 429);
    await request(`/api/movies/${movie.id}/progress`, { position: 5, duration: 100 }, 'POST', asViewer);
    assert.equal((await (await request('/api/library')).json()).history[movie.id].position, 20);
    assert.equal((await request(`/api/admin/users/${adminUser.id}`, { enabled: false })).status, 400);
    assert.equal((await request(`/api/admin/users/${adminUser.id}`, { role: 'user' })).status, 400);
    await request(`/api/admin/users/${regular.id}`, { enabled: false });
    assert.equal((await request('/api/library', undefined, 'GET', asViewer)).status, 401);
    assert.equal((await request('/api/auth/login', { username: 'viewer', password: 'fixture-viewer-password' })).status, 401);
  });
  await t.test('修改自己密码后旧会话与旧密码失效', async () => {
    await request('/api/admin/users', { username: 'password-test', password: 'fixture-old-password' });
    const login = await request('/api/auth/login', { username: 'password-test', password: 'fixture-old-password' }, 'POST', { Cookie: '' });
    const userCookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/auth/password', { currentPassword: 'wrong-password', password: 'fixture-new-password' }, 'POST', { Cookie: userCookie })).status, 400);
    assert.equal((await request('/api/auth/password', { currentPassword: 'fixture-old-password', password: 'x' }, 'POST', { Cookie: userCookie })).status, 200);
    assert.equal((await request('/api/library', undefined, 'GET', { Cookie: userCookie })).status, 401);
    assert.equal((await request('/api/auth/login', { username: 'password-test', password: 'fixture-old-password' })).status, 401);
    assert.equal((await request('/api/auth/login', { username: 'password-test', password: 'x' }, 'POST', { Cookie: '' })).status, 200);
  });
  await t.test('调试令牌作用域、OpenAPI 与 MCP stdio 真正调用', async () => {
    const issued = await (await request('/api/admin/tokens', { name: 'test-debug', scope: 'read', days: 1 })).json();
    assert.ok(issued.token.startsWith('sr_'));
    const bearer = { Cookie: '', Authorization: `Bearer ${issued.token}` };
    assert.equal((await request('/api/admin/diagnostics', undefined, 'GET', bearer)).status, 200);
    assert.equal((await request('/api/openapi.json', undefined, 'GET', bearer)).status, 200);
    assert.equal((await request('/api/admin/users', undefined, 'GET', bearer)).status, 403);
    assert.equal((await request('/api/sync', {}, 'POST', bearer)).status, 403);
    assert.equal((await request('/api/admin/tokens', {}, 'POST', bearer)).status, 403);
    assert.equal((await request(`/api/movies/${movie.id}/open-external`, { player: 'default' }, 'POST', bearer)).status, 403);
    assert.equal((await request(`/api/movies/${movie.id}/genres`, { genres: ['不允许'] }, 'POST', bearer)).status, 403);
    const writeToken = await (await request('/api/admin/tokens', { name: 'test-write', scope: 'write', days: 1 })).json();
    const writeBearer = { Cookie: '', Authorization: `Bearer ${writeToken.token}` };
    assert.equal((await request(`/api/movies/${movie.id}/open-external`, { player: 'default' }, 'POST', writeBearer)).status, 403);
    assert.equal((await request(`/api/movies/${movie.id}/genres`, { genres: ['写入测试'] }, 'POST', writeBearer)).status, 200);
    const classify = await (await request('/api/admin/tokens', { name: 'ai-classifier', scope: 'classify', days: 1 })).json();
    const classifier = { Cookie: '', Authorization: `Bearer ${classify.token}` };
    const toolLibrary = await (await request('/api/library', undefined, 'GET', classifier)).json();
    assert.equal(toolLibrary.sources[0].path, undefined); assert.equal(toolLibrary.user, undefined);
    for (const key of ['filePath', 'streams', 'mediaUrl', 'poster', 'rootPath']) assert.equal(toolLibrary.movies[0][key], undefined);
    assert.equal(JSON.stringify(toolLibrary).includes(videoPath), false);
    assert.equal((await request('/api/admin/logins', undefined, 'GET', classifier)).status, 403);
    assert.equal((await request('/api/admin/diagnostics', undefined, 'GET', classifier)).status, 403);
    assert.equal((await request('/api/sync', {}, 'POST', classifier)).status, 403);
    assert.equal((await request(`/api/movies/${movie.id}/enrich`, { tmdbId: 123 }, 'POST', classifier)).status, 403);
    assert.equal((await request(`/api/movies/${movie.id}/genres`, { genres: ['冲突'], expectedGenres: ['旧分类'] }, 'POST', classifier)).status, 409);
    const plan = { updates: [{ id: movie.id, genres: ['AI 分类'], expectedGenres: ['写入测试'] }] };
    const preview = await (await request('/api/movies/genres/batch', plan, 'POST', classifier)).json();
    assert.equal(preview.dryRun, true); assert.deepEqual(preview.changes[0].after, ['AI 分类']);
    assert.deepEqual(app.store.state.movies[0].genres, ['写入测试']);
    assert.equal((await request('/api/movies/genres/batch', { updates: [...plan.updates, { id: 'missing', genres: ['无效'] }], dryRun: false }, 'POST', classifier)).status, 404);
    assert.deepEqual(app.store.state.movies[0].genres, ['写入测试']);
    assert.equal((await request('/api/movies/genres/batch', { updates: [...plan.updates, ...plan.updates], dryRun: false }, 'POST', classifier)).status, 400);
    assert.equal((await request('/api/movies/genres/batch', { ...plan, dryRun: false }, 'POST', bearer)).status, 403);
    assert.equal((await request('/api/movies/genres/batch', { ...plan, dryRun: false }, 'POST', classifier)).status, 200);
    assert.deepEqual(app.store.state.movies[0].genres, ['AI 分类']);
    const tokenList = await (await request('/api/admin/tokens')).json(); assert.equal(JSON.stringify(tokenList).includes(issued.token), false); assert.equal(tokenList.tokens[0].hash, undefined);
    const child = spawn(process.execPath, [path.resolve('scripts/mcp-server.mjs')], { env: { ...process.env, SCREENROOM_URL: base, SCREENROOM_TOKEN: issued.token, SCREENROOM_ALLOW_WRITE: '0' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '', stderr = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { stderr += data; });
    child.stdin.end([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'cinema_diagnostics', arguments: {} } },
    ].map(m => JSON.stringify(m)).join('\n') + '\n');
    const exit = await once(child, 'exit'); assert.equal(exit[0], 0, stderr);
    const messages = output.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(messages[0].result.protocolVersion, '2025-11-25'); assert.equal(messages[1].result.tools.length, 5); assert.equal(messages[2].result.isError, false);
    assert.equal(JSON.parse(messages[2].result.content[0].text).app, 'screen-room'); assert.equal(output.includes(issued.token), false);
    const aiChild = spawn(process.execPath, [path.resolve('scripts/mcp-server.mjs')], { env: { ...process.env, SCREENROOM_URL: base, SCREENROOM_TOKEN: classify.token, SCREENROOM_ALLOW_WRITE: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let aiOutput = ''; aiChild.stdout.on('data', data => { aiOutput += data; });
    aiChild.stdin.end([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'classifier-test', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'cinema_batch_set_genres', arguments: { updates: [{ id: movie.id, genres: ['MCP 预览'] }] } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'cinema_set_movie_genres', arguments: { movieId: movie.id, genres: ['MCP 单片'], expectedGenres: ['AI 分类'] } } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'cinema_batch_set_genres', arguments: { updates: [{ id: movie.id, genres: ['MCP 批量'], expectedGenres: ['MCP 单片'] }], dryRun: false } } },
    ].map(m => JSON.stringify(m)).join('\n') + '\n');
    assert.equal((await once(aiChild, 'exit'))[0], 0);
    const aiMessages = aiOutput.trim().split('\n').map(line => JSON.parse(line));
    assert.ok(aiMessages[1].result.tools.some(t => t.name === 'cinema_set_movie_genres'));
    assert.equal(JSON.parse(aiMessages[2].result.content[0].text).dryRun, true);
    for (const m of aiMessages.slice(2)) assert.equal(m.result.isError, false);
    assert.deepEqual(app.store.state.movies[0].genres, ['MCP 批量']);
    assert.equal(aiOutput.includes(classify.token), false);
    await request(`/api/admin/tokens/${classify.id}`, {}, 'DELETE');
    assert.equal((await request('/api/movies/genres/batch', plan, 'POST', classifier)).status, 401);
    await request(`/api/admin/tokens/${issued.id}`, {}, 'DELETE');
    assert.equal((await request('/api/admin/diagnostics', undefined, 'GET', bearer)).status, 401);
  });
  // Failed scans preserve the indexed movies.
  const testRoot = await fs.realpath(dir), offline = path.join(testRoot, 'disconnected');
  assert.equal(await fs.realpath(mediaRoot), path.join(testRoot, 'movies'));
  assert.equal(path.dirname(offline), testRoot);
  assert.equal((await request('/api/sources', { ...source, path: offline })).status, 409);
  await fs.rename(path.join(testRoot, 'movies'), offline);
  await request('/api/sync', { sourceId: source.id });
  for (let i = 0; i < 100 && app.getJob().status === 'running'; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(app.getJob().status, 'error');
  assert.equal((await (await request('/api/library')).json()).movies.length, 1);
  assert.equal(await fs.realpath(offline), path.join(testRoot, 'disconnected'));
  await fs.rename(offline, path.join(testRoot, 'movies'));
  await request(`/api/sources/${source.id}`, {}, 'DELETE'); assert.deepEqual(await fs.readFile(videoPath), original);
});
