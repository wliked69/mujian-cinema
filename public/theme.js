const rgb = color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
const hex = values => '#' + values.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, amount) => a.map((v, i) => v * (1 - amount) + b[i] * amount);
const lum = values => values.map(v => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
export function themeColors(mode, accent) {
  const base = rgb(accent), light = mode === 'light', neutral = rgb(light ? '#ffffff' : '#070b12');
  const tint = n => mix(neutral, base, n);
  const surfaces = { bg: tint(.19), sidebar: tint(light ? .32 : .10), surface: tint(light ? .09 : .23), panel: tint(light ? .06 : .25), input: tint(light ? .23 : .11), card: tint(light ? .13 : .21), hover: tint(light ? .37 : .33) };
  function readable(start) {
    let result = start;
    for (let blend = 0; Math.min(...Object.values(surfaces).map(bg => contrast(result, bg))) < 4.6 && blend <= 1; blend += .025) result = mix(start, light ? [0, 0, 0] : [255, 255, 255], blend);
    return hex(result);
  }
  const text = light ? mix([13, 20, 30], base, .07) : mix([255, 255, 255], base, .08);
  return { accent, readable: readable(base), ink: contrast(base, [0, 0, 0]) >= contrast(base, [255, 255, 255]) ? '#000000' : '#ffffff',
    ...Object.fromEntries(Object.entries(surfaces).map(([key, value]) => [key, hex(value)])),
    text: hex(text), muted: readable(mix(surfaces.bg, text, .65)), border: hex(mix(surfaces.surface, text, .21)), line: hex(mix(surfaces.surface, text, .12)), hero: hex(mix([4, 8, 12], base, .09)) };
}
export function cachedTheme() {
  try { const p = JSON.parse(localStorage.getItem('screenroom.theme') || '{}'); return { theme: ['dark', 'light', 'system'].includes(p.theme) ? p.theme : 'dark', accent: /^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent : '#beeec8' }; }
  catch { return { theme: 'dark', accent: '#beeec8' }; }
}
export function applyTheme(prefs, persist = true) {
  const mode = prefs.theme === 'system' ? matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark' : prefs.theme;
  const colors = themeColors(mode, prefs.accent), root = document.documentElement;
  root.dataset.theme = mode;
  for (const key of ['bg', 'sidebar', 'surface', 'panel', 'input', 'card', 'hover', 'text', 'muted', 'border', 'line', 'hero']) root.style.setProperty(`--${key}`, colors[key]);
  root.style.setProperty('--accent-base', colors.accent); root.style.setProperty('--accent', colors.readable); root.style.setProperty('--accent-ink', colors.ink);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors.bg);
  if (persist) try { localStorage.setItem('screenroom.theme', JSON.stringify({ theme: prefs.theme, accent: prefs.accent })); } catch { /* 浏览器禁用存储时仍应用当前主题。 */ }
}
