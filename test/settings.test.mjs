import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createAuth, makeUser } from '../lib/auth.mjs';
import { preferences, DEFAULT_PREFERENCES } from '../lib/preferences.mjs';
import { allowedHost, isLoopback, networkSettings } from '../lib/network.mjs';
import { themeColors } from '../public/theme.js';
import { fitMovieColumns, actorIndex, movieModifiedTime } from '../public/movie-utils.js';
import { scanDirectory } from '../lib/scanner.mjs';
import { createApp } from '../server.mjs';

test('记住设备：仅保存哈希、重建认证后仍有效、活动续期和撤销', async () => {
  let time = Date.now(); const user = await makeUser({ username: 'remember-me', password: 'x' }, 'admin');
  const state = { users: [user] }, req = { headers: { 'user-agent': 'Mozilla Windows Chrome/123' }, socket: { remoteAddress: '127.0.0.1' } };
  let cookie; const res = { setHeader: (name, value) => { if (name === 'Set-Cookie') cookie = value; } };
  let auth = createAuth(state, { now: () => time }); auth.session(user, req, res, true);
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Max-Age=7776000/);
  req.headers.cookie = cookie.split(';')[0]; const raw = req.headers.cookie.split('=')[1];
  assert.equal(JSON.stringify(state).includes(raw), false);
  const restored = JSON.parse(JSON.stringify(state)); auth = createAuth(restored, { now: () => time });
  assert.equal(auth.actor(req, res).user.id, user.id);
  time += 2 * 86400000; auth.actor(req, res);
  assert.ok(Object.values(restored.sessions)[0].expiresAt > time + 89 * 86400000);
  assert.equal(auth.sessions()[0].online, true);
  time += 181000; assert.equal(auth.sessions()[0].online, false);
  assert.equal(auth.revokeSession(auth.sessions()[0].id), true); assert.equal(auth.actor(req, res), null);
  auth.session(restored.users[0], req, res, false); assert.doesNotMatch(cookie, /Max-Age=/);
  req.headers.cookie = cookie.split(';')[0]; restored.users[0].authVersion++;
  assert.equal(auth.actor(req, res), null);
});

test('影片列数偏好：旧账号默认自动，窄屏缩列并拒绝异常值', () => {
  assert.equal(preferences({}, { theme: 'light' }).columns, 'auto');
  for (const value of ['auto', ...Array.from({ length: 8 }, (_, i) => String(i + 1))]) assert.equal(preferences({ columns: value }).columns, value);
  for (const value of ['0', '9', '2.5', '2fr', 4, null]) assert.throws(() => preferences({ columns: value }), /设置/);
  assert.equal(preferences({ theme: 'light' }, { columns: '5' }).columns, '5');
  assert.equal(fitMovieColumns('auto', 1200, 15), null);
  assert.equal(fitMovieColumns('6', 1000, 15), 6);
  assert.equal(fitMovieColumns('8', 320, 12), 2);
  assert.equal(fitMovieColumns('8', 70, 12), 1);
  assert.equal(fitMovieColumns('8', 0, 12), null);
  assert.equal(fitMovieColumns('1', 1200, 12), 1);
});

test('演员列表使用参演影片最近修改时间，不按影片数量排序', () => {
  const older = { id: 'a', cast: '甲', fileModifiedAt: '2023-01-01T00:00:00Z', addedAt: '2026-01-01T00:00:00Z' };
  const recent = { id: 'b', cast: '乙', fileModifiedAt: '2024-01-01T00:00:00Z' };
  assert.equal(movieModifiedTime(older), Date.parse(older.fileModifiedAt));
  assert.deepEqual(actorIndex([older, recent, { ...older, id: 'a2' }]).map(a => a.name), ['乙', '甲']);
});

