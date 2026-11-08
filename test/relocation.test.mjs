import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../server.mjs';
import { startListening, closeListeners } from '../lib/network.mjs';
import { scanDirectory } from '../lib/scanner.mjs';

test('迁移目录：不匹配则保留旧路径；正确迁移后保留影片、集数、资料与观看记录，重扫仍有效', { timeout: 10000 }, async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cinema-relocation-'));
  const oldRoot = path.join(temp, 'old'), newRoot = path.join(temp, 'new'), dataDir = path.join(temp, 'data');
  const relative = path.join('剧集', '测试剧');
  const content = { '第1集.mp4': 'fixture one', '第2集.mp4': 'fixture two', 'poster.jpg': 'fixture image',
    'tvshow.nfo': '<tvshow><title>测试剧</title><actor><name>甲</name></actor></tvshow>' };
  const stamp = new Date('2025-07-12T00:00:00Z');
  for (const root of [oldRoot, newRoot]) {
    const folder = path.join(root, relative);
    await fs.mkdir(folder, { recursive: true });
    for (const [name, bytes] of Object.entries(content)) {
      if (root === newRoot && name === '第2集.mp4') continue;
      const target = path.join(folder, name);
      await fs.writeFile(target, bytes); await fs.utimes(target, stamp, stamp);
    }
  }
  const source = { id: 'relocation-fixture', name: '迁移测试', type: 'local', path: oldRoot };
  const { movies } = await scanDirectory(source);
  const first = movies[0], episode = first.episodes[1].id;
  assert.equal(first.fileModifiedAt, stamp.toISOString());
  first.manualGenres = ['保留分类']; first.genres = ['保留分类'];
  first.manualFacts = { cast: '自填演员', releaseDate: '2024-03-02', poster: '/media/covers/fixture.jpg' };
  Object.assign(first, first.manualFacts);
  await fs.mkdir(dataDir);
  await fs.writeFile(path.join(dataDir, 'library.json'), JSON.stringify({ sources: [source], movies }));
  const app = await createApp({ dataDir });
  t.after(async () => { await closeListeners(app); await app.flush(); await fs.rm(temp, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + await startListening(app, { port: 0 });
  let cookie = '';
  const request = (url, data, headers = {}) => fetch(base + url, { method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Cinema-Client': 'local', cookie, ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const route = '/api/admin/sources/' + source.id + '/relocate';
  assert.equal((await request(route, { path: newRoot, confirm: true })).status, 401);
  const setup = await request('/api/auth/setup', { username: 'fixture-relocation', password: randomBytes(12).toString('hex') });
  assert.equal(setup.status, 201); cookie = setup.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/sources', { ...source, path: newRoot })).status, 409);
  assert.equal((await request(route, { path: newRoot })).status, 400);
  assert.equal((await request(route, { path: newRoot, confirm: true })).status, 400);
  assert.equal(app.store.state.sources[0].path, oldRoot);
  assert.equal((await request(`/api/movies/${first.id}/favorite`, { favorite: true })).status, 200);
  assert.equal((await request(`/api/movies/${first.id}/progress`, { position: 4, duration: 10, episodeId: episode })).status, 200);
  const copied = path.join(newRoot, relative, '第2集.mp4');
  await fs.writeFile(copied, content['第2集.mp4']); await fs.utimes(copied, stamp, stamp);
  const moved = await request(route, { path: newRoot, confirm: true });
  assert.equal(moved.status, 200);
  assert.equal((await moved.json()).moved, 1);
  assert.equal(app.store.state.movies[0].episodes[1].filePath, await fs.realpath(copied));
  assert.deepEqual(app.store.state.movies[0].manualFacts, first.manualFacts);
  assert.equal((await request('/api/sync', { sourceId: source.id })).status, 202);
  for (let i = 0; i < 150 && app.getJob().status === 'running'; i++) await delay(10);
  assert.equal(app.getJob().status, 'done');
  const library = await (await request('/api/library')).json(), movie = library.movies[0];
  assert.equal(movie.id, first.id);
  assert.equal(movie.episodes[1].id, episode);
  assert.equal(movie.favorite, true);
  assert.equal(library.history[movie.id].episodeId, episode);
  assert.equal(movie.cast, '自填演员');
  assert.deepEqual(movie.genres, ['保留分类']);
  assert.equal(await (await request(movie.poster)).text(), 'fixture image');
  assert.equal(await (await request(movie.episodes[1].mediaUrl)).text(), content['第2集.mp4']);
});
