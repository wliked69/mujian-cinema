import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import dgram from 'node:dgram';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { discoveryReply, localDiscoveryPeer, privateIpv4, startDiscovery } from '../lib/discovery.mjs';
import { createPlaybackTickets, PLAYBACK_TTL } from '../lib/playback-tickets.mjs';
import { networkSettings } from '../lib/network.mjs';
import { createNativeClient } from '../public/mobile.js';
import { isTelevision } from '../public/episodes.js';

const nonce = '0123456789abcdef0123456789abcdef';
const query = Buffer.from(JSON.stringify({ kind: 'screenroom-discover', v: 1, nonce }));
test('局域网发现协议只接受有限长度、正确服务/版本/随机数，不包含账号和片库元数据', () => {
  const reply = JSON.parse(discoveryReply(query, 4321).toString());
  assert.deepEqual(reply, { kind: 'screenroom-server', v: 1, nonce, port: 4321, name: '幕间片库' });
  assert.equal(discoveryReply(Buffer.alloc(257), 3210), null);
  assert.equal(discoveryReply(Buffer.from('not json'), 3210), null);
  for (const q of [{ kind: 'other', v: 1, nonce }, { kind: 'screenroom-discover', v: 2, nonce }, { kind: 'screenroom-discover', v: 1, nonce: 'bad' }])
    assert.equal(discoveryReply(Buffer.from(JSON.stringify(q)), 3210), null);
  for (const port of [0, 65536, '3210']) assert.equal(discoveryReply(query, port), null);
});
test('发现仅回应已知 IPv4 子网内私有地址，不响应公网、环回或跨网段请求', () => {
  const interfaces = { test: [{ address: '192.168.1.20', netmask: '255.255.255.0', internal: false }] };
  assert.equal(localDiscoveryPeer('192.168.1.50', interfaces), true);
  for (const ip of ['192.168.2.50', '10.0.0.1', '8.8.8.8', '127.0.0.1', 'fd12::1']) assert.equal(localDiscoveryPeer(ip, interfaces), false);
  assert.equal(privateIpv4('172.31.1.1'), true); assert.equal(privateIpv4('172.32.1.1'), false);
});
test('未允许局域网或关闭搜索时不启动发现服务，旧客户端保留已保存的搜索开关', async () => {
  assert.equal((await startDiscovery({ allowLan: false, httpPort: 3210 })).status, 'disabled');
  assert.equal((await startDiscovery({ allowLan: true, enableDiscovery: false, httpPort: 3210 })).status, 'disabled');
  assert.equal(networkSettings({}, { enableDiscovery: false }).enableDiscovery, false);
  for (const value of ['true', 1, null]) assert.throws(() => networkSettings({ enableDiscovery: value }), /搜索/);
});
test('真实 UDP 环回发现：返回实际 HTTP 端口、随机数；不发送局域网广播', async t => {
  const sharedState = {};
  const responder = await startDiscovery({ allowLan: true, httpPort: 4321, host: '127.0.0.1', port: 0, allowedPeer: ip => ip === '127.0.0.1', state: sharedState });
  assert.equal(responder, sharedState);
  t.after(() => responder.close());
  assert.equal(responder.status, 'listening');
  const client = dgram.createSocket('udp4'); t.after(() => client.close());
  client.bind(0, '127.0.0.1'); await once(client, 'listening');
  const response = once(client, 'message', { signal: AbortSignal.timeout(3000) });
  client.send(query, responder.port, '127.0.0.1');
  const [message] = await response;
  assert.equal(JSON.parse(message.toString()).port, 4321); assert.equal(JSON.parse(message.toString()).nonce, nonce);
  await responder.close(); assert.equal(sharedState.status, 'stopped');
});
test('临时播放票据绑定一部影片/一集、有效期有限；每用户最多 8 个，不暴露账号会话', () => {
  let time = 1000;
  const tickets = createPlaybackTickets({ now: () => time });
  const args = { userId: 'user', authVersion: 1, sessionId: 'session', movieId: 'movie', episodeId: 'episode-2' };
  const first = tickets.issue(args);
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(first.expiresAt, 1000 + PLAYBACK_TTL);
  assert.equal(tickets.get(first.token).episodeId, 'episode-2');
  for (let i = 0; i < 8; i++) tickets.issue(args);
  assert.equal(tickets.get(first.token), null);
  const last = tickets.issue(args); time += PLAYBACK_TTL;
  assert.equal(tickets.get(last.token), null);
  assert.equal(tickets.get('bad'), null);
  assert.throws(() => tickets.issue({}), /有效登录/);
});
test('手机消息桥匹配请求 ID、忽略畸形回复，不能覆盖请求类型；超时返回明确错误', async () => {
  const bridge = { postMessage(raw) {
    const request = JSON.parse(raw);
    assert.equal(request.type, 'getPlayback'); assert.notEqual(request.id, 'injected');
    bridge.onmessage({ data: 'malformed' });
    bridge.onmessage({ data: JSON.stringify({ id: 'unknown', ok: true, value: 'ignored' }) });
    bridge.onmessage({ data: JSON.stringify({ id: request.id, ok: true, value: 'external' }) });
  } };
  const request = createNativeClient(bridge);
  assert.equal(await request('getPlayback', { id: 'injected', type: 'other' }), 'external');
  await assert.rejects(request('arbitrary'), /不支持/);
  await assert.rejects(createNativeClient({ postMessage() {} }, { timeoutMs: 10 })('getPlayback'), /未响应/);
});

