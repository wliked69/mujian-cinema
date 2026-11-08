import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter, once } from 'node:events';
import { Readable } from 'node:stream';
import { createApp } from '../server.mjs';
import { networkSettings, isLoopback, lanAddresses, allowedHost, accessUrls, bindingOptions, startListening, closeListeners } from '../lib/network.mjs';

const interfaces = { test: [
  { family: 'IPv4', address: '192.168.1.20', internal: false },
  { family: 4, address: '192.168.1.20', internal: false },
  { family: 'IPv6', address: 'FD12:0000:0000:0000:0000:0000:0000:0010', internal: false },
  { family: 6, address: '2001:db8::20', internal: false },
  { family: 'IPv6', address: 'fe80::10%12', scopeid: 12, internal: false },
  { family: 'IPv6', address: 'febf::10', scopeid: 12, internal: false },
  { family: 'IPv6', address: '::1', internal: true },
  { family: 'IPv4', address: '127.0.0.1', internal: true },
  { family: 'IPv6', address: '::', internal: false },
  { family: 'IPv6', address: '::ffff:192.168.1.20', internal: false }, null,
] };

test('IPv6 配置默认关闭、旧配置兼容，严格验证开关并保留旧客户端未传的开关', () => {
  assert.deepEqual(networkSettings({ port: 3210, allowLan: false }), { port: 3210, allowLan: false, enableIpv6: false, enableDiscovery: true });
  assert.equal(networkSettings({ port: 3210 }, { enableIpv6: true }).enableIpv6, true);
  assert.equal(networkSettings({ enableIpv6: false }, { enableIpv6: true }).enableIpv6, false);
  for (const value of [null, 'true', 'false', 0, 1, [], {}]) assert.throws(() => networkSettings({ enableIpv6: value }), /IPv6/);
});

test('双栈绑定范围：仅本机时不监听通配地址，IPv6-only 防止抢占 IPv4 端口', () => {
  assert.deepEqual(bindingOptions({ port: 4321, allowLan: false }), [{ port: 4321, host: '127.0.0.1' }]);
  assert.deepEqual(bindingOptions({ port: 4321, allowLan: false, enableIpv6: true }), [
    { port: 4321, host: '127.0.0.1' }, { port: 4321, host: '::1', ipv6Only: true },
  ]);
  assert.deepEqual(bindingOptions({ port: 4321, allowLan: true, enableIpv6: true }), [
    { port: 4321, host: '0.0.0.0' }, { port: 4321, host: '::', ipv6Only: true },
  ]);
});

test('网卡 IPv6 标准化、去重、忽略环回/未指定/映射和需区号的链路本地地址', () => {
  assert.deepEqual(lanAddresses(interfaces), ['192.168.1.20']);
  assert.deepEqual(lanAddresses(interfaces, { enableIpv6: true }), ['192.168.1.20', 'fd12::10', '2001:db8::20']);
});

test('IPv6 Host 白名单只接受开启后的环回或已知网卡；拒绝任意 IPv6、伪造主机与 scoped URL', () => {
  const info = { addresses: lanAddresses(interfaces, { enableIpv6: true }), hostname: 'cinema-pc', enableIpv6: true };
  assert.equal(allowedHost('[::1]:3210', false, info), true);
  assert.equal(allowedHost('[0:0:0:0:0:0:0:1]:3210', false, info), true);
  assert.equal(allowedHost('[FD12:0:0:0:0:0:0:10]:3210', true, info), true);
  assert.equal(allowedHost('[2001:db8::20]:3210', true, info), true);
  assert.equal(allowedHost('[fd12::10]:3210', false, info), false);
  assert.equal(allowedHost('[::1]:3210', false, { ...info, enableIpv6: false }), false);
  assert.equal(allowedHost('192.168.1.20:3210', true, info), true);
  assert.equal(allowedHost('cinema-pc:3210', true, info), true);
  for (const host of ['[fd12::11]:3210', '[2001:db8::21]:3210', '[::]:3210', '[fe80::10%2512]:3210', '[::1]@evil.example', '[::1]:3210/path', 'evil.example', '[::1]:65536', '[::1]:abc', 'fd12::10', '[::1]\\evil', 'localhost#evil', 'localhost?evil'])
    assert.equal(allowedHost(host, true, info), false, host);
});

test('IPv6 / IPv4 映射环回识别不把远端 IPv6 当成本机', () => {
  for (const ip of ['::1', '0:0:0:0:0:0:0:1', '[::1]', '127.0.0.1', '::ffff:127.0.0.1', '::ffff:7f00:1']) assert.equal(isLoopback(ip), true, ip);
  for (const ip of ['fd12::10', '2001:db8::20', 'fe80::10%12', '::ffff:192.168.1.20', '192.168.1.20', '127.not-an-ip', '127.0.0.1%12', '[::1', '::1]', '', null]) assert.equal(isLoopback(ip), false, String(ip));
});

