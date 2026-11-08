import { createHash } from 'node:crypto';
import { durationLabel } from './duration.mjs';

export const uid = value => createHash('sha256').update(String(value)).digest('hex').slice(0, 20);
export function clean(value, max = 1000) {
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim().slice(0, max);
}
export function names(value) {
  const values = Array.isArray(value) ? value : typeof value === 'object' && value ? [value] : String(value || '').split(/[/,，、|;；\n]+/);
  return [...new Set(values.map(v => clean(typeof v === 'object' && v ? v.name : v, 100)).filter(Boolean))].slice(0, 24);
}
export function webUrl(value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
export function releaseDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : '';
}
export function actorProfiles(value) {
  const list = Array.isArray(value) ? value : names(value);
  const photoUrl = input => {
    const remote = webUrl(input);
    if (remote) return remote;
    return typeof input === 'string' && /^\/media\/actors\/[A-Za-z0-9._-]+$/.test(input) ? input : '';
  };
  const found = new Map();
  for (const actor of list.slice(0, 100)) {
    const name = clean(typeof actor === 'object' && actor ? actor.name : actor, 100);
    if (!name) continue;
    const photo = typeof actor === 'object' && actor ? photoUrl(actor.photo || actor.avatar || actor.thumb || (actor.profile_path?.startsWith('/') ? `https://image.tmdb.org/t/p/w185${actor.profile_path}` : '')) : '';
    const key = name.toLocaleLowerCase();
    if (!found.has(key) || photo) found.set(key, { name, photo });
    if (found.size >= 64) break;
  }
  return [...found.values()];
}
export function normalizeMovie(item, sourceId, index = 0) {
  const title = clean(item.title || item.name || item.vod_name, 200);
  if (!title) return null;
  let genres = item.genres || item.category || item.type_name || [];
  if (!Array.isArray(genres)) genres = String(genres).split(/[,，/|、]/);
  genres = genres.map(g => clean(typeof g === 'object' ? g.name : g, 40)).filter(Boolean);
  const rawRating = Number(item.rating ?? item.vote_average ?? item.vod_score);
  const rawYear = String(item.year || item.releaseDate || item.release_date || item.vod_year || '');
  const year = Number(rawYear.match(/(?:19|20)\d{2}/)?.[0]) || null;
  const streams = [];
  if (Array.isArray(item.streams)) {
    for (const s of item.streams.slice(0, 100)) if (webUrl(s.url)) streams.push({ name: clean(s.name || '正片', 80), url: webUrl(s.url) });
  }
  if (webUrl(item.videoUrl || item.video_url)) streams.push({ name: '正片', url: webUrl(item.videoUrl || item.video_url) });
  if (item.vod_play_url) {
    const groups = String(item.vod_play_url).split('$$$');
    const names = String(item.vod_play_from || '').split('$$$');
    groups.forEach((group, i) => group.split('#').slice(0, 100).forEach((entry, j) => {
      const pos = entry.indexOf('$');
      const url = webUrl(pos < 0 ? entry : entry.slice(pos + 1));
      if (url) streams.push({ name: clean(`${names[i] || '线路'} · ${pos < 0 ? j + 1 : entry.slice(0, pos)}`, 80), url });
    }));
  }
  return {
    id: uid(`${sourceId}:${item.id ?? item.vod_id ?? `${title}:${year}:${index}`}`), sourceId,
    title, originalTitle: clean(item.originalTitle || item.original_title || item.vod_en, 200),
    year, releaseDate: releaseDate(item.releaseDate || item.release_date || item.premiered || item.vod_pubdate), rating: Number.isFinite(rawRating) && rawRating > 0 ? Math.min(10, rawRating) : null,
    genres: [...new Set(genres)], genreModel: 2,
    overview: clean(item.overview || item.description || item.vod_content, 6000),
    director: clean(item.director || item.vod_director, 200),
    cast: names(item.cast || item.actors || item.vod_actor).join(' / '),
    actors: actorProfiles(item.actors || item.cast || item.vod_actor),
    country: clean(item.country || item.vod_area, 100),
    studios: names(item.studios || item.studio || item.maker || item.production_companies || item.vod_studio || item.vod_producer),
    series: names(item.series || item.collection || item.belongs_to_collection || item.vod_series),
    duration: clean(item.duration || item.vod_duration, 40), durationSeconds: Number(item.durationSeconds) > 0 && Number(item.durationSeconds) <= 31622400 ? Number(item.durationSeconds) : null,
    poster: webUrl(item.poster || item.posterUrl || item.cover || item.vod_pic),
    backdrop: webUrl(item.backdrop), streams: streams.slice(0, 300), kind: 'api', addedAt: new Date().toISOString(),
  };
}
export function publicMovie(movie, favorites = {}, portraits = new Map()) {
  const { filePath, posterFile, backdropFile, rootPath, episodes, actorPhotoFiles, ...safe } = movie;
  return { ...safe, duration: durationLabel(movie.durationSeconds) || movie.duration || '', actors: actorProfiles(movie.actors?.length ? movie.actors : movie.cast).map(a => {
    const i = actorPhotoFiles?.findIndex(photo => photo.name === a.name) ?? -1;
    return { ...a, photo: portraits.get(a.name.toLocaleLowerCase()) || (i >= 0 ? `/media/${movie.id}/actor?index=${i}` : a.photo) };
  }),
    episodes: episodes?.map(e => ({ id: e.id, title: e.title, durationSeconds: e.durationSeconds, duration: e.duration, mediaUrl: `/media/${movie.id}/video?episode=${encodeURIComponent(e.id)}` })),
    episodeCount: episodes?.length || 0, poster: posterFile ? `/media/${movie.id}/poster` : movie.poster || '',
    backdrop: backdropFile ? `/media/${movie.id}/backdrop` : movie.backdrop || '',
    playable: !!filePath || !!movie.streams?.length,
    mediaUrl: filePath ? `/media/${movie.id}/video` : '', extension: filePath ? filePath.split('.').pop().toUpperCase() : '',
    fileName: filePath ? filePath.split(/[\\/]/).pop() : '', favorite: !!favorites[movie.id] };
}
export function toolMovie(movie) {
  const { id, sourceId, kind, title, originalTitle, year, releaseDate, rating, genres, autoGenres, manualGenres, metadataGenres, folderCategory, overview, director, cast, duration, durationSeconds, studios, series } = movie;
  return { id, sourceId, kind, title, originalTitle, year, releaseDate, rating, genres, autoGenres, manualGenres, metadataGenres, folderCategory, overview, director, cast, duration, durationSeconds, studios, series, episodeCount: movie.episodes?.length || 0,
    playable: !!movie.filePath || !!movie.streams?.length };
}