test('手机外部播放：普通用户可取专用 URL，不带 Cookie 即可 Range；不能取代账号登录或读取其他集', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cinema-mobile-'));
  const app = await createApp({ dataDir: dir });
  t.after(async () => { app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = '';
  const request = (route, data, headers = {}) => fetch(base + route, { method: data === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'X-Cinema-Client': 'local', 'Content-Type': 'application/json', ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const setup = await request('/api/auth/setup', { username: 'mobile-admin-test', password: 'x', remember: true });
  cookie = setup.headers.get('set-cookie').split(';')[0]; const adminCookie = cookie;
  const one = path.join(dir, 'one.mp4'), two = path.join(dir, 'two.mp4');
  await fs.writeFile(one, '0123456789abcdef'); await fs.writeFile(two, 'second-episode');
  app.store.state.movies.push({ id: 'local-video', kind: 'local', title: 'Test movie', filePath: one, rootPath: dir, genres: [] },
    { id: 'test-tv', kind: 'local', title: 'Test TV', rootPath: dir, genres: [], episodes: [{ id: 'ep1', filePath: one }, { id: 'ep2', filePath: two }] },
    { id: 'api-video', kind: 'api', title: 'API test', streams: [] });
  app.store.state.movies.forEach(m => { m.sourceId = 'fixture'; });
  app.store.state.sources=[{id:'fixture',type:'local',name:'测试来源',path:dir}];
  app.store.state.libraries=[{id:'collection',name:'测试合集',sourceIds:['fixture'],revision:1}];
  await request('/api/admin/users', { username: 'mobile-viewer-test', password: 'y' });
  const login = await request('/api/auth/login', { username: 'mobile-viewer-test', password: 'y' }, { Cookie: '' });
  cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/movies/local-video/playback-ticket', {}, { Cookie: '' })).status, 401);
  const response = await request('/api/movies/local-video/playback-ticket', {});
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const issued = await response.json();
  assert.equal(issued.mime, 'video/mp4');
  assert.ok(issued.url.startsWith(base + '/play/')); assert.equal(issued.url.includes(cookie.split('=')[1]), false); assert.equal(issued.url.includes('one.mp4'), false);
  const range = await fetch(issued.url, { headers: { Range: 'bytes=4-9' } });
  assert.equal(range.status, 206); assert.equal(await range.text(), '456789');
  const head = await fetch(issued.url, { method: 'HEAD' }); assert.equal(head.headers.get('content-length'), '16');
  assert.equal((await fetch(issued.url, { method: 'POST' })).status, 405);
  assert.equal((await request('/api/library', undefined, { Cookie: `screenroom_session=${issued.url.split('/').pop()}` })).status, 401);
  assert.equal((await fetch(issued.url + '/another')).status, 403);
  app.store.state.movies[0].rootPath = path.join(dir, 'not-authorized');
  assert.equal((await request('/api/movies/local-video/playback-ticket', {})).status, 403);
  assert.equal((await fetch(issued.url)).status, 403);
  app.store.state.movies[0].rootPath = dir;
  const episode = await (await request('/api/movies/test-tv/playback-ticket', { episodeId: 'ep2' })).json();
  assert.equal(await (await fetch(episode.url)).text(), 'second-episode');
  assert.equal((await request('/api/movies/test-tv/playback-ticket', { episodeId: 'missing' })).status, 404);
  assert.equal((await request('/api/movies/api-video/playback-ticket', {})).status, 400);
  // Removing an episode must not silently grant access to another episode.
  app.store.state.movies.find(m => m.id === 'test-tv').episodes.pop();
  assert.equal((await fetch(episode.url)).status, 404);
  const token = await (await request('/api/admin/tokens', { scope: 'write' }, { Cookie: adminCookie })).json();
  assert.equal((await request('/api/movies/local-video/playback-ticket', {}, { Cookie: '', Authorization: `Bearer ${token.token}` })).status, 403);
  const logins = await (await request('/api/admin/logins', undefined, { Cookie: adminCookie })).json();
  const viewer = logins.users.find(u => u.username === 'mobile-viewer-test');
  const session = logins.sessions.find(s => s.userId === viewer.id);
  await request(`/api/admin/sessions/${session.id}/revoke`, {}, { Cookie: adminCookie });
  assert.equal((await fetch(issued.url)).status, 403);
  const loginAgain = async () => {
    const next = await request('/api/auth/login', { username: 'mobile-viewer-test', password: 'y' }, { Cookie: '' });
    cookie = next.headers.get('set-cookie').split(';')[0];
    return (await (await request('/api/movies/local-video/playback-ticket', {})).json()).url;
  };
  const disabledTicket = await loginAgain();
  await request(`/api/admin/users/${viewer.id}`, { enabled: false }, { Cookie: adminCookie });
  assert.equal((await fetch(disabledTicket)).status, 403);
  await request(`/api/admin/users/${viewer.id}`, { enabled: true }, { Cookie: adminCookie });
  const changedPasswordTicket = await loginAgain();
  await request(`/api/admin/users/${viewer.id}`, { password: 'z' }, { Cookie: adminCookie });
  assert.equal((await fetch(changedPasswordTicket)).status, 403);
  // Admin logout also invalidates newly issued playback URLs without removing the account.
  cookie = adminCookie;
  const adminTicket = await (await request('/api/movies/local-video/playback-ticket', {})).json();
  await request('/api/auth/logout', {});
  assert.equal((await fetch(adminTicket.url)).status, 403);
});

test('网页和 App 封面可直播放，片名只打开详情；App 移除底部原生栏', async () => {
  const js = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const html = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const java = await fs.readFile(new URL('../android/app/src/main/java/com/screenroom/app/MainActivity.java', import.meta.url), 'utf8');
  assert.match(js, /class="poster-button" \$\{coverAction\(m\)\}/);
  const behavior = js.slice(js.indexOf('function usesDirectCoverPlayback()'), js.indexOf('function renderGrid()'));
  const movie = { id: 'movie-1', title: '测试影片', playable: true };
  const attributes = (androidApp, narrow, entry = movie) => vm.runInNewContext(behavior + 'coverAction(movie)', {
    androidApp, mobileLayout: { matches: narrow }, esc: String, movie: entry, isTelevision,
  });
  assert.match(attributes(true, false), /^data-play="movie-1"/); // 展开的折叠屏 App
  assert.match(attributes(false, true), /^data-play="movie-1"/); // 手机浏览器
  assert.match(attributes(false, false), /^data-play="movie-1"/); // 宽屏网页
  assert.match(attributes(true, true, {...movie, playable: false}), /^data-detail="movie-1"/);
  assert.match(attributes(false, false, {...movie, mediaType:'tv',episodes:[{id:'ep'}]}), /^data-detail="movie-1"/);
  assert.match(js, /class="movie-title" data-detail=/);
  assert.match(js, /class="random-poster poster-direct" \$\{coverAction\(movie\)\}/);
  assert.match(js, /class="random-copy" data-detail=/);
  assert.doesNotMatch(js, /class="related-poster|class="related-copy/);
  assert.doesNotMatch(html, /id="hero"|data-action="exit-random"/);
  assert.match(js, /class="detail-poster-play" data-play=/);
  const detail = js.slice(js.indexOf('function openDetail('), js.indexOf('async function favorite('));
  assert.match(detail, /showDialog\('detail-dialog'\)/);
  assert.doesNotMatch(detail, /\bplay\(|open-external|playback-ticket/);
  assert.match(js, /mime = ticket\.mime/);
  assert.match(js, /mobileRequest\('openVideo', \{ url: address, \.\.\.\(mime \? \{ mime \}/);
  assert.match(java, /matchingVideoPlayers\(specific\)/);
  assert.match(java, /matchingVideoPlayers\(generic\)/);
  assert.match(java, /startActivity\(Intent\.createChooser\(fallback/);
  assert.match(java, /getOnBackPressedDispatcher/);
  assert.doesNotMatch(java, /mainPane\.addView\(toolbar\)|回到片库/);
  assert.match(java, /case "connectionSettings" -> \{ showConnectionSettings\(\)/);
  assert.match(java, /WindowInsets\.CONSUMED/);
  assert.match(java, /Collections\.singleton\(origin\)/);
  assert.match(java, /!mainFrame/);
  assert.doesNotMatch(java, /addJavascriptInterface\(/);
});
