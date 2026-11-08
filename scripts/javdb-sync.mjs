// 按 JavDB 补全片库的日期 / 片商 / 系列 / 女优 / 封面。找不到的条目直接跳过，不中断整批。
// 只读抓取公开详情页，逐条限速；默认只生成/更新计划文件，--apply 才写入影院（POST /api/movies/:id/facts）。
//
// 常用：
//   node scripts/javdb-sync.mjs                     # 全库补全，找不到的跳过
//   node scripts/javdb-sync.mjs --only-missing      # 只处理仍缺日期/片商/封面的影片
//   node scripts/javdb-sync.mjs --apply             # 抓取后写入影院
//   node scripts/javdb-sync.mjs --apply-only        # 不抓取，直接把现有计划写入影院
//   node scripts/javdb-sync.mjs --refresh           # 忽略缓存重新抓
//   node scripts/javdb-sync.mjs --retry-failed      # 连同历史失败条目一起重试
//   node scripts/javdb-sync.mjs --limit 20 --offset 40
//
// 环境变量：JAVDB_PROXY（默认 http://127.0.0.1:8194）、JAVDB_ORIGIN、SCREENROOM_URL、SCREENROOM_TOKEN。

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const argv = process.argv.slice(2);
const options = new Map();
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith('--')) continue;
  const eq = arg.indexOf('=');
  if (eq > 0) { options.set(arg.slice(2, eq), arg.slice(eq + 1)); continue; }
  const next = argv[i + 1];
  if (next !== undefined && !next.startsWith('--')) { options.set(arg.slice(2), next); i++; } else options.set(arg.slice(2), true);
}
const opt = name => options.get(name);
const flag = name => opt(name) === true;
const number = (name, fallback) => { const v = opt(name); if (v === undefined || v === true) return fallback; const n = Number(v); return Number.isFinite(n) ? n : fallback; };

const onlyMissing = flag('only-missing');
const refresh = flag('refresh');
const applyOnly = flag('apply-only');
const retryFailed = flag('retry-failed');
const actorsOnly = flag('actors-only');
const aliasesOnly = flag('aliases-only');
const genresOnly = flag('genres-only');
const doApply = flag('apply') || applyOnly;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
// 代理顺序：命令行 --proxy > 环境变量 > Windows 系统代理 > 常见本地端口
function detectProxy() {
  if (opt('proxy') && opt('proxy') !== true) return String(opt('proxy'));
  if (process.env.JAVDB_PROXY) return process.env.JAVDB_PROXY;
  try {
    const output = execFileSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyServer'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    const match = output.match(/ProxyServer\s+REG_SZ\s+(.+)/);
    if (match) {
      const raw = match[1].trim();
      const httpPart = raw.split(';').map(part => part.trim()).find(part => part.startsWith('http='));
      const address = httpPart ? httpPart.slice(5) : raw;
      if (/^[\w.-]+:\d+$/.test(address)) return `http://${address}`;
    }
  } catch { /* 无系统代理 */ }
  return 'http://127.0.0.1:7897';
}
const PROXY = detectProxy();
const ORIGIN = process.env.JAVDB_ORIGIN || 'https://javdb.com';
const COVERS = path.join(root, 'data', 'covers');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = (base, spread) => base + Math.floor(Math.random() * spread);

// 开跑前先确认代理能通，避免整批静默变成「无匹配条目」
try {
  const code = execFileSync('curl.exe', ['-s', '-o', 'NUL', '-w', '%{http_code}', '--max-time', '20', '--ssl-no-revoke', '--proxy', PROXY, '-A', UA, `${ORIGIN}/`], { encoding: 'utf8', timeout: 30000, windowsHide: true }).trim();
  if (code !== '200') console.warn(`[警告] 代理 ${PROXY} 访问 ${ORIGIN} 返回 ${code || '无响应'}，本批请求可能全部失败。用 --proxy http://IP:端口 指定可用代理。`);
  else console.log(`代理 ${PROXY} 连通正常`);
} catch {
  console.warn(`[警告] 代理 ${PROXY} 不可用，本批请求可能全部失败。用 --proxy http://IP:端口 指定可用代理。`);
}

const scratch = mkdtempSync(path.join(tmpdir(), 'javdb-'));
let requestCount = 0;