test('访问链接保留 IPv6 方括号、同一端口，关闭网络后不列网卡地址', () => {
  assert.deepEqual(accessUrls({ port: 4321, allowLan: false, enableIpv6: true }, interfaces), ['http://127.0.0.1:4321', 'http://[::1]:4321']);
  assert.deepEqual(accessUrls({ port: 4321, allowLan: true, enableIpv6: true }, interfaces), [
    'http://127.0.0.1:4321', 'http://[::1]:4321', 'http://192.168.1.20:4321', 'http://[fd12::10]:4321', 'http://[2001:db8::20]:4321',
  ]);
  for (const url of accessUrls({ port: 4321, allowLan: true, enableIpv6: true }, interfaces)) assert.equal(new URL(url).port, '4321');
});

class StubServer extends EventEmitter {
  constructor(failure) { super(); this.listening = false; this.calls = []; this.failure = failure; this.closed = 0; }
  listen(options) {
    this.calls.push(options);
    queueMicrotask(() => {
      if (this.failure) this.emit('error', this.failure);
      else { this.listening = true; this.emit('listening'); }
    });
  }
  address() { return { port: this.calls.at(-1)?.port || 42345 }; }
  close(callback) { this.closed++; this.listening = false; queueMicrotask(() => { this.emit('close'); callback(); }); }
  closeAllConnections() {}
}

test('双栈启动保持同一实际端口，关闭会清理两个监听（网络范围仅模拟，不实际开放）', async () => {
  const app = { server: new StubServer(), ipv6Server: new StubServer(), listenConfig: { port: 0, allowLan: true, enableIpv6: true } };
  assert.equal(await startListening(app), 42345);
  assert.deepEqual(app.ipv6Server.calls, [{ host: '::', port: 42345, ipv6Only: true }]);
  await assert.rejects(startListening(app), /已经运行/);
  await closeListeners(app);
  assert.equal(app.server.closed, 1); assert.equal(app.ipv6Server.closed, 1);
});

test('IPv6 不可用/端口冲突清理已开的 IPv4；IPv4 失败时不尝试 IPv6', async () => {
  for (const code of ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EADDRINUSE']) {
    const app = { server: new StubServer(), ipv6Server: new StubServer(Object.assign(new Error(code), { code })), listenConfig: { port: 3210, allowLan: false, enableIpv6: true } };
    await assert.rejects(startListening(app), { code });
    assert.equal(app.server.listening, false); assert.equal(app.server.closed, 1);
  }
  const app = { server: new StubServer(Object.assign(new Error('busy'), { code: 'EADDRINUSE' })), ipv6Server: new StubServer(), listenConfig: { port: 3210, enableIpv6: true } };
  await assert.rejects(startListening(app), { code: 'EADDRINUSE' });
  assert.equal(app.ipv6Server.calls.length, 0);
});

function rawRequest(port, { ipv6 = false, route = '/api/auth/me', method = 'GET', data, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: ipv6 ? '::1' : '127.0.0.1', port, path: route, method,
      headers: { 'X-Cinema-Client': 'local', 'Content-Type': 'application/json', ...headers }, agent: false }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let json; try { json = JSON.parse(text); } catch { /* media / HTML */ }
        resolve({ status: response.statusCode, headers: response.headers, text, json });
      });
      response.on('error', reject);
    });
    request.setTimeout(4000, () => request.destroy(new Error('request timeout')));
    request.on('error', reject);
    request.end(data === undefined ? undefined : JSON.stringify(data));
  });
}
async function temporaryApp(t, enableIpv6 = true) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cinema-ipv6-'));
  const app = await createApp({ dataDir, playerService: { list: () => ({ supported: true, players: [] }), open: () => { throw new Error('must not launch'); } } });
  t.after(async () => { await closeListeners(app); await fs.rm(dataDir, { recursive: true, force: true }); });
  app.listenConfig.enableIpv6 = enableIpv6;
  app.store.state.network.enableIpv6 = enableIpv6;
  let port;
  try { port = await startListening(app, { port: 0 }); }
  catch (error) {
    if (['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT'].includes(error.code)) { t.skip('OS IPv6 loopback unavailable'); return null; }
    throw error;
  }
  app.store.state.network.port = port;
  app.listenConfig.port = port;
  const request = options => rawRequest(port, options);
  return { app, port, dataDir, request };
}
async function setup(request) {
  const response = await request({ ipv6: true, route: '/api/auth/setup', method: 'POST', data: { username: 'ipv6-admin-test', password: 'x', remember: true } });
  assert.equal(response.status, 201);
  return response.headers['set-cookie'][0].split(';')[0];
}
async function simulatedRequest(app, remoteAddress, route, { method = 'GET', headers = {}, data } = {}) {
  const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
  Object.assign(req, { method, url: route, headers: { host: 'localhost', 'x-cinema-client': 'local', ...headers }, socket: { remoteAddress } });
  const result = { headers: {} };
  const res = { setHeader(name, value) { result.headers[name] = value; }, writeHead(status) { result.status = status; }, end(value) { result.json = JSON.parse(value); } };
  await app.server.listeners('request')[0](req, res);
  return result;
}

