import fs from 'node:fs/promises';
import path from 'node:path';
import { uid, clean, releaseDate, actorProfiles } from './catalog.mjs';
import { names } from './facts.mjs';
import { probeDuration, durationLabel, validDuration } from './duration.mjs';

export const VIDEO = new Set(['.mp4', '.mkv', '.avi', '.mov', '.m4v', '.webm', '.ts', '.mts', '.m2ts', '.mpg', '.mpeg']);
const IMAGES = ['jpg', 'jpeg', 'png', 'webp'];
const decode = s => clean(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
export function parseNfo(xml) {
  const read = tag => { const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i')); return match ? decode(match[1]) : ''; };
  const setBlock = xml.match(/<set(?:\s[^>]*)?>([\s\S]*?)<\/set>/i)?.[1] || '';
  const setName = setBlock.match(/<name(?:\s[^>]*)?>([\s\S]*?)<\/name>/i)?.[1] || setBlock.replace(/<overview(?:\s[^>]*)?>[\s\S]*?<\/overview>/gi, '');
  const actors = [...xml.matchAll(/<actor(?:\s[^>]*)?>([\s\S]*?)<\/actor>/gi)].map(m => ({ name: decode(m[1].match(/<name[^>]*>([\s\S]*?)<\/name>/i)?.[1] || ''), photo: decode(m[1].match(/<thumb[^>]*>([\s\S]*?)<\/thumb>/i)?.[1] || '') }));
  return { title: read('title'), originalTitle: read('originaltitle'), year: Number(read('year')) || Number(releaseDate(read('premiered') || read('releasedate')).slice(0, 4)) || null,
    releaseDate: releaseDate(read('premiered') || read('releasedate')), actors: actorProfiles(actors),
    overview: read('plot'), director: read('director'), country: read('country'), duration: read('runtime') ? `${read('runtime')} 分钟` : '',
    rating: Math.min(10, Math.max(0, Number(read('rating')) || 0)) || null,
    genres: [...xml.matchAll(/<genre(?:\s[^>]*)?>([\s\S]*?)<\/genre>/gi)].map(m => decode(m[1])).filter(Boolean),
    cast: [...xml.matchAll(/<actor[^>]*>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/actor>/gi)].map(m => decode(m[1])).join(' / '),
    studios: names([...xml.matchAll(/<studio(?:\s[^>]*)?>([\s\S]*?)<\/studio>/gi)].map(m => decode(m[1]))),
    series: names(read('series') || decode(setName)),
  };
}
export function inferName(filename) {
  const raw = path.basename(filename, path.extname(filename));
  const yearMatch = raw.match(/(?:^|[.\s_([\-])((?:19|20)\d{2})(?=$|[.\s_)\]\-])/);
  let title = yearMatch ? raw.slice(0, yearMatch.index) : raw;
  title = title.replace(/[._]/g, ' ').replace(/\b(2160p|1080p|720p|bluray|web-?dl|webrip|x26[45]|h26[45]|hevc|remux)\b[\s\S]*$/i, '').replace(/[\s([\-]+$/, '').trim();
  return { title: title || raw, year: yearMatch ? Number(yearMatch[1]) : null };
}
export function within(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
async function localActorPhotos(root, dir, actors) {
  const actorPhotoFiles = [];
      for (const actor of actors) {
        const safeName = actor.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
        for (const name of [safeName, safeName.replace(/ /g, '_')]) {
          let found = false;
          for (const ext of IMAGES) try {
            const f = await fs.realpath(path.join(dir, '.actors', `${name}.${ext}`));
            if (within(root, f) && (await fs.stat(f)).isFile()) { actorPhotoFiles.push({ name: actor.name, filePath: f }); found = true; break; }
          } catch {}
          if (found) break;
        }
      }
  return actorPhotoFiles;
}
export async function scanDirectory(source, onProgress = () => {}) {
  if (!path.isAbsolute(source.path)) throw new Error('请填写已挂载盘符的绝对路径，或 Windows UNC 共享路径。');
  const root = await fs.realpath(source.path);
  const identityRoot = path.isAbsolute(source.identityRootPath || '') ? source.identityRootPath : root;
  const identityPath = target => path.join(identityRoot, path.relative(root, target));
  if (!(await fs.stat(root)).isDirectory()) throw new Error('所选路径不是文件夹。');
  if (root === path.parse(root).root && !/^\\\\(?![?.]\\)[^\\]+\\[^\\]+/.test(root)) throw new Error('请选具体的电影文件夹，不要扫描整个磁盘根目录。');
  const movies = [], warnings = [];
  let filesSeen = 0, folders = 0;
  async function visit(dir, depth) {
    if (depth > 12) { warnings.push('已跳过超过 12 层的目录'); return; }
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { if (dir === root) throw new Error('无法读取目录，请检查 NAS 连接和当前 Windows 账户权限。'); warnings.push(`无法读取子目录：${path.basename(dir)}`); return; }
    folders++;
    const names = new Map(entries.filter(e => e.isFile()).map(e => [e.name.toLowerCase(), e.name]));
    const find = candidates => { for (const c of candidates) if (names.has(c.toLowerCase())) return path.join(dir, names.get(c.toLowerCase())); return ''; };
    const directoryPoster = find(IMAGES.flatMap(ext => [`poster.${ext}`, `folder.${ext}`, `cover.${ext}`]));
    const backdrop = find(IMAGES.flatMap(ext => [`fanart.${ext}`, `backdrop.${ext}`]));
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name.startsWith('@') || entry.name === '$RECYCLE.BIN' || entry.name === 'System Volume Information') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { await visit(full, depth + 1); continue; }
      if (!entry.isFile()) continue;
      if (++filesSeen > 100000) throw new Error('目录文件过多（超过 100000），请缩小扫描目录。');
      if (!VIDEO.has(path.extname(entry.name).toLowerCase())) continue;
      if (movies.length >= 20000) throw new Error('单个来源最多导入 20000 个视频，请拆分片库。');
      const base = path.basename(entry.name, path.extname(entry.name));
      let inferred = inferName(entry.name);
      if (/^(movie|video|index|正片)$/i.test(inferred.title)) inferred = inferName(`${path.basename(dir)}.mp4`);
      const nfoPath = find([`${base}.nfo`, 'movie.nfo']);
      let nfo = {};
      if (nfoPath) try { if ((await fs.stat(nfoPath)).size <= 2_000_000) nfo = parseNfo(await fs.readFile(nfoPath, 'utf8')); } catch { warnings.push(`无法读取 NFO：${entry.name}`); }
      const rel = path.relative(root, full).split(path.sep);
      // Folders are filing groups, never film category tags.
      const folderGenre = clean(rel.length >= 2 ? rel[0] : path.basename(root), 40) || '未分类';
      const durationSeconds = await probeDuration(full);
      const fileModifiedAt = await fs.stat(full).then(info => info.mtime.toISOString()).catch(() => '');
      const actorPhotoFiles = await localActorPhotos(root, dir, nfo.actors || []);
      movies.push({ id: uid(`${source.id}:${identityPath(full)}`), sourceId: source.id, kind: 'local', filePath: full, rootPath: root, fileModifiedAt,
        tvFolder: rel.length >= 3 ? path.join(root, rel[0], rel[1]) : '',
        title: nfo.title || inferred.title, originalTitle: nfo.originalTitle || '', year: nfo.year || inferred.year,
        overview: nfo.overview || '来自你的本地片库。添加同名 NFO 文件，即可显示剧情、导演与演职人员。',
        genres: nfo.genres || [], genreModel: 2, folderCategory: source.category || folderGenre, metadataGenres: nfo.genres || [],
        rating: nfo.rating || null, durationSeconds, duration: durationLabel(durationSeconds) || nfo.duration || '', releaseDate: nfo.releaseDate || '', actorPhotoFiles, actors: nfo.actors || [], director: nfo.director || '', cast: nfo.cast || '', country: nfo.country || '', studios: nfo.studios || [], series: nfo.series || [],
        posterFile: find(IMAGES.flatMap(ext => [`${base}-poster.${ext}`, `${base}.${ext}`])) || directoryPoster,
        backdropFile: backdrop, streams: [], addedAt: new Date().toISOString(),
      });
      if (movies.length % 10 === 0) onProgress({ found: movies.length, folders });
    }
  }
  await visit(root, 0);
  onProgress({ found: movies.length, folders });
  const grouped = new Map(), result = [];
  for (const movie of movies) {
    if (!movie.tvFolder) { delete movie.tvFolder; result.push(movie); continue; }
    if (!grouped.has(movie.tvFolder)) grouped.set(movie.tvFolder, []);
    grouped.get(movie.tvFolder).push(movie);
  }
  for (const [folder, entries] of grouped) {
    entries.sort((a,b) => a.filePath.localeCompare(b.filePath, 'zh', { numeric: true }));
    let show = {};
    try { const f = path.join(folder, 'tvshow.nfo'); if ((await fs.stat(f)).size <= 2000000) show = parseNfo(await fs.readFile(f, 'utf8')); } catch {}
    const first = entries[0], episodes = entries.map((e,i) => ({ id: e.id, title: `${i + 1}. ${path.basename(e.filePath, path.extname(e.filePath))}`, filePath: e.filePath, rootPath: root, durationSeconds: e.durationSeconds, duration: e.duration }));
    const durationSeconds = episodes.every(e => validDuration(e.durationSeconds)) ? episodes.reduce((n,e) => n + e.durationSeconds, 0) : null;
    const { tvFolder, ...base } = first;
    const fileModifiedAt = entries.map(e => e.fileModifiedAt).sort().at(-1);
    result.push({ ...base, ...show, id: uid(`${source.id}:tv:${identityPath(folder)}`), title: show.title || path.basename(folder), mediaType: 'tv', episodes, fileModifiedAt,
      durationSeconds, duration: durationLabel(durationSeconds),
      genres: show.genres?.length ? show.genres : first.genres, metadataGenres: show.genres?.length ? show.genres : first.metadataGenres,
      actorPhotoFiles: [...new Map([...entries.flatMap(e => e.actorPhotoFiles || []), ...await localActorPhotos(root, folder, show.actors || [])].map(a => [a.name,a])).values()],
      actors: show.actors?.length ? show.actors : actorProfiles(entries.flatMap(e => e.actors || [])), cast: show.cast || [...new Set(entries.flatMap(e => names(e.cast)))].join(' / ') });
  }
  return { movies: result, warnings: [...new Set(warnings)].slice(0, 20) };
}
