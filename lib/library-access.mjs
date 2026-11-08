import { clean } from './catalog.mjs';

// null means unrestricted; an empty allow-list intentionally grants nothing.
export function libraryAccess(input) {
  if (input === undefined) return { sourceIds: null, libraryIds: null, genres: null };
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(k => !['sourceIds', 'libraryIds', 'genres'].includes(k))) throw new Error('影片访问权限格式不正确。');
  const list = (key, max, length) => {
    const value = input[key];
    if (value === null) return null;
    if (!Array.isArray(value) || value.length > max || value.some(v => typeof v !== 'string' || !v.trim() || v.length > length || clean(v, length) !== v))
      throw new Error(key === 'genres' ? '请选择有效的影片类别。' : '请选择有效的影片库或来源。');
    return [...new Set(value)];
  };
  return { sourceIds: input.sourceIds === undefined && Object.hasOwn(input, 'libraryIds') ? null : list('sourceIds', 100, 100),
    libraryIds: input.libraryIds === undefined ? null : list('libraryIds', 100, 100), genres: list('genres', 300, 40) };
}

export function movieAccess(user, libraries = []) {
  if (!user?.enabled) return () => false;
  if (user.role === 'admin') return movie => !!movie;
  let access;
  try { access = libraryAccess(user.libraryAccess); } catch { return () => false; }
  const sources = access.sourceIds === null ? null : new Set(access.sourceIds);
  const genres = access.genres === null ? null : new Set(access.genres);
  const assigned = new Set(libraries.filter(l => access.libraryIds === null || access.libraryIds.includes(l.id)).flatMap(l => l.sourceIds));
  return movie => !!movie && (!sources || sources.has(movie.sourceId))
    && (assigned.has(movie.sourceId) || movie.kind === 'demo' && access.libraryIds === null && access.sourceIds === null)
    && (!genres || (movie.genres || []).some(g => genres.has(g)));
}

export const canViewMovie = (user, movie, libraries) => movieAccess(user, libraries)(movie);

export function canViewSource(user, source, libraries = []) {
  if (!user?.enabled) return false;
  if (user.role === 'admin') return true;
  try { const access = libraryAccess(user.libraryAccess); return (access.sourceIds === null || access.sourceIds.includes(source.id))
    && libraries.some(l => (access.libraryIds === null || access.libraryIds.includes(l.id)) && l.sourceIds.includes(source.id)); }
  catch { return false; }
}

export function visibleLibraries(user, libraries) {
  if (!user?.enabled) return [];
  if (user.role === 'admin') return libraries;
  try {
    const access = libraryAccess(user.libraryAccess);
    return libraries.filter(l => (access.libraryIds === null || access.libraryIds.includes(l.id))
      && (access.sourceIds === null || l.sourceIds.some(id => access.sourceIds.includes(id))))
      .map(l => ({ ...l, sourceIds: l.sourceIds.filter(id => access.sourceIds === null || access.sourceIds.includes(id)) }));
  } catch { return []; }
}

export function referencesImage(movie, pathname) {
  return [movie.poster, movie.backdrop, movie.manualFacts?.poster, movie.manualFacts?.backdrop,
    ...(movie.actors || []).map(a => a.photo)].some(value => typeof value === 'string' && value.split(/[?#]/, 1)[0] === pathname);
}