function fetchPage(url, attempt = 1) {
  const file = path.join(scratch, `p${++requestCount}.html`);
  try {
    execFileSync('curl.exe', ['-s', '--max-time', '45', '--ssl-no-revoke', '--proxy', PROXY, '-A', UA,
      '-H', 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
      '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      '-H', 'Referer: https://javdb.com/', '-o', file, url], { stdio: 'ignore', timeout: 60000 });
    const html = readFileSync(file, 'utf8');
    if (html.length < 3000 || /Just a moment|cf-browser-verification|請稍候|请稍候/.test(html)) return null;
    return html;
  } catch { return null; }
}

function downloadCover(url, destination) {
  try {
    execFileSync('curl.exe', ['-s', '--max-time', '45', '--ssl-no-revoke', '--proxy', PROXY, '-A', UA,
      '-H', 'Referer: https://javdb.com/', '-o', destination, url], { stdio: 'ignore', timeout: 60000 });
    return existsSync(destination) && statSync(destination).size > 4000;
  } catch { return false; }
}

const ACTORS = path.join(root, 'data', 'actors');
const actorIndexFile = path.join(root, 'data', 'actors-index.json');
const normName = value => String(value || '').normalize('NFKC').replace(/[\s　・·.]/g, '').toLowerCase();
// 一个演员可能有多个名字：全角/半角、空格、中点、括注别名都归一
const nameVariants = value => {
  const text = String(value || '').normalize('NFKC');
  const out = new Set();
  const push = part => { const normal = normName(part); if (normal) out.add(normal); };
  push(text);
  push(text.replace(/[（(][^）)]*[）)]/g, ''));
  for (const match of text.matchAll(/[（(]([^）)]*)[）)]/g)) push(match[1]);
  return out;
};
const sameName = (a, b) => {
  for (const left of nameVariants(a)) if (nameVariants(b).has(left)) return true;
  return false;
};
const readJSON = (file, fallback) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; } };
const actorIndex = (() => { const value = readJSON(actorIndexFile, {}); return value && !Array.isArray(value) ? value : {}; })();
const saveActorIndex = () => { try { writeFileSync(actorIndexFile, JSON.stringify(actorIndex, null, 2)); } catch { /* 只读环境忽略 */ } };

// 一个演员可能有好几个名字：先按 JavDB 演员 ID 找，再按规范化名字在索引里找同一人
function findActorFile(actor) {
  const direct = path.join(ACTORS, `${actor.id}.jpg`);
  if (existsSync(direct) && statSync(direct).size > 2500) return { id: actor.id, file: `/media/actors/${actor.id}.jpg` };
  const target = normName(actor.name);
  for (const [id, record] of Object.entries(actorIndex)) {
    if (!record?.file) continue;
    if ((record.names || []).some(name => sameName(name, actor.name))) return { id, file: record.file };
  }
  return null;
}

function rememberActor(id, name, file) {
  const record = actorIndex[id] || { names: [], file: '' };
  record.names = [...new Set([...(record.names || []), name].filter(Boolean))].slice(-8);
  record.file = file;
  record.updatedAt = new Date().toISOString();
  actorIndex[id] = record;
}

// 演员页顶部会列全部名字，形如「栗宮雙葉, 栗宮ふたば」
function fetchActorAliases(id) {
  const html = fetchPage(`${ORIGIN}/actors/${encodeURIComponent(id)}`);
  if (!html) return null;
  const block = html.match(/<span class="actor-section-name">([\s\S]*?)<\/span>/)?.[1];
  if (!block) return [];
  return decode(block).split(/[,，、|]/).map(name => name.trim()).filter(Boolean);
}

// 返回 { 片库里的名字: /media/actors/<id>.jpg }，名字对不上时用 JavDB 的名字
function actorsFor(list, cast) {
  const photos = {};
  const castNames = String(cast || '').split(/\s*[/／、,，|]\s*/).filter(Boolean);
  for (const actor of list) {
    let hit = findActorFile(actor);
    if (!hit) {
      const target = path.join(ACTORS, `${actor.id}.jpg`);
      const url = `https://c0.jdbstatic.com/avatars/${actor.id.slice(0, 2).toLowerCase()}/${actor.id}.jpg`;
      if (downloadCover(url, target)) hit = { id: actor.id, file: `/media/actors/${actor.id}.jpg` };
    }
    if (!hit) continue;
    rememberActor(hit.id, actor.name, hit.file);
    const record = actorIndex[hit.id];
    if (record && !record.aliasesCheckedAt) {
      const aliases = fetchActorAliases(hit.id);
      if (aliases) {
        record.names = [...new Set([...(record.names || []), ...aliases])].slice(-12);
        record.aliasesCheckedAt = new Date().toISOString();
      }
    }
    const key = castNames.find(name => sameName(name, actor.name)) || actor.name;
    photos[key] = hit.file;
  }
  saveActorIndex();
  return photos;
}

