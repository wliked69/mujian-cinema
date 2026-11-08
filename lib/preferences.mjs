export const DEFAULT_PREFERENCES = Object.freeze({ theme: 'dark', accent: '#beeec8', playback: 'browser', player: 'default', columns: 'auto' });
export function preferences(input = {}, previous = DEFAULT_PREFERENCES) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('设置格式不正确。');
  const result = { ...DEFAULT_PREFERENCES, ...previous };
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(DEFAULT_PREFERENCES, key)) throw new Error('包含不支持的设置项。');
    const value = input[key];
    if (key === 'accent') { if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('主题颜色需要六位十六进制颜色。'); result.accent = value.toLowerCase(); }
    else {
      const choices = { theme: ['dark', 'light', 'system'], playback: ['browser', 'external'], player: ['default', 'potplayer', 'vlc'], columns: ['auto', '1', '2', '3', '4', '5', '6', '7', '8'] };
      if (!choices[key].includes(value)) throw new Error('请选择有效的设置选项。');
      result[key] = value;
    }
  }
  return result;
}