test('主题/播放器设置校验与主题文字对比色', () => {
  assert.deepEqual(preferences(), DEFAULT_PREFERENCES);
  assert.equal(preferences({ accent: '#AACCEE', player: 'potplayer' }).accent, '#aaccee');
  assert.throws(() => preferences({ theme: 'invalid' }), /设置/);
  assert.throws(() => preferences({ accent: 'url(javascript:bad)' }), /主题颜色/);
  assert.throws(() => preferences({ anything: 1 }), /设置项/);
  assert.equal(themeColors('dark', '#000000').ink, '#ffffff');
  assert.notEqual(themeColors('dark', '#000000').readable, '#000000');
  assert.notEqual(themeColors('light', '#ffffff').readable, '#ffffff');
  const luminance = color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  for (const mode of ['dark', 'light']) for (const accent of ['#000000', '#ffffff', '#777777', '#beeec8', '#8bbcff', '#ff0000']) {
    const colors = themeColors(mode, accent);
    for (const key of ['bg', 'sidebar', 'surface', 'panel', 'input', 'card', 'hover']) assert.ok(contrast(colors.readable, colors[key]) >= 4.5);
    assert.ok(contrast(colors.ink, accent) >= 4.5);
  }
  for (const mode of ['dark', 'light']) for (const key of ['bg', 'sidebar', 'surface', 'panel', 'input', 'card']) assert.notEqual(themeColors(mode, '#8bbcff')[key], themeColors(mode, '#c5a3ff')[key]);
});

test('网络配置和 Host 白名单只允许本机或当前机器已知地址', () => {
  assert.deepEqual(networkSettings(), { port: 3210, allowLan: false, enableIpv6: false, enableDiscovery: true });
  for (const port of [0, 65536, 1.5, 'bad']) assert.throws(() => networkSettings({ port }), /端口/);
  const info = { addresses: ['192.168.1.20'], hostname: 'cinema-pc' };
  assert.equal(allowedHost('127.0.0.1:3210', false, info), true);
  assert.equal(allowedHost('192.168.1.20:3210', false, info), false);
  assert.equal(allowedHost('192.168.1.20:3210', true, info), true);
  assert.equal(allowedHost('cinema-pc:3210', true, info), true);
  assert.equal(allowedHost('attacker.example:3210', true, info), false);
  assert.equal(allowedHost('127.0.0.1@attacker.example', true, info), false);
  assert.equal(isLoopback('::ffff:127.0.0.1'), true); assert.equal(isLoopback('192.168.1.10'), false);
});

test('文件夹归档与影片类别独立，NFO 可初始化类别，无资料类别留空', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cinema-folder-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, '周末收藏', '电影A'), { recursive: true });
  await fs.writeFile(path.join(dir, '周末收藏', '电影A', 'A.mp4'), 'fixture');
  await fs.writeFile(path.join(dir, '周末收藏', '电影A', 'movie.nfo'), '<movie><genre>剧情</genre></movie>');
  await fs.mkdir(path.join(dir, '任意目录'), { recursive: true }); await fs.writeFile(path.join(dir, '任意目录', 'B.mp4'), 'fixture');
  await fs.writeFile(path.join(dir, 'C.mp4'), 'fixture');
  const { movies } = await scanDirectory({ id: 'folders', path: dir });
  assert.deepEqual(movies.find(m => m.title === '电影A').genres, ['剧情']);
  assert.equal(movies.find(m => m.title === '电影A').folderCategory, '周末收藏');
  assert.deepEqual(movies.find(m => m.title === '电影A').metadataGenres, ['剧情']);
  assert.deepEqual(movies.find(m => m.title === 'B').genres, []);
  assert.equal(movies.find(m => m.title === 'B').folderCategory, '任意目录');
  assert.deepEqual(movies.find(m => m.title === 'C').genres, []);
  assert.equal(movies.find(m => m.title === 'C').folderCategory, path.basename(dir));
  const grouped = await scanDirectory({ id: 'folders', path: dir, category: '归档别名' });
  assert.equal(grouped.movies[0].folderCategory, '归档别名');
  assert.ok(grouped.movies.every(m => !m.genres.includes('归档别名')));
});