const decode = text => text  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();

function field(html, label) {
  const re = new RegExp(`<strong>${label}[：:]*</strong>[\\s\\S]{0,400}?<span class="value">([\\s\\S]*?)</span>`);
  const match = html.match(re);
  return match ? decode(match[1]) : '';
}

function actresses(html) {
  const block = html.match(/<strong>演員[：:]*<\/strong>[\s\S]{0,2500}?<\/span>\s*<\/div>/)?.[0] || '';
  const female = [...block.matchAll(/<a class="actor-female"[^>]*>([\s\S]*?)<\/a>/g)].map(m => decode(m[1])).filter(Boolean);
  const everybody = [...block.matchAll(/<a href="\/actors\/[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map(m => decode(m[1])).filter(Boolean);
  return (female.length ? female : everybody).join(' / ');
}

// 类别：详情页「類別」区块里的标签链接
function genreList(html) {
  const block = html.match(/<strong>類別[：:]*<\/strong>[\s\S]{0,3000}?<\/span>\s*<\/div>/)?.[0] || '';
  return [...new Set([...block.matchAll(/<a href="\/tags\?[^"]*">([\s\S]*?)<\/a>/g)].map(m => decode(m[1])).filter(Boolean))].slice(0, 24);
}

// 演员条目：女优先，带 JavDB 演员 ID 便于头像归并
function actressList(html) {
  const block = html.match(/<strong>演員[：:]*<\/strong>[\s\S]{0,2500}?<\/span>\s*<\/div>/)?.[0] || '';
  const all = [...block.matchAll(/<a([^>]*?)href="\/actors\/([^"]+)"([^>]*?)>([\s\S]*?)<\/a>/g)]
    .map(m => ({ id: m[2], name: decode(m[4]), female: /actor-female/.test(m[1] + m[3]) }))
    .filter(actor => actor.name && actor.id);
  const female = all.filter(actor => actor.female);
  return (female.length ? female : all).map(({ id, name }) => ({ id, name }));
}

function codeOf(title) {
  const text = String(title || '').trim();
  const fc2 = text.match(/^(FC2[-_ ]?(?:PPV[-_ ]?)?\d{4,8})/i);
  if (fc2) return fc2[1].replace(/[_ ]/g, '-').replace(/-+/g, '-').toUpperCase();
  const standard = text.match(/^([A-Za-z]{2,10}[-_]\d{2,6})/);
  if (standard) return standard[1].replace('_', '-').toUpperCase();
  const loose = text.match(/^(FC2|T28|HEYZO)[-_]?(\d{3,8})/i);
  return loose ? `${loose[1].toUpperCase()}-${loose[2]}` : '';
}

const candidates = searchHtml => [...new Set([...searchHtml.matchAll(/href="(\/v\/[^"?#]+)"/g)].map(m => m[1]))].slice(0, 4);

async function searchPaths(code) {
  let html = null;
  for (let i = 0; i < 3 && !html; i++) { html = fetchPage(`${ORIGIN}/search?q=${encodeURIComponent(code)}&f=all`); if (!html) await sleep(jitter(2500, 2000)); }
  return html ? candidates(html) : null;
}

async function resolve(code) {
  const variants = [code];
  const fc2 = code.match(/^FC2-(\d{4,8})$/);
  if (fc2) variants.push(`FC2-PPV-${fc2[1]}`);
  for (const variant of variants) {
    const paths = await searchPaths(variant);
    if (!paths || !paths.length) continue;
    for (const detailPath of paths) {
      await sleep(jitter(900, 600));
      let html = null;
      for (let i = 0; i < 2 && !html; i++) { html = fetchPage(`${ORIGIN}${detailPath}`); if (!html) await sleep(jitter(2500, 2000)); }
      if (!html) continue;
      const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] || '');
      const foundCode = (field(html, '番號') || '').replace(/\s+/g, '').toUpperCase();
      if (foundCode && foundCode !== variant.toUpperCase()) continue;
      if (!foundCode && !title.toUpperCase().includes(variant.toUpperCase())) continue;
      const dateText = field(html, '日期');
      return {
        detailPath, title,
        releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? dateText : '',
        studios: field(html, '片商') ? [field(html, '片商')] : [],
        series: field(html, '系列') ? [field(html, '系列')] : [],
        cast: actresses(html),
        actresses: actressList(html),
        genres: genreList(html),
        duration: field(html, '時長'),
        coverUrl: html.match(/<img[^>]*class="video-cover"[^>]*src="([^"]+)"/)?.[1] || '',
        code: foundCode || variant,
      };
    }
  }
  return { error: 'JavDB 无匹配条目' };
}

// —— 片库 ——
const libraryFile = path.join(root, 'data', 'library.json');
if (!existsSync(libraryFile)) throw new Error('找不到 data/library.json');
const library = JSON.parse(readFileSync(libraryFile, 'utf8'));
const planFile = path.join(root, 'data', 'javdb-plan.json');
const failedFile = path.join(root, 'data', 'javdb-failed.json');

let cache = {};
let failureRecords = [];
try { for (const movie of JSON.parse(readFileSync(planFile, 'utf8')).movies || []) cache[movie.id] = movie; } catch { cache = {}; }
try { failureRecords = JSON.parse(readFileSync(failedFile, 'utf8')).failures || []; } catch { failureRecords = []; }
const knownFailures = new Set(failureRecords.map(entry => entry.id));
const recordFailure = entry => {
  const index = failureRecords.findIndex(item => item.id === entry.id);
  if (index >= 0) failureRecords[index] = entry; else failureRecords.push(entry);
  knownFailures.add(entry.id);
};

const cachedIds = new Set(Object.keys(cache));
const strict = flag('strict');
const filled = movie => strict
  ? Boolean(movie.poster && movie.manualFacts?.releaseDate && (movie.manualFacts?.studios || []).length && String(movie.manualFacts?.cast || '').trim())
  : Boolean(movie.poster);
const all = library.movies.map(movie => ({ id: movie.id, title: movie.title, code: codeOf(movie.title), cached: cachedIds.has(movie.id), filled: filled(movie) }));
const outstanding = movie => !movie.cached && !movie.filled;

let work = onlyMissing ? all.filter(outstanding) : all;
if (!retryFailed && !applyOnly) work = work.filter(movie => !knownFailures.has(movie.id) || cache[movie.id]);
const offset = number('offset', 0);
const limit = number('limit', 0);
const slice = work.slice(offset, limit > 0 ? offset + limit : undefined);

const plan = Object.values(cache);
const failures = [];
const writeJSON = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2));
const persist = () => {
  writeJSON(planFile, { generatedAt: new Date().toISOString(), proxy: PROXY, processed: plan.length + failureRecords.length, matched: plan.length, failed: failureRecords.length, movies: plan, failures: failureRecords });
  writeJSON(failedFile, { updatedAt: new Date().toISOString(), failures: failureRecords });
};

console.log(`片库 ${library.movies.length} 部；候选 ${work.length} 部；本次处理 ${slice.length} 部（offset ${offset}，已抓取 ${cachedIds.size}，已完整跳过 ${all.filter(movie => movie.filled).length}，历史失败 ${knownFailures.size}）`);

let reused = 0;
if (aliasesOnly) {
  const pending = Object.entries(actorIndex).filter(([, record]) => !record.aliasesCheckedAt).slice(offset, limit > 0 ? offset + limit : undefined);
  console.log(`别名补抓：索引 ${Object.keys(actorIndex).length} 位，待检查 ${pending.length} 位`);
  for (const [index, [id, record]] of pending.entries()) {
    await sleep(jitter(900, 500));
    const aliases = fetchActorAliases(id);
    if (!aliases) { console.log(`[${index + 1}/${pending.length}] ${id} ✗ 演员页读取失败`); continue; }
    record.names = [...new Set([...(record.names || []), ...aliases])].slice(-12);
    record.aliasesCheckedAt = new Date().toISOString();
    saveActorIndex();
    console.log(`[${index + 1}/${pending.length}] ${id} ${record.names.join(' / ')}`);
  }
  saveActorIndex();
}
if (genresOnly) {
  const targets = plan.slice(offset, limit > 0 ? offset + limit : undefined);
  console.log(`类别补抓：计划 ${plan.length} 条，本次 ${targets.length} 条`);
  for (const [index, record] of targets.entries()) {
    if (!record.detailPath) continue;
    if (!refresh && record.genres && record.genres.length) continue;
    await sleep(jitter(700, 500));
    let html = null;
    for (let attempt = 0; attempt < 3 && !html; attempt++) { html = fetchPage(`${ORIGIN}${record.detailPath}`); if (!html) await sleep(jitter(2500, 2000)); }
    if (!html) { console.log(`[${index + 1}/${targets.length}] ${record.code} ✗ 详情页读取失败`); continue; }
    record.genres = genreList(html);
    record.series = field(html, '系列') ? [field(html, '系列')] : record.series || [];
    console.log(`[${index + 1}/${targets.length}] ${record.code} 类别 ${record.genres.length}: ${record.genres.join('、')}`);
    persist();
  }
}
if (actorsOnly) {
  const targets = plan.slice(offset, limit > 0 ? offset + limit : undefined);
  console.log(`演员头像补抓：计划 ${plan.length} 条，本次 ${targets.length} 条`);
  for (const [index, record] of targets.entries()) {
    if (!record.detailPath) continue;
    await sleep(jitter(700, 500));
    let html = null;
    for (let attempt = 0; attempt < 2 && !html; attempt++) { html = fetchPage(`${ORIGIN}${record.detailPath}`); if (!html) await sleep(jitter(2000, 1500)); }
    if (!html) { console.log(`[${index + 1}/${targets.length}] ${record.code} ✗ 详情页读取失败`); continue; }
    const list = actressList(html);
    record.actorPhotos = actorsFor(list, record.cast);
    console.log(`[${index + 1}/${targets.length}] ${record.code} 头像 ${Object.keys(record.actorPhotos).length}/${list.length}`);
    persist();
  }
  saveActorIndex();
  persist();
}
if (!applyOnly && !actorsOnly && !aliasesOnly && !genresOnly) {
  for (const [index, movie] of slice.entries()) {
    const label = `[${index + 1}/${slice.length}]`;
    if (!movie.code) { recordFailure({ id: movie.id, title: movie.title, reason: '标题中未识别出番号' }); failures.push({ id: movie.id, title: movie.title, reason: '标题中未识别出番号' }); console.log(`${label} ✗ 无番号，跳过`); persist(); continue; }
    if (!refresh && cache[movie.id]) { reused++; console.log(`${label} ${movie.code} ↺ 使用缓存`); continue; }
    const result = await resolve(movie.code);
    if (result.error) {
      recordFailure({ id: movie.id, title: movie.title, code: movie.code, reason: result.error }); failures.push({ id: movie.id, title: movie.title, code: movie.code, reason: result.error });
      console.log(`${label} ${movie.code} ✗ ${result.error}，跳过`);
      persist();
      if (index < slice.length - 1) await sleep(jitter(1200, 800));
      continue;
    }
    let poster = cache[movie.id]?.poster || '';
    const destination = path.join(COVERS, `${movie.id}.jpg`);
    if (!existsSync(destination) || statSync(destination).size < 4000) {
      if (result.coverUrl && downloadCover(result.coverUrl, destination)) poster = `/media/covers/${movie.id}.jpg`;
    } else poster = `/media/covers/${movie.id}.jpg`;
    const record = { id: movie.id, code: result.code, title: movie.title, releaseDate: result.releaseDate, studios: result.studios, series: result.series, cast: result.cast, duration: result.duration, genres: result.genres, poster, detailPath: result.detailPath, actorPhotos: actorsFor(result.actresses || [], result.cast) };
    if (knownFailures.delete(movie.id)) {
      const failedIndex = failureRecords.findIndex(item => item.id === movie.id);
      if (failedIndex >= 0) failureRecords.splice(failedIndex, 1);
    }
    const existing = plan.findIndex(item => item.id === movie.id);
    if (existing >= 0) plan[existing] = record; else plan.push(record);
    console.log(`${label} ${movie.code} ✓ ${record.releaseDate || '-'} | ${record.studios.join(',') || '-'} | ${record.cast || '-'} | ${poster ? '封面✓' : '封面✗'} | 头像${Object.keys(record.actorPhotos).length}`);
    persist();
    if (index < slice.length - 1) await sleep(jitter(1400, 900));
  }
}
persist();
console.log(`\n计划：${planFile}（命中 ${plan.length}，本轮失败 ${failures.length}，复用缓存 ${reused}）`);
if (failures.length) console.log('失败明细：' + failures.map(item => `${item.code || item.id}`).join(', '));

if (!doApply) { console.log('未写入影院；加 --apply 或 --apply-only 才会提交。'); process.exit(0); }

// —— 写入影院 ——
const base = new URL(process.env.SCREENROOM_URL || 'http://127.0.0.1:3210');
const readDpapiToken = file => {
  if (!existsSync(file)) return '';
  try {
    return execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      '$s = Get-Content -LiteralPath $env:F -Raw | ConvertTo-SecureString; $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }'],
      { env: { ...process.env, F: file }, encoding: 'utf8', windowsHide: true }).trim();
  } catch { return ''; }
};
const tokenWorks = async candidate => {
  try {
    const response = await fetch(new URL('/api/library', base), { headers: { Authorization: `Bearer ${candidate}`, 'x-cinema-client': 'local' }, signal: AbortSignal.timeout(10000), redirect: 'error' });
    return response.ok;
  } catch { return false; }
};
// 令牌可能被重新生成或撤销：按「界面最近填写 → MCP 启动器」顺序挑一个真正可用的
const tokenCandidates = [...new Set([
  process.env.SCREENROOM_TOKEN,
  readDpapiToken(path.join(root, 'data', 'javdb-ui-token.dpapi')),
  readDpapiToken(path.join(root, 'data', 'mcp-facts-token.dpapi')),
].filter(Boolean))];
let token = '';
for (const candidate of tokenCandidates) {
  if (await tokenWorks(candidate)) { token = candidate; break; }
}
if (!token) throw new Error(`没有可用的调试令牌（试过 ${tokenCandidates.length} 个）。请确认服务在 ${base.origin} 运行，并在网站后台或界面里重新填写未撤销的令牌。`);
console.log(`使用令牌 ${token.slice(0, 10)}…（共试 ${tokenCandidates.length} 个）`);

const currentById = new Map(library.movies.map(movie => [movie.id, movie]));
const sameAsLibrary = (id, facts) => {
  const current = currentById.get(id);
  if (!current) return false;
  if ((current.poster || '') !== (facts.poster || '')) return false;
  const manual = current.manualFacts || {};
  if ((manual.releaseDate || '') !== (facts.releaseDate || '')) return false;
  if (JSON.stringify(manual.studios || []) !== JSON.stringify(facts.studios || [])) return false;
  if (JSON.stringify(manual.series || []) !== JSON.stringify(facts.series || [])) return false;
  if ((manual.cast || '') !== (facts.cast || '')) return false;
  if (facts.metadataGenres && [...(current.metadataGenres || [])].sort().join('|') !== [...facts.metadataGenres].sort().join('|')) return false;
  if (facts.actorPhotos) {
    const currentActors = new Map((current.actors || []).map(actor => [actor.name, actor.photo || '']));
    for (const [name, photo] of Object.entries(facts.actorPhotos)) if (currentActors.get(name) !== photo) return false;
  }
  if (facts.duration && (manual.duration || '') !== facts.duration) return false;
  return true;
};

let written = 0, skippedWrite = 0, failedWrite = 0;
for (const movie of plan) {
  const facts = {};
  if (movie.releaseDate) facts.releaseDate = movie.releaseDate;
  if (movie.studios?.length) facts.studios = movie.studios;
  if (movie.series?.length) facts.series = movie.series;
  if (movie.cast) facts.cast = movie.cast;
  if (movie.poster) facts.poster = movie.poster;
  if (movie.actorPhotos && Object.keys(movie.actorPhotos).length) facts.actorPhotos = movie.actorPhotos;
  if (movie.genres && movie.genres.length) facts.metadataGenres = movie.genres;
  if (!Object.keys(facts).length) { skippedWrite++; continue; }
  if (sameAsLibrary(movie.id, facts)) { skippedWrite++; continue; }
  const response = await fetch(new URL(`/api/movies/${encodeURIComponent(movie.id)}/facts`, base), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-cinema-client': 'local' },
    body: JSON.stringify(facts), redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  if (response.ok) written++;
  else { failedWrite++; console.log(`写入 ${movie.code} ✗ HTTP ${response.status}`); }
  await sleep(120);
}
console.log(`写入完成：更新 ${written} 部，无变化跳过 ${skippedWrite} 部，失败 ${failedWrite} 部。`);