test('真实 IPv4 + IPv6 环回同端口：建管理员、登录、鉴权、网络状态、Range 和跨源保护', async t => {
  const env = await temporaryApp(t); if (!env) return;
  const { app, port, request, dataDir } = env;
  assert.equal(app.server.address().address, '127.0.0.1');
  assert.equal(app.ipv6Server.address().address, '::1');
  assert.equal(app.ipv6Server.address().port, port);
  for (const ipv6 of [false, true]) assert.equal((await request({ ipv6 })).json.needsSetup, true);
  assert.equal((await request({ ipv6: true, route: '/api/library' })).status, 401);
  const cookie = await setup(request);
  for (const ipv6 of [false, true]) {
    const response = await request({ ipv6, route: '/api/library', headers: { Cookie: cookie } });
    assert.equal(response.status, 200); assert.equal(response.json.canLaunchLocalPlayer, true);
  }
  const network = await request({ ipv6: true, route: '/api/admin/network', headers: { Cookie: cookie } });
  assert.equal(network.json.running.enableIpv6, true);
  assert.equal(network.json.running.allowLan, false);
  assert.equal(network.json.restartRequired, false);
  assert.deepEqual(network.json.urls, [`http://127.0.0.1:${port}`, `http://[::1]:${port}`]);
  const filename = path.join(dataDir, 'video.mp4'); await fs.writeFile(filename, '0123456789abcdef');
  app.store.state.movies.push({ id: 'ipv6-media', kind: 'local', title: 'IPv6 Test', filePath: filename, rootPath: dataDir, genres: [] });
  for (const ipv6 of [false, true]) {
    const response = await request({ ipv6, route: '/media/ipv6-media/video', headers: { Cookie: cookie, Range: 'bytes=4-9' } });
    assert.equal(response.status, 206); assert.equal(response.text, '456789'); assert.equal(response.headers['content-range'], 'bytes 4-9/16');
  }
  const csrf = await request({ ipv6: true, route: '/api/preferences', method: 'POST', headers: { Cookie: cookie, Origin: `http://127.0.0.1:${port}` }, data: { theme: 'light' } });
  assert.equal(csrf.status, 403);
  assert.equal((await request({ ipv6: true, headers: { Host: '[fd12::666]:3210' } })).status, 403);
});

test('默认只启动 IPv4；IPv6 Host 不因新功能被默认放行', async t => {
  const env = await temporaryApp(t, false); if (!env) return;
  assert.equal(env.app.ipv6Server.listening, false);
  assert.equal((await env.request({})).status, 200);
  assert.equal((await env.request({ headers: { Host: '[::1]:3210' } })).status, 403);
});

