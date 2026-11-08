import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { webUrl } from './catalog.mjs';
import { within } from './scanner.mjs';

const coverPattern = /^\/media\/covers\/([a-z\d_-]{1,80})\.(jpe?g|png|webp)$/i;
const portraitPattern = /^\/media\/actors\/([a-z\d_-]{1,100})\.(jpe?g|png|webp)$/i;
const maxCoverBytes = 16 * 1024 * 1024;
const pick = (object, keys) => Object.fromEntries(keys.filter(k => Object.hasOwn(object, k)).map(k => [k, object[k]]));
const imageLink = value => coverPattern.test(value) || portraitPattern.test(value) ? value : webUrl(value).split(/[?#]/, 1)[0];
const mapArray = (value, transform) => Array.isArray(value) ? value.map(transform) : undefined;
const movieFields = ['id', 'sourceId', 'kind', 'mediaType', 'title', 'originalTitle', 'year', 'releaseDate', 'rating',
  'genres', 'genreModel', 'autoGenres', 'manualGenres', 'metadataGenres', 'folderCategory', 'overview', 'director',
  'cast', 'country', 'studios', 'series', 'duration', 'durationSeconds', 'tmdbId', 'addedAt',
  'filePath', 'rootPath', 'posterFile', 'backdropFile'];

function snapshot(state, createdAt) {
  return {
    format: 'screenroom-movie-backup', version: 1, createdAt,
    libraries: (state.libraries || []).map(l => pick(l, ['id', 'name', 'sourceIds', 'revision'])),
    actorPortraits: (state.actorPortraits || []).map(p => ({ name: p.name, photo: imageLink(p.photo), updatedAt: p.updatedAt })),
    sources: state.sources.map(source => pick(source, source.type === 'local'
      ? ['id', 'type', 'name', 'category', 'path'] : ['id', 'type', 'name', 'provider'])),
    movies: state.movies.map(movie => ({
      ...pick(movie, movieFields), poster: imageLink(movie.poster), backdrop: imageLink(movie.backdrop),
      actors: mapArray(movie.actors, a => ({ name: a.name, photo: imageLink(a.photo) })),
      actorPhotoFiles: mapArray(movie.actorPhotoFiles, a => pick(a, ['name', 'filePath'])),
      episodes: mapArray(movie.episodes, e => pick(e, ['id', 'title', 'duration', 'durationSeconds', 'filePath', 'rootPath'])),
      manualFacts: movie.manualFacts && {
        ...pick(movie.manualFacts, ['duration', 'releaseDate', 'studios', 'series', 'cast']),
        ...Object.fromEntries(['poster', 'backdrop'].filter(k => Object.hasOwn(movie.manualFacts, k))
          .map(k => [k, imageLink(movie.manualFacts[k])])),
      },
    })),
  };
}

// Minimal USTAR regular-file records: names are constant or strictly validated ASCII.
function* tarFile(name, bytes) {
  const header = Buffer.alloc(512);
  const put = (value, offset) => header.write(value, offset, 'ascii');
  put(name, 0); put('0000600\0', 100); put('0000000\0', 108); put('0000000\0', 116);
  put(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
  put('00000000000\0', 136); header.fill(32, 148, 156);
  put('0', 156); put('ustar\0', 257); put('00', 263);
  put(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
  yield header; yield bytes;
  if (bytes.length % 512) yield Buffer.alloc(512 - bytes.length % 512);
}

async function readCover(root, name) {
  const file = path.join(root, name);
  try {
    const info = await fs.lstat(file);
    if (!info.isFile() || info.size === 0 || info.size > maxCoverBytes || !within(root, await fs.realpath(file))) return;
    const handle = await fs.open(file, 'r');
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== info.size) return;
      const bytes = Buffer.alloc(info.size);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead === bytes.length && (await handle.stat()).size === bytes.length) return bytes;
    } finally { await handle.close(); }
  } catch { /* A missing, disconnected, or unreadable cover doesn't lose metadata. */ }
}

export async function sendMovieBackup(res, state, coversDir, actorsDir = path.join(path.dirname(coversDir), 'actors')) {
  const createdAt = new Date().toISOString();
  const catalog = snapshot(state, createdAt);
  const metadata = Buffer.from(JSON.stringify(catalog, null, 2) + '\n');
  const covers = new Set();
  for (const movie of catalog.movies) {
    for (const value of [movie.poster, movie.backdrop, movie.manualFacts?.poster, movie.manualFacts?.backdrop,
      ...(movie.actors || []).map(a => a.photo)]) {
      const match = coverPattern.exec(value);
      if (match) covers.add(`${match[1]}.${match[2].toLowerCase()}`);
    }
  }
  const root = await fs.lstat(coversDir).then(info => info.isDirectory() ? fs.realpath(coversDir) : null).catch(() => null);
  const portraits = new Set(catalog.actorPortraits.map(p => p.photo).concat(catalog.movies.flatMap(m => (m.actors || []).map(a => a.photo))).map(value => portraitPattern.exec(value)).filter(Boolean).map(match => `${match[1]}.${match[2].toLowerCase()}`));
  const actorsRoot = await fs.lstat(actorsDir).then(info => info.isDirectory() ? fs.realpath(actorsDir) : null).catch(() => null);
  async function* archive() {
    yield* tarFile('movies.json', metadata);
    const included = [], skipped = [];
    for (const name of covers) {
      const bytes = root && await readCover(root, name);
      if (bytes) { yield* tarFile(`covers/${name}`, bytes); included.push(name); }
      else skipped.push(name);
    }
    const includedActorPortraits = [], skippedActorPortraits = [];
    for (const name of portraits) {
      const bytes = actorsRoot && await readCover(actorsRoot, name);
      if (bytes) { yield* tarFile(`actors/${name}`, bytes); includedActorPortraits.push(name); }
      else skippedActorPortraits.push(name);
    }
    yield* tarFile('manifest.json', Buffer.from(JSON.stringify({ createdAt, movieCount: catalog.movies.length,
      includedCovers: included, skippedCovers: skipped, includedActorPortraits, skippedActorPortraits }, null, 2) + '\n'));
    yield Buffer.alloc(1024);
  }
  res.writeHead(200, {
    'Content-Type': 'application/gzip', 'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="screenroom-movies-${createdAt.replace(/[:.]/g, '-')}.tar.gz"`,
  });
  await pipeline(Readable.from(archive()), createGzip({ level: 3 }), res);
}
