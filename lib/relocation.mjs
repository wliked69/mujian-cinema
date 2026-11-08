import fs from 'node:fs/promises';
import path from 'node:path';
import { within } from './scanner.mjs';

// Rebase indexed paths only; never guess by title or move files.
export async function planLocalRelocation(source, movies, requestedPath) {
  const nextPath = typeof requestedPath === 'string' ? requestedPath.trim() : '';
  if (!path.isAbsolute(nextPath) || nextPath.includes('\0')) throw new Error('请输入新片库的绝对路径。');
  let root;
  try {
    root = await fs.realpath(nextPath);
    if (!(await fs.stat(root)).isDirectory()) throw new Error();
  } catch { throw new Error('无法读取新目录，请检查路径和权限。旧片库未改动。'); }
  if (root === path.parse(root).root && !root.startsWith('\\\\')) throw new Error('请选具体的片库文件夹。');
  if (!movies.length) return { nextPath, identityRootPath: source.identityRootPath, updates: new Map() };
  const oldRoot = movies[0].rootPath;
  if (!path.isAbsolute(oldRoot || '') || movies.some(m => m.kind !== 'local' || m.rootPath !== oldRoot || !m.filePath)) throw new Error('原来源的路径不一致，已取消迁移。');
  const checks = new Map();
  function rebase(original, directory = false, video = false) {
    if (!original) return original;
    if (!path.isAbsolute(original) || !within(oldRoot, original) || !path.relative(oldRoot, original)) throw new Error('原片库存在越出来源的路径，已取消迁移。');
    const relative = path.relative(oldRoot, original), target = path.join(root, relative);
    checks.set(target, { relative, target, original, directory, video: video || checks.get(target)?.video });
    return target;
  }
  const updates = new Map(movies.map(m => [m.id, {
    rootPath: root, filePath: rebase(m.filePath, false, true),
    ...(m.tvFolder ? { tvFolder: rebase(m.tvFolder, true) } : {}),
    ...(m.posterFile ? { posterFile: rebase(m.posterFile) } : {}),
    ...(m.backdropFile ? { backdropFile: rebase(m.backdropFile) } : {}),
    ...(m.actorPhotoFiles?.length ? { actorPhotoFiles: m.actorPhotoFiles.map(a => ({ ...a, filePath: rebase(a.filePath) })) } : {}),
    ...(m.episodes?.length ? { episodes: m.episodes.map(e => ({ ...e, rootPath: root, filePath: rebase(e.filePath, false, true) })) } : {}),
  }]));
  const items = [...checks.values()];
  const compare = root !== oldRoot && await fs.stat(oldRoot).then(info => info.isDirectory()).catch(() => false);
  let i = 0, failure;
  await Promise.all(Array.from({ length: Math.min(12, items.length) }, async () => {
    while (!failure && i < items.length) {
      const item = items[i++];
      try {
        const actual = await fs.realpath(item.target);
        if (!within(root, actual) || path.relative(item.target, actual)) throw new Error();
        const stat = await fs.stat(actual);
        if (item.directory ? !stat.isDirectory() : !stat.isFile()) throw new Error();
        if (compare && item.video) {
          const previous = await fs.stat(item.original).catch(() => null);
          if (previous?.isFile() && previous.size !== stat.size) throw new Error();
        }
      } catch { failure ||= new Error(`新目录中缺少、无法读取或不匹配：${item.relative}。旧片库未改动。`); }
    }
  }));
  if (failure) throw failure;
  return { nextPath, identityRootPath: source.identityRootPath || oldRoot, updates };
}
