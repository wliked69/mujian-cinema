import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { startListening } from '../lib/network.mjs';

async function listener() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenroom-desktop-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
function launch(t, dir, port) {
  const script = "import { runDesktopServer } from './scripts/desktop-server.mjs'; await runDesktopServer({dataDir:process.argv[1]});";
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, dir], { env: { ...process.env, PORT: String(port) }, windowsHide: true });
  child.stdin.on('error', () => {});
  child.stderr.resume();
  const exited = once(child, 'close');
  const lines = createInterface({ input: child.stdout });
  const message = new Promise(resolve => {
    lines.once('line', resolve);
    child.once('close', () => resolve(null));
  });
  t.after(async () => { if (child.exitCode === null) child.kill(); await exited; });
  return { child, message, exited };
}

test('图形面板：服务就绪后可访问管理入口，使用私有管道关闭并释放端口', { timeout: 10000 }, async t => {
  const dir = await fixture(t);
  const reserved = await listener(), port = reserved.address().port;
  await new Promise(resolve => reserved.close(resolve));
  const run = launch(t, dir, port);
  assert.equal(await run.message, `READY ${port}`);
  const response = await fetch(`http://127.0.0.1:${port}/admin`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /\/covers\.css\?v=/);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/admin/users`)).status, 401);
  run.child.stdin.write('stop\n');
  assert.deepEqual(await run.exited, [0, null]);
  const again = launch(t, dir, port);
  assert.equal(await again.message, `READY ${port}`);
  again.child.stdin.write('shutdown\n');
  assert.deepEqual(await again.exited, [0, null]);
  const closedWindow = launch(t, dir, port);
  assert.equal(await closedWindow.message, `READY ${port}`);
  closedWindow.child.stdin.end();
  assert.deepEqual(await closedWindow.exited, [0, null]);
});

test('图形面板：端口冲突只报告错误，不接管或关闭旧服务', { timeout: 10000 }, async t => {
  const dir = await fixture(t);
  const existing = await listener();
  t.after(() => new Promise(resolve => existing.close(resolve)));
  const run = launch(t, dir, existing.address().port);
  assert.equal(await run.message, 'ERROR port');
  assert.deepEqual(await run.exited, [1, null]);
  assert.equal(existing.listening, true);
});

function api(base, route, data, headers = {}) {
  return fetch(base + route, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'X-Cinema-Client': 'local', 'Content-Type': 'application/json', Origin: base, ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}
const testPassword = () => randomBytes(16).toString('hex');
const responseCookie = response => response.headers.get('set-cookie').split(';', 1)[0];

test('网页关闭：仅同源管理员会话可确认，返回应答后服务退出并释放端口', { timeout: 10000 }, async t => {
  const dir = await fixture(t);
  const reserved = await listener(), port = reserved.address().port;
  await new Promise(resolve => reserved.close(resolve));
  const run = launch(t, dir, port);
  assert.equal(await run.message, `READY ${port}`);
  const base = `http://127.0.0.1:${port}`, route = '/api/admin/shutdown';
  const confirm = { confirm: true };
  assert.equal((await api(base, route, confirm)).status, 401);
  const setup = await api(base, '/api/auth/setup', { username: 'shutdown-admin', password: testPassword() });
  assert.equal(setup.status, 201);
  const admin = { Cookie: responseCookie(setup) };
  assert.equal((await (await api(base, '/api/admin/network', undefined, admin)).json()).canShutdown, true);
  const account = { username: 'shutdown-viewer', password: testPassword(), role: 'user' };
  assert.equal((await api(base, '/api/admin/users', account, admin)).status, 201);
  const viewer = await api(base, '/api/auth/login', account);
  assert.equal(viewer.status, 200);
  assert.equal((await api(base, route, confirm, { Cookie: responseCookie(viewer) })).status, 403);
  const token = await api(base, '/api/admin/tokens', { name: 'Shutdown QA', scope: 'write' }, admin);
  assert.equal(token.status, 201);
  assert.equal((await api(base, route, confirm, { Authorization: 'Bearer ' + (await token.json()).token })).status, 403);
  assert.equal((await api(base, route, undefined, admin)).status, 405);
  assert.equal((await api(base, route, confirm, { ...admin, Origin: 'http://elsewhere.test' })).status, 403);
  assert.equal((await api(base, route, confirm, { ...admin, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await api(base, route, {}, admin)).status, 400);
  assert.equal((await api(base, '/api/library', undefined, admin)).status, 200);
  const response = await api(base, route, confirm, admin);
  assert.equal(response.status, 202);
  assert.match((await response.json()).message, /已收到关闭请求/);
  assert.deepEqual(await run.exited, [0, null]);
  await assert.rejects(fetch(base, { signal: AbortSignal.timeout(1500) }));
  const disk = JSON.parse(await fs.readFile(path.join(dir, 'library.json'), 'utf8'));
  assert.equal(disk.users.length, 2);
  assert.ok(disk.audit.some(event => event.action === 'service.shutdown'));
  const restarted = launch(t, dir, port);
  assert.equal(await restarted.message, `READY ${port}`);
  restarted.child.stdin.end();
  assert.deepEqual(await restarted.exited, [0, null]);
});

test('网页关闭：同步进行中拒绝关闭，并能正常完成正在运行的任务', { timeout: 10000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenroom-shutdown-busy-'));
  let signalFetch, releaseFetch;
  const fetchStarted = new Promise(resolve => { signalFetch = resolve; });
  const gate = new Promise(resolve => { releaseFetch = resolve; });
  let calls = 0;
  const app = await createApp({ dataDir: dir, fetcher: async () => { signalFetch(); await gate; return new Response('[{"title":"测试影片"}]'); },
    onShutdown: () => { calls++; void app.shutdown(); } });
  t.after(async () => {
    releaseFetch();
    try { await app.shutdown(); } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  const base = 'http://127.0.0.1:' + await startListening(app, { port: 0 });
  const setup = await api(base, '/api/auth/setup', { username: 'busy-admin', password: testPassword() });
  assert.equal(setup.status, 201);
  const admin = { Cookie: responseCookie(setup) };
  assert.equal((await api(base, '/api/sources', { type: 'api', provider: 'generic', url: 'https://example.test/library' }, admin)).status, 200);
  assert.equal((await api(base, '/api/sync', {}, admin)).status, 202);
  await fetchStarted;
  const response = await api(base, '/api/admin/shutdown', { confirm: true }, admin);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /等待当前操作/);
  assert.equal(calls, 0);
  assert.equal((await api(base, '/api/library', undefined, admin)).status, 200);
  releaseFetch();
  await app.shutdown();
  assert.equal(app.getJob().status, 'done', app.getJob().warnings.join('; '));
});