test('服务重启保留登录、偏好按账号隔离、管理员登录面板与网络配置授权', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cinema-settings-')); let app;
  async function stop() { if (!app) return; app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); app = null; }
  t.after(async () => { await stop(); await fs.rm(dir, { recursive: true, force: true }); });
  async function start() { app = await createApp({ dataDir: dir }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); return `http://127.0.0.1:${app.server.address().port}`; }
  let base = await start(), cookie = '';
  const request = (route, data, headers = {}) => fetch(`${base}${route}`, { method: data === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'X-Cinema-Client': 'local', 'Content-Type': 'application/json', 'User-Agent': 'SettingsTest Windows Chrome/123', ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const setup = await request('/api/auth/setup', { username: 'admin-settings', password: 'a', remember: true });
  assert.equal(setup.status, 201); cookie = setup.headers.get('set-cookie').split(';')[0];
  const admin = (await setup.json()).user;
  await request('/api/preferences', { theme: 'light', accent: '#8bbcff', player: 'potplayer', playback: 'external', columns: '6' });
  await stop(); base = await start();
  assert.equal((await request('/api/library')).status, 200);
  assert.equal((await (await request('/api/preferences')).json()).theme, 'light');
  assert.equal((await (await request('/api/preferences')).json()).columns, '6');
  const disk = JSON.parse(await fs.readFile(path.join(dir, 'library.json'), 'utf8'));
  assert.equal(JSON.stringify(disk.sessions).includes(cookie.split('=')[1]), false);
  assert.equal((await request('/api/admin/network', { port: 4321, allowLan: true })).status, 400);
  const saved = await (await request('/api/admin/network', { port: 4321, allowLan: true, confirmLan: true })).json();
  assert.deepEqual(saved.saved, { port: 4321, allowLan: true, enableIpv6: false, enableDiscovery: true }); assert.equal(saved.running.allowLan, false); assert.equal(saved.restartRequired, true);
  assert.equal(app.server.address().address, '127.0.0.1');
  await request('/api/admin/users', { username: 'viewer-settings', password: 'b' });
  const logged = await request('/api/auth/login', { username: 'viewer-settings', password: 'b', remember: false }, { Cookie: '' });
  assert.doesNotMatch(logged.headers.get('set-cookie'), /Max-Age=/);
  const viewerCookie = logged.headers.get('set-cookie').split(';')[0], viewerHeaders = { Cookie: viewerCookie };
  assert.equal((await (await request('/api/job', undefined, viewerHeaders)).json()).warnings, undefined);
  assert.equal((await (await request('/api/preferences', undefined, viewerHeaders)).json()).theme, 'dark');
  assert.equal((await (await request('/api/preferences', undefined, viewerHeaders)).json()).columns, 'auto');
  assert.equal((await request('/api/preferences', { columns: '9' }, viewerHeaders)).status, 400);
  await request('/api/preferences', { accent: '#ff9fad', columns: '2' }, viewerHeaders);
  assert.equal((await (await request('/api/preferences', undefined, viewerHeaders)).json()).columns, '2');
  assert.equal((await (await request('/api/preferences')).json()).columns, '6');
  assert.equal((await (await request('/api/preferences')).json()).accent, '#8bbcff');
  for (const route of ['/api/admin/logins', '/api/admin/network', '/api/admin/users']) assert.equal((await request(route, undefined, viewerHeaders)).status, 403);
  assert.equal((await request('/api/admin/network', { port: 3000, allowLan: false }, viewerHeaders)).status, 403);
  await request('/api/auth/login', { username: 'viewer-settings', password: 'wrong' });
  const monitor = await (await request('/api/admin/logins')).json();
  assert.equal(monitor.users.find(u => u.id === admin.id).online, true);
  assert.ok(monitor.events.some(e => e.username === 'viewer-settings' && !e.success));
  assert.ok(monitor.sessions.some(s => s.device.includes('Chrome')));
  assert.equal(JSON.stringify(monitor).includes('passwordHash'), false);
  const viewerSession = monitor.sessions.find(s => s.userId !== admin.id);
  await request(`/api/admin/sessions/${viewerSession.id}/revoke`, {});
  assert.equal((await request('/api/library', undefined, viewerHeaders)).status, 401);
  const token = await (await request('/api/admin/tokens', { scope: 'write' })).json();
  const bearer = { Cookie: '', Authorization: `Bearer ${token.token}` };
  assert.equal((await request('/api/admin/logins', undefined, bearer)).status, 403);
  assert.equal((await request('/api/admin/network', undefined, bearer)).status, 403);
  await stop(); base = await start();
  assert.equal(app.listenConfig.allowLan, true); assert.equal(app.listenConfig.port, 4321);
  assert.equal((await request('/api/library')).status, 200);
  await request('/api/auth/logout', {}); await stop(); base = await start();
  assert.equal((await request('/api/library')).status, 401);
});
