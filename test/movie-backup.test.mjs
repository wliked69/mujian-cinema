import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { createApp } from '../server.mjs';
import { startListening, closeListeners } from '../lib/network.mjs';

function untar(archive) {
  const bytes = gunzipSync(archive), files = new Map();
  let position = 0;
  const field = (header, start, end) => header.toString('ascii', start, end).split('\0', 1)[0];
  while (bytes[position]) {
    const header = bytes.subarray(position, position + 512);
    assert.equal(field(header, 257, 263), 'ustar');
    const checksum = parseInt(field(header, 148, 156), 8);
    assert.equal(header.reduce((sum, value, i) => sum + (i >= 148 && i < 156 ? 32 : value), 0), checksum);
    const size = parseInt(field(header, 124, 136), 8);
    files.set(field(header, 0, 100), bytes.subarray(position + 512, position + 512 + size));
    position += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(bytes.length - position, 1024);
  return files;
}

test('影片备份：仅管理员会话下载，压缩包保留资料、手动分类、集数及引用的缓存封面', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenroom-backup-'));
  const covers = path.join(dataDir, 'covers');
  await fs.mkdir(covers);
  const cover = Buffer.from([0xff, 0xd8, 0xff, 0xd9]); // Minimal JPEG fixture, never rendered.
  await fs.writeFile(path.join(covers, 'fixture.jpg'), cover);
  await fs.writeFile(path.join(covers, 'unused.jpg'), cover);
  const portraitName = 'manual-' + createHash('sha256').update(cover).digest('hex') + '.jpg';
  await fs.mkdir(path.join(dataDir, 'actors'));
  await fs.writeFile(path.join(dataDir, 'actors', portraitName), cover);
  const marker = randomBytes(12).toString('hex');
  await fs.writeFile(path.join(dataDir, 'library.json'), JSON.stringify({
    actorPortraits: [{ name: '测试演员', photo: '/media/actors/' + portraitName, updatedAt: '2026-11-08T00:00:00.000Z' }],
    libraries: [{id:'collection',name:'自定义剧集库',sourceIds:['api'],revision:2}],
    sources: [{ id: 'api', type: 'api', provider: 'generic', name: '测试源', url: 'https://example.test/?key=' + marker, token: marker }],
    movies: [{
      id: 'fixture', sourceId: 'api', kind: 'api', title: '示例剧', genres: ['手动'], genreModel: 2, manualGenres: ['手动'],
      poster: '/media/covers/fixture.jpg', backdrop: '/media/covers/missing.png',
      manualFacts: { poster: '/media/covers/fixture.jpg', cast: '测试演员', unsafe: marker },
      actors: [{ name: '测试演员', photo: 'https://example.test/photo?auth=' + marker }],
      episodes: [{ id: 'episode', title: '第1集', durationSeconds: 10 }],
      streams: [{ name: '测试流', url: 'https://example.test/?token=' + marker }],
    }],
  }));
  const app = await createApp({ dataDir });
  t.after(async () => { await closeListeners(app); await app.flush(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + await startListening(app, { port: 0 });
  const post = (url, input, cookie) => fetch(base + url, { method: 'POST',
    headers: { 'X-Cinema-Client': 'local', 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(input) });
  const backup = headers => fetch(base + '/api/admin/movie-backup', { headers });
  assert.equal((await backup({})).status, 401);
  const account = { username: 'fixture-admin', password: randomBytes(16).toString('hex') };
  const setup = await post('/api/auth/setup', account);
  assert.equal(setup.status, 201);
  const cookie = setup.headers.get('set-cookie').split(';', 1)[0];
  const ordinary = { username: 'fixture-user', password: randomBytes(16).toString('hex'), role: 'user' };
  assert.equal((await post('/api/admin/users', ordinary, cookie)).status, 201);
  const userLogin = await post('/api/auth/login', ordinary);
  assert.equal(userLogin.status, 200);
  assert.equal((await backup({ cookie: userLogin.headers.get('set-cookie').split(';', 1)[0] })).status, 403);
  const tokenResponse = await post('/api/admin/tokens', { name: 'Backup QA', scope: 'write', days: 1 }, cookie);
  assert.equal(tokenResponse.status, 201);
  assert.equal((await backup({ authorization: 'Bearer ' + (await tokenResponse.json()).token })).status, 403);
  assert.equal((await backup({ cookie, 'sec-fetch-site': 'cross-site' })).status, 403);
  const response = await backup({ cookie });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /attachment; filename="screenroom-movies-.+\.tar\.gz"/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const files = untar(await response.arrayBuffer());
  assert.deepEqual([...files.keys()], ['movies.json', 'covers/fixture.jpg', 'actors/' + portraitName, 'manifest.json']);
  assert.deepEqual(files.get('covers/fixture.jpg'), cover);
  assert.deepEqual(files.get('actors/' + portraitName), cover);
  const json = files.get('movies.json').toString();
  assert.ok(!json.includes(marker) && !json.includes(account.username));
  const data = JSON.parse(json);
  assert.equal(data.format, 'screenroom-movie-backup');
  assert.equal(data.version, 1);
  assert.deepEqual(data.libraries,[{id:'collection',name:'自定义剧集库',sourceIds:['api'],revision:2}]);
  assert.deepEqual(data.actorPortraits, [{ name: '测试演员', photo: '/media/actors/' + portraitName, updatedAt: '2026-11-08T00:00:00.000Z' }]);
  assert.equal(data.movies[0].title, '示例剧');
  assert.deepEqual(data.movies[0].manualGenres, ['手动']);
  assert.equal(data.movies[0].manualFacts.cast, '测试演员');
  assert.equal(data.movies[0].episodes[0].title, '第1集');
  assert.equal(data.movies[0].actors[0].photo, 'https://example.test/photo');
  assert.equal(data.movies[0].streams, undefined);
  assert.equal(data.users, undefined);
  const manifest = JSON.parse(files.get('manifest.json'));
  assert.deepEqual(manifest.skippedCovers, ['missing.png']);
  assert.deepEqual(manifest.includedCovers, ['fixture.jpg']);
  assert.deepEqual(manifest.includedActorPortraits, [portraitName]);
  assert.deepEqual(manifest.skippedActorPortraits, []);
});
