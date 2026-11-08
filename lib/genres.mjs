import { clean } from './catalog.mjs';

export function manualGenres(input) {
  if (!Array.isArray(input) || input.length > 12 || input.some(g => typeof g !== 'string' || g.length > 40)) throw new Error('请输入 0–12 个类别，每个类别不超过 40 个字符。');
  const result = [...new Set(input.map(g => clean(g, 40)).filter(Boolean))];
  return result;
}
// v2 separates editable film tags from folder-based filing. Empty manual tags are intentional.
export function upgradeGenres(movie) {
  if (movie.genreModel === 2) return;
  const automatic = movie.kind === 'local' ? movie.metadataGenres || [] : movie.autoGenres || movie.genres || [];
  movie.autoGenres = [...new Set(automatic.filter(g => typeof g === 'string' && g && g !== '未分类'))];
  movie.genres = Array.isArray(movie.manualGenres) ? [...movie.manualGenres] : [...movie.autoGenres];
  movie.genreModel = 2;
}
export function setGenres(movie, input) {
  if (input.expectedGenres !== undefined) {
    if (!Array.isArray(input.expectedGenres) || input.expectedGenres.some(g => typeof g !== 'string') || input.expectedGenres.length > 12) throw new Error('expectedGenres 需要是分类字符串数组。');
    if (JSON.stringify([...new Set(input.expectedGenres)].sort()) !== JSON.stringify([...new Set(movie.genres || [])].sort())) {
      const error = new Error('影片分类已发生变化，请重新读取后再提交。'); error.status = 409; throw error;
    }
  }
  if (input.reset === true) {
    movie.genres = [...(movie.autoGenres || movie.metadataGenres || movie.genres || [])];
    delete movie.manualGenres;
  } else {
    const genres = manualGenres(input.genres);
    if (!Array.isArray(movie.manualGenres)) movie.autoGenres = [...(movie.autoGenres || movie.genres || [])];
    movie.manualGenres = genres; movie.genres = [...genres];
  }
}
export function genrePlan(movies, updates) {
  if (!Array.isArray(updates) || !updates.length || updates.length > 100) throw new Error('每批需要 1–100 条分类修改。');
  const known = new Map(movies.map(m => [m.id, m])), seen = new Set();
  return updates.map(input => {
    if (!input || typeof input.id !== 'string' || seen.has(input.id)) throw new Error('影片 ID 无效或在同一批次中重复。');
    seen.add(input.id);
    const previous = known.get(input.id);
    if (!previous) { const error = new Error('批次中有不存在的影片，未提交任何修改。'); error.status = 404; throw error; }
    const movie = { ...previous }; setGenres(movie, input);
    return { movie, change: { id: movie.id, title: movie.title, before: [...(previous.genres || [])], after: [...movie.genres], manual: Array.isArray(movie.manualGenres) } };
  });
}
export function preserveGenres(movie, previous) {
  movie.autoGenres = [...(movie.kind === 'local' ? movie.metadataGenres || [] : movie.genres || [])];
  movie.genres = [...movie.autoGenres];
  movie.genreModel = 2;
  if (Array.isArray(previous?.manualGenres)) {
    movie.manualGenres = [...previous.manualGenres];
    movie.genres = [...previous.manualGenres];
  }
}
