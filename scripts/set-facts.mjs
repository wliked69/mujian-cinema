// 手动资料字段（日期 / 片商 / 系列 / 演员 / 时长）本机命令行工具。
// 说明：POST /api/movies/:id/facts 需要管理员浏览器会话，调试令牌（含 MCP 桥接）不在此接口的白名单内，
// 因此本工具用账号登录换取 Cookie 会话，而不是 Bearer 令牌。只改网站索引，不触碰视频文件与 NFO。
//
// 用法：
//   node scripts/set-facts.mjs <movieId> --release=2014-11-07 --studios="A / B" --series="X" --cast="甲 / 乙"
//   node scripts/set-facts.mjs <movieId> --json '{"releaseDate":"2014-11-07","studios":["A","B"]}'
//   Get-Content -Raw plan.json | node scripts/set-facts.mjs <movieId> --stdin
// 认证：SCREENROOM_USERNAME / SCREENROOM_PASSWORD 环境变量，或 --user / --password。
// 端口：SCREENROOM_URL，默认 http://127.0.0.1:3210。

const argv = process.argv.slice(2);
const fail = message => { process.stderr.write(`set-facts: ${message}\n`); process.exit(1); };

const movieId = argv[0];
if (!movieId || movieId.startsWith('--')) fail('缺少影片 ID。');
const options = new Map();
for (let i = 1; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith('--')) continue;
  const eq = arg.indexOf('=');
  if (eq > 0) { options.set(arg.slice(2, eq), arg.slice(eq + 1)); continue; }
  const next = argv[i + 1];
  if (next !== undefined && !next.startsWith('--')) { options.set(arg.slice(2), next); i++; } else options.set(arg.slice(2), true);
}
const option = name => options.get(name);
const flag = name => option(name) === true;

const user = process.env.SCREENROOM_USERNAME || option('user');
const password = process.env.SCREENROOM_PASSWORD || option('password');
if (!user || !password || user === true || password === true) fail('请通过 SCREENROOM_USERNAME / SCREENROOM_PASSWORD 或 --user / --password 提供管理员账号。');

const FIELDS = { release: 'releaseDate', studios: 'studios', series: 'series', cast: 'cast', duration: 'duration' };
let facts = {};
if (option('json')) {
  try { facts = JSON.parse(option('json')); } catch { fail('--json 不是有效 JSON。'); }
} else if (flag('stdin')) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  try { facts = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('stdin 不是有效 JSON。'); }
} else {
  for (const [name, key] of Object.entries(FIELDS)) {
    const value = option(name);
    if (value === undefined) continue;
    facts[key] = ['studios', 'series', 'cast'].includes(key) ? String(value).split(/\s*[/／、|]\s*/).filter(Boolean) : String(value);
  }
}
if (!Object.keys(facts).length) fail(`没有要修改的字段。可用：${Object.keys(FIELDS).map(k => `--${k}`).join(' ')} 或 --json / --stdin。`);

const base = new URL(process.env.SCREENROOM_URL || 'http://127.0.0.1:3210');
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname) || base.username || base.password || base.pathname !== '/') fail('仅允许本机 http://127.0.0.1:端口 或 http://localhost:端口。');

const localHeaders = { 'Content-Type': 'application/json', 'x-cinema-client': 'local' };
const timeout = () => AbortSignal.timeout(20000);

const login = await fetch(new URL('/api/auth/login', base), {
  method: 'POST',
  headers: localHeaders,
  body: JSON.stringify({ username: user, password, remember: false }),
  signal: timeout(),
  redirect: 'error',
});
const loginBody = await login.json().catch(() => ({}));
if (!login.ok) fail(loginBody.error || `登录失败：HTTP ${login.status}`);
const cookies = (login.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
if (!cookies) fail('登录成功但未收到会话 Cookie。');

const response = await fetch(new URL(`/api/movies/${encodeURIComponent(movieId)}/facts`, base), {
  method: 'POST',
  headers: { ...localHeaders, Cookie: cookies },
  body: JSON.stringify(facts),
  signal: timeout(),
  redirect: 'error',
});
const result = await response.json().catch(() => ({}));
if (!response.ok) fail(result.error || `HTTP ${response.status}`);

await fetch(new URL('/api/auth/logout', base), { method: 'POST', headers: { 'x-cinema-client': 'local', Cookie: cookies }, signal: timeout(), redirect: 'error' }).catch(() => {});
process.stdout.write(`${JSON.stringify({ id: result.id, title: result.title, year: result.year, releaseDate: result.releaseDate, studios: result.studios, series: result.series, cast: result.cast, duration: result.duration }, null, 2)}\n`);
