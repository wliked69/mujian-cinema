import { createClient, summarizeMovies } from './client.mjs';

const [command = 'diagnostics', id, arg] = process.argv.slice(2);
try {
  const request = createClient();
  let result;
  if (command === 'diagnostics') result = await request('/api/admin/diagnostics');
  else if (command === 'movies') result = summarizeMovies(await request('/api/library'), id || '');
  else if (command === 'sources') result = { sources: (await request('/api/library')).sources.map(({ id, name, type, count, lastSync }) => ({ id, name, type, count, lastSync })) };
  else if (command === 'job') result = await request('/api/job');
  else if (command === 'audit') result = await request('/api/admin/audit');
  else if (command === 'match' && id) result = await request(`/api/movies/${encodeURIComponent(id)}/match`, { query: arg || '' });
  else if (['scan', 'enrich', 'genres', 'genres-reset', 'genres-batch'].includes(command)) {
    if (process.env.SCREENROOM_ALLOW_WRITE !== '1') throw new Error('写操作需显式设置 SCREENROOM_ALLOW_WRITE=1；分类可用 classify/write 令牌，扫描和资料导入需要 write。');
    if (command === 'genres-batch') {
      let input = ''; for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 1_000_000) throw new Error('分类方案超过 1 MB。'); }
      const parsed = JSON.parse(input);
      result = await request('/api/movies/genres/batch', { updates: Array.isArray(parsed) ? parsed : parsed.updates, dryRun: id !== '--apply' });
    }
    else if (command === 'genres' && id && arg) result = await request(`/api/movies/${encodeURIComponent(id)}/genres`, { genres: arg.split(/[,，、/|]/).map(s => s.trim()).filter(Boolean) });
    else if (command === 'genres-reset' && id) result = await request(`/api/movies/${encodeURIComponent(id)}/genres`, { reset: true });
    else if (command === 'scan') result = await request('/api/sync', id ? { sourceId: id } : {});
    else if (command === 'enrich' && id && /^\d+$/.test(arg || '')) result = await request(`/api/movies/${encodeURIComponent(id)}/enrich`, { tmdbId: Number(arg) });
    else throw new Error('参数无效：enrich <movieId> <tmdbId> / genres <movieId> 分类1,分类2 / genres-reset <movieId> / genres-batch [--apply]');
  } else throw new Error('可用命令：diagnostics / movies [关键词] / sources / job / audit / match <movieId> [片名] / scan [sourceId] / enrich <movieId> <tmdbId> / genres <movieId> 分类1,分类2 / genres-reset <movieId> / genres-batch [--apply]（JSON 从 stdin 读取）');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) { process.stderr.write(`调试请求失败：${error.message}\n`); process.exitCode = 1; }
