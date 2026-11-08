import { clean, names, releaseDate } from './catalog.mjs';
export { names } from './catalog.mjs';
export function editableFacts(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('资料格式不正确。');
  const keys = ['duration', 'releaseDate', 'studios', 'series', 'cast', 'poster', 'backdrop', 'actorPhotos', 'metadataGenres'];
  if (Object.keys(input).some(k => !keys.includes(k))) throw new Error('包含不支持的资料字段。');
  const result = {};
  for (const key of keys) if (Object.hasOwn(input, key)) {
    if (key === 'metadataGenres') {
      const value = input[key];
      if (!Array.isArray(value) || value.length > 24 || value.some(g => typeof g !== 'string' || !g.trim() || g.length > 40)) throw new Error('类别需要最多 24 个名称。');
      result[key] = [...new Set(value.map(g => clean(g, 40)).filter(Boolean))]; continue;
    }
    if (key === 'actorPhotos') {
      const value = input[key];
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('演员头像需要 { 姓名: 地址 } 对象。');
      const entries = Object.entries(value);
      if (entries.length > 64) throw new Error('演员头像最多 64 项。');
      const cleaned = {};
      for (const [name, photo] of entries) {
        const actor = clean(name, 100);
        if (!actor) throw new Error('演员姓名无效。');
        if (typeof photo !== 'string' || photo.length > 600 || !/^(https?:\/\/|\/media\/actors\/)/.test(photo)) throw new Error('演员头像地址需要 http(s) 链接或 /media/actors/ 路径。');
        cleaned[actor] = photo;
      }
      result[key] = cleaned; continue;
    }
    if (key === 'poster' || key === 'backdrop') {
      const value = input[key];
      if (typeof value !== 'string' || value.length > 600) throw new Error('封面地址需要字符串，长度不超过 600。');
      if (value && !/^(https?:\/\/|\/)/.test(value)) throw new Error('封面地址需要 http(s) 链接或站内路径。');
      result[key] = value; continue;
    }
    if (key === 'releaseDate') {
      if (input[key] !== '' && !releaseDate(input[key])) throw new Error('日期需要有效的 YYYY-MM-DD 格式，也可以留空。');
      result[key] = releaseDate(input[key]); continue;
    }
    if (['studios', 'series'].includes(key)) {
      const value = input[key];
      if (!(typeof value === 'string' && value.length <= 2400) && !(Array.isArray(value) && value.length <= 24 && value.every(v => typeof v === 'string' && v.length <= 100))) throw new Error('片商/系列需要字符串或最多 24 个名称。');
      result[key] = names(value);
    } else {
      if (typeof input[key] !== 'string' || input[key].length > (key === 'duration' ? 40 : 2400)) throw new Error('时长或演员字段过长。');
      result[key] = key === 'cast' ? names(input[key]).join(' / ') : clean(input[key], 40);
    }
  }
  return result;
}
