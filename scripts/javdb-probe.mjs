// 结构探测：抓 javdb 搜索结果与详情页，打印可用来提取字段的片段。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PROXY = process.env.JAVDB_PROXY || 'http://127.0.0.1:8194';

function get(url) {
  const file = `${process.env.TEMP}\\jdb-${Date.now()}-${Math.random().toString(16).slice(2)}.html`;
  execFileSync('curl.exe', ['-s', '--max-time', '40', '--ssl-no-revoke', '--proxy', PROXY, '-A', UA,
    '-H', 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8', '-H', 'Accept: text/html,application/xhtml+xml',
    '-o', file, url], { stdio: 'ignore' });
  try { return readFileSync(file, 'utf8'); } catch { return ''; }
}

const code = process.argv[2] || 'SAN-492';
const searchUrl = `https://javdb.com/search?q=${encodeURIComponent(code)}&f=all`;
const search = get(searchUrl);
console.log('search len', search.length);
const links = [...search.matchAll(/href="(\/v\/[^"]+)"/g)].map(m => m[1]);
console.log('detail links:', [...new Set(links)].slice(0, 5));
const titles = [...search.matchAll(/class="video-title[^"]*"[^>]*>\s*([^<]+)/g)].map(m => m[1].trim());
console.log('titles:', titles.slice(0, 5));
const box = search.match(/<div class="movie-list[^]*?<\/div>\s*<\/div>/)?.[0] || '';
console.log('page marker:', search.includes('验证') ? '可能有验证页' : '疑似正常页');
const detailPath = [...new Set(links)][0];
if (!detailPath) { process.exit(0); }
const detail = get(`https://javdb.com${detailPath}`);
console.log('detail len', detail.length, 'url', detailPath);
const marker = ['日期', '片商', '發行商', '系列', '演員', '時長', '番號'];
for (const label of marker) {
  const idx = detail.indexOf(`>${label}</strong>`);
  console.log(`--- ${label} @${idx} ---`);
  if (idx > 0) console.log(detail.slice(idx - 30, idx + 220).replace(/\s+/g, ' '));
}
const title = detail.match(/<title>([^<]*)<\/title>/)?.[1]?.trim();
console.log('detail title:', title);
const jsonLd = detail.match(/<script type="application\/ld\+json">([^]*?)<\/script>/)?.[1];
if (jsonLd) console.log('ld+json:', jsonLd.slice(0, 400).replace(/\s+/g, ' '));
