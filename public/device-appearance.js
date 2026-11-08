export const DEFAULT_APPEARANCE = Object.freeze({ theme: 'dark', accent: '#beeec8', columns: 'auto' });
const keyFor = accountId => `screenroom.appearance.v1:${accountId}`;

function validFields(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  if (['dark', 'light', 'system'].includes(value.theme)) result.theme = value.theme;
  if (typeof value.accent === 'string' && /^#[0-9a-f]{6}$/i.test(value.accent)) result.accent = value.accent.toLowerCase();
  if (typeof value.columns === 'string' && /^(auto|[1-8])$/.test(value.columns)) result.columns = value.columns;
  return result;
}

export function loadDeviceAppearance(accountId, legacyAppearance, storage) {
  const fallback = { ...DEFAULT_APPEARANCE, ...validFields(legacyAppearance) };
  if (!accountId) return fallback;
  try {
    const saved = (storage ?? globalThis.localStorage)?.getItem(keyFor(accountId));
    return { ...fallback, ...validFields(JSON.parse(saved || 'null')) };
  } catch { return fallback; }
}

export function saveDeviceAppearance(accountId, appearance, storage) {
  if (!accountId) throw new Error('请登录后保存外观。');
  const saved = { ...DEFAULT_APPEARANCE, ...validFields(appearance) };
  try {
    (storage ?? globalThis.localStorage).setItem(keyFor(accountId), JSON.stringify(saved));
  } catch { throw new Error('此浏览器无法保存本机外观，请检查是否限制了网站存储。'); }
  return saved;
}
