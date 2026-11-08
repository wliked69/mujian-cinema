import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { hashPassword, verifyPassword } from '../lib/auth.mjs';
import { setGenres, preserveGenres, manualGenres } from '../lib/genres.mjs';
import { createPlayerService, launchSpec, validateMediaTarget } from '../lib/players.mjs';

test('密码支持单字符和超过旧上限的长密码，只拒绝空密码', async () => {
  for (const password of ['a', '中'.repeat(1024)]) {
    const stored = await hashPassword(password);
    assert.equal(await verifyPassword(password, stored), true);
    assert.equal(await verifyPassword(`${password}x`, stored), false);
  }
  await assert.rejects(hashPassword(''), /不能为空/);
  assert.equal(await verifyPassword('', await hashPassword('x')), false);
  const html = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const input of html.matchAll(/<input\b[^>]*type="password"[^>]*>/g)) assert.doesNotMatch(input[0], /(?:minlength|maxlength)=/i);
  const app = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /\.minLength\s*=|12–128/);
});

test('手动分类校验、持久化合并及恢复自动分类', () => {
  assert.deepEqual(manualGenres([' 家庭收藏 ', '科幻', '家庭收藏']), ['家庭收藏', '科幻']);
  assert.deepEqual(manualGenres([]), []);
  assert.throws(() => manualGenres([{}]), /类别/);
  assert.throws(() => manualGenres(['长'.repeat(41)]), /类别/);
  const movie = { genres: ['剧情'] };
  setGenres(movie, { genres: ['家庭收藏', '科幻'] });
  assert.deepEqual(movie.autoGenres, ['剧情']);
  const scanned = { genres: ['冒险'] }; preserveGenres(scanned, movie);
  assert.deepEqual(scanned.genres, ['家庭收藏', '科幻']); assert.deepEqual(scanned.autoGenres, ['冒险']);
  setGenres(scanned, { reset: true });
  assert.deepEqual(scanned.genres, ['冒险']); assert.equal(scanned.manualGenres, undefined);
});

test('播放器使用安全参数、禁止脚本及任意协议，路径不拼接进命令', () => {
  const filePath = 'C:\\Films\\电影 & $() ; (2024).mkv';
  const spec = launchSpec({ id: 'default' }, { filePath }, { platform: 'win32', env: { SystemRoot: 'C:\\Windows' } });
  assert.equal(spec.options.env.SCREENROOM_MEDIA_TARGET, filePath);
  assert.equal(spec.args.some(arg => arg.includes(filePath)), false);
  assert.equal(spec.options.windowsHide, true);
  const vlc = launchSpec({ id: 'vlc', executable: 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe' }, { url: 'https://example.com/movie.mp4?x=1&y=2' }, { platform: 'win32' });
  assert.deepEqual(vlc.args, ['--', 'https://example.com/movie.mp4?x=1&y=2']);
  assert.throws(() => validateMediaTarget({ filePath: 'C:\\bad.exe' }, 'win32'), /视频文件/);
  assert.throws(() => validateMediaTarget({ filePath: 'relative.mp4' }, 'win32'), /视频文件/);
  assert.throws(() => validateMediaTarget({ url: 'javascript:alert(1)' }), /播放地址/);
  assert.throws(() => launchSpec({ id: 'default' }, { url: 'https://example.com/movie.mp4' }, { platform: 'win32' }), /网络视频/);
  assert.throws(() => launchSpec({ id: 'anything', executable: 'C:\\bad.exe' }, { filePath }, { platform: 'win32' }), /不可用/);
});

test('检测已安装播放器并调用注入的启动器，不真实启动用户应用', async () => {
  const launches = [];
  const service = createPlayerService({ platform: 'win32', env: { ProgramFiles: 'C:\\Program Files' }, exists: async p => p === 'C:\\Program Files\\DAUM\\PotPlayer\\PotPlayerMini64.exe', run: async spec => { launches.push(spec); } });
  const result = await service.list();
  assert.deepEqual(result.players.map(p => p.id), ['default', 'potplayer']);
  assert.equal(JSON.stringify(result).includes('executable'), false);
  await service.open({ filePath: 'C:\\Movies\\test.mkv' }, 'potplayer');
  assert.deepEqual(launches[0].args, ['C:\\Movies\\test.mkv']);
  await assert.rejects(service.open({ filePath: 'C:\\Movies\\test.mkv' }, 'vlc'), /不可用/);
  assert.equal((await createPlayerService({ platform: 'linux' }).list()).supported, false);
});
