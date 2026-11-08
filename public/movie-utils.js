export function sampleMovies(movies, count = 9, random = Math.random) {
  const unique = [...new Map(movies.map(m => [m.title ? `${m.title.trim().toLocaleLowerCase()}:${m.year || ''}` : m.id, m])).values()];
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]];
  }
  return unique.slice(0, Math.max(0, Math.min(unique.length, count)));
}
export const facetLabels = Object.freeze({ studios: '片商', series: '系列', genres: '类别', cast: '演员' });
export function facetValues(movie, key) {
  if (!Object.hasOwn(facetLabels, key)) return [];
  const value = key === 'genres' ? (Array.isArray(movie.genres) ? movie.genres : movie.metadataGenres || []) : movie[key] || (key === 'studios' ? movie.studio : '');
  const list = Array.isArray(value) ? value : key === 'duration' ? [value] : String(value || '').split(/[/,，、|;；\n]+/);
  return [...new Set(list.map(v => String(typeof v === 'object' && v ? v.name || '' : v || '').trim()).filter(Boolean))];
}
export function durationStamp(movie) {
  const n = Number(movie.durationSeconds);
  if (Number.isFinite(n) && n > 0) {
    const total = Math.max(1, Math.round(n)), h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
    return `${h ? h + ':' : ''}${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  return movie.duration || '';
}
export function actorIndex(movies) {
  const index = new Map();
  for (const movie of movies) {
    const photos = new Map((movie.actors || []).map(a => [a.name.toLocaleLowerCase(), a.photo || '']));
    const modified = movieModifiedTime(movie);
    for (const name of facetValues(movie, 'cast')) {
      const key = name.toLocaleLowerCase(), item = index.get(key) || { name, photo: '', photoRank: 0, photoTime: 0, movies: new Set(), modified: 0 };
      const photo = photos.get(key);
      const rank = typeof photo !== 'string' || !photo ? 0 : photo.startsWith('/media/') ? 2 : 1;
      if (rank && (rank > item.photoRank || rank === item.photoRank && modified >= item.photoTime)) {
        Object.assign(item, { photo, photoRank: rank, photoTime: modified });
      }
      item.modified = Math.max(item.modified, modified);
      item.movies.add(movie.id); index.set(key, item);
    }
  }
  return [...index.values()].sort((a,b) => b.modified-a.modified || a.name.localeCompare(b.name,'zh'))
    .map(a => ({ name:a.name, photo:a.photo, count:a.movies.size }));
}
export function movieModifiedTime(movie) {
  return [movie.fileModifiedAt, movie.updatedAt, movie.addedAt].map(value => Date.parse(value)).find(Number.isFinite) ?? 0;
}
export function relatedMovies(movies, key, value, excludedId = '') {
  if (!Object.hasOwn(facetLabels, key) || !value) return [];
  const expected = value.trim().toLocaleLowerCase();
  return movies.filter(m => m.id !== excludedId && facetValues(m, key).some(v => v.toLocaleLowerCase() === expected));
}

export function fitMovieColumns(preference, width, gap) {
  if (typeof preference !== 'string' || !/^[1-8]$/.test(preference) || !Number.isFinite(width) || width <= 0) return null;
  const spacing = Number.isFinite(gap) ? Math.max(0, gap) : 0;
  const readable = Math.max(1, Math.floor((width + spacing) / (100 + spacing)));
  return Math.min(Number(preference), readable);
}
