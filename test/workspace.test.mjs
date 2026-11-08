import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { sampleMovies } from '../public/movie-utils.js';
import { genrePlan } from '../lib/genres.mjs';

test('随机九宫格：去重、不修改片库、候选不足时只返回真实影片', () => {
  const movies = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, title: `电影${i}`, year: 2024 }));
  const copy = JSON.stringify(movies);
  const result = sampleMovies([...movies, { ...movies[0], id: 'duplicate-file' }], 9, () => .42);
  assert.equal(result.length, 9); assert.equal(new Set(result.map(m => `${m.title}:${m.year}`)).size, 9);
  assert.equal(JSON.stringify(movies), copy);
  assert.equal(sampleMovies(movies.slice(0, 3)).length, 3); assert.deepEqual(sampleMovies([]), []);
  assert.deepEqual(sampleMovies(movies, 0), []);
});

test('分类批次整批预检、冲突保护与预览不修改原对象', () => {
  const movies = [{ id: 'a', title: 'A', genres: ['旧分类'] }, { id: 'b', title: 'B', genres: ['旧分类'] }];
  const plan = genrePlan(movies, [{ id: 'a', genres: ['新分类'], expectedGenres: ['旧分类'] }, { id: 'b', genres: ['待看'] }]);
  assert.deepEqual(plan[0].change.after, ['新分类']); assert.deepEqual(movies[0].genres, ['旧分类']);
  assert.throws(() => genrePlan(movies, [{ id: 'a', genres: ['新分类'] }, { id: 'b', genres: Array(13).fill('标签') }]), /类别/);
  assert.deepEqual(movies[0].genres, ['旧分类']);
  assert.throws(() => genrePlan(movies, [{ id: 'a', genres: ['新分类'], expectedGenres: ['过期分类'] }]), error => error.status === 409);
  assert.throws(() => genrePlan(movies, Array(101).fill({ id: 'a', genres: ['新分类'] })), /100/);
});

test('宽窄屏共用一个设置入口，后台直接列在统一导航中，影片只有一种播放操作', async () => {
  const html = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size);
  assert.equal((html.match(/aria-label="设置"/g) || []).length, 1);
  assert.match(html, /class="settings-entry"[^>]*data-action="preferences"/);
  for (const panel of ['users', 'logins', 'network', 'debug']) assert.match(html, new RegExp(`data-setting-panel="${panel}"`));
  for (const id of ['admin-dialog', 'settings-dialog', 'account-dialog', 'player-open-external']) assert.equal(ids.includes(id), false);
  assert.doesNotMatch(app, /data-external=|'继续观看'|'开始播放'/);
  assert.match(html, /id="random-grid"/);
});

test('窄屏启用底部导航与演员入口，外观保存不提交服务器', async () => {
  const html = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = await fs.readFile(new URL('../public/mobile-layout.css', import.meta.url), 'utf8');
  const app = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(html, /mobile-layout\.css/);
  assert.match(html, /id="mobile-actors-toggle" aria-controls="actors-rail" aria-expanded="false"/);
  assert.match(css, /\.workspace\s*\{[^}]*margin-left: 0/);
  assert.match(css, /\.sidebar\s*\{[^}]*inset: auto 0 0/);
  assert.match(app, /if \(isAppearance\) \{\s*saveDeviceAppearance/);
  assert.match(app, /api\('\/api\/preferences', Object\.fromEntries\(\['playback', 'player'\]/);
});