test('IPv6 网络扩展需单独确认；旧客户端不关开关；保存不热切换；普通用户/令牌不能改网络', async t => {
  const env = await temporaryApp(t); if (!env) return;
  const { app, port, request } = env;
  const cookie = await setup(request), headers = { Cookie: cookie };
  const save = data => request({ ipv6: true, route: '/api/admin/network', method: 'POST', headers, data: { port, ...data } });
  assert.equal((await save({ allowLan: true, enableIpv6: true })).status, 400);
  assert.equal((await save({ allowLan: true, enableIpv6: true, confirmLan: true })).status, 400);
  const confirmed = await save({ allowLan: true, enableIpv6: true, confirmLan: true, confirmIpv6: true });
  assert.equal(confirmed.status, 200); assert.equal(confirmed.json.restartRequired, true);
  assert.equal(confirmed.json.running.allowLan, false);
  assert.equal(app.server.address().address, '127.0.0.1'); assert.equal(app.ipv6Server.address().address, '::1');
  const legacy = await save({ allowLan: true }); assert.equal(legacy.status, 200); assert.equal(legacy.json.saved.enableIpv6, true);
  assert.equal((await save({ allowLan: false, enableIpv6: 'yes' })).status, 400);
  const savedLocal = await save({ allowLan: false, enableIpv6: true }); assert.equal(savedLocal.status, 200);
  assert.equal((await save({ allowLan: true, enableIpv6: true, confirmLan: true })).status, 400);
  await request({ ipv6: true, route: '/api/admin/users', method: 'POST', headers, data: { username: 'ipv6-viewer-test', password: 'y' } });
  const login = await request({ ipv6: true, route: '/api/auth/login', method: 'POST', data: { username: 'ipv6-viewer-test', password: 'y' } });
  const viewerCookie = login.headers['set-cookie'][0].split(';')[0];
  assert.equal((await request({ ipv6: true, route: '/api/admin/network', headers: { Cookie: viewerCookie } })).status, 403);
  assert.equal((await request({ ipv6: true, route: '/api/admin/network', method: 'POST', headers: { Cookie: viewerCookie }, data: { port, allowLan: true, enableIpv6: true, confirmLan: true, confirmIpv6: true } })).status, 403);
  const issued = await request({ ipv6: true, route: '/api/admin/tokens', method: 'POST', headers, data: { scope: 'read' } });
  const bearer = { Authorization: `Bearer ${issued.json.token}` };
  assert.equal((await request({ ipv6: true, route: '/api/admin/network', headers: bearer })).status, 403);
  assert.equal((await request({ ipv6: true, route: '/api/admin/diagnostics', headers: bearer })).status, 200);
  // Simulated remote socket tests are policy checks, not a LAN connectivity claim.
  const remote = 'fd12::1234';
  assert.equal((await simulatedRequest(app, remote, '/api/library', { headers: { cookie } })).json.canLaunchLocalPlayer, false);
  assert.equal((await simulatedRequest(app, remote, '/api/players', { headers: { cookie } })).json.supported, false);
  assert.equal((await simulatedRequest(app, remote, '/api/movies/ipv6-media/open-external', { method: 'POST', headers: { cookie }, data: {} })).status, 403);
  assert.equal((await simulatedRequest(app, remote, '/api/admin/diagnostics', { headers: { authorization: bearer.Authorization } })).status, 403);
  assert.equal((await simulatedRequest(app, remote, '/api/auth/setup', { method: 'POST', data: {} })).status, 403);
  const off = await save({ allowLan: false, enableIpv6: false, enableDiscovery: true }); assert.equal(off.json.restartRequired, true);
  assert.equal(off.json.running.enableIpv6, true);
  await closeListeners(app);
  app.listenConfig.enableIpv6 = app.store.state.network.enableIpv6;
  await startListening(app, { port: 0 });
  assert.equal(app.ipv6Server.listening, false);
});

test('真实 IPv6 端口冲突回滚 IPv4 监听，不关闭原占用者', async t => {
  const blocker = http.createServer();
  t.after(async () => { if (blocker.listening) await new Promise(resolve => blocker.close(resolve)); });
  blocker.listen({ host: '::1', port: 0, ipv6Only: true });
  try { await once(blocker, 'listening'); }
  catch (error) {
    if (['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT'].includes(error.code)) return t.skip('OS IPv6 unavailable');
    throw error;
  }
  const app = { server: http.createServer(), ipv6Server: http.createServer(), listenConfig: { port: blocker.address().port, allowLan: false, enableIpv6: true } };
  t.after(() => closeListeners(app));
  await assert.rejects(startListening(app), { code: 'EADDRINUSE' });
  assert.equal(app.server.listening, false); assert.equal(app.ipv6Server.listening, false); assert.equal(blocker.listening, true);
});

test('重新创建服务读取已保存的 IPv6 开关，双栈启动后原登录仍有效', async t => {
  const env = await temporaryApp(t); if (!env) return;
  const { app, dataDir, port, request } = env;
  const cookie = await setup(request);
  const saved = await request({ ipv6: true, route: '/api/admin/network', method: 'POST', headers: { Cookie: cookie }, data: { port, allowLan: false, enableIpv6: true } });
  assert.equal(saved.status, 200);
  await closeListeners(app);
  const restarted = await createApp({ dataDir });
  try {
    assert.equal(restarted.listenConfig.enableIpv6, true);
    assert.equal(restarted.listenConfig.allowLan, false);
    const nextPort = await startListening(restarted, { port: 0 });
    for (const ipv6 of [true, false]) assert.equal((await rawRequest(nextPort, { ipv6, route: '/api/library', headers: { Cookie: cookie } })).status, 200);
  } finally { await closeListeners(restarted); }
});

test('图形化后台提供 IPv6 开关、独立风险确认、当前协议和重启状态', async () => {
  const html = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const js = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  for (const field of ['name="enableIpv6"', 'name="confirmIpv6"', 'id="network-ipv6-confirm-label"', 'id="network-ipv6-note"']) assert.ok(html.includes(field));
  assert.ok(html.includes('公网 IPv6 可能无需端口映射'));
  assert.ok(js.includes("['当前协议', data.running.enableIpv6 ? 'IPv4 + IPv6' : '仅 IPv4']"));
});
