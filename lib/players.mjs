import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { VIDEO } from './scanner.mjs';
import { webUrl } from './catalog.mjs';

export function validateMediaTarget(target, platform = process.platform) {
  if (target.filePath) {
    const paths = platform === 'win32' ? path.win32 : path;
    if (typeof target.filePath !== 'string' || !paths.isAbsolute(target.filePath) || !VIDEO.has(paths.extname(target.filePath).toLowerCase()) || /[\r\n\0]/.test(target.filePath)) throw new Error('只能打开已导入片库中的视频文件。');
    return target.filePath;
  }
  const url = webUrl(target.url);
  if (!url || /[\r\n\0]/.test(target.url)) throw new Error('该影片没有有效的 HTTP(S) 播放地址。');
  return url;
}
export function launchSpec(player, target, { platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') throw new Error('本机播放器启动目前仅支持 Windows。');
  const value = validateMediaTarget(target, platform);
  if (player.id === 'default') {
    if (!target.filePath) throw new Error('系统默认方式仅支持本地/NAS 文件；网络视频请选 PotPlayer 或 VLC。');
    // Fixed script; the media path is only an environment value, never executable code.
    return { command: path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; Start-Process -FilePath $env:SCREENROOM_MEDIA_TARGET -WindowStyle Normal -ErrorAction Stop"],
      options: { windowsHide: true, stdio: 'ignore', env: { ...env, SCREENROOM_MEDIA_TARGET: value } }, waitForExit: true };
  }
  if (!['potplayer', 'vlc'].includes(player.id) || !player.executable || !path.win32.isAbsolute(player.executable)) throw new Error('播放器未安装或不可用。');
  return { command: player.executable, args: player.id === 'vlc' ? ['--', value] : [value],
    options: { windowsHide: false, detached: true, stdio: 'ignore' }, waitForExit: false };
}
async function spawnPlayer(spec) {
  await new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, spec.options);
    child.once('error', () => reject(new Error('播放器启动失败，请检查安装或系统文件关联。')));
    if (spec.waitForExit) child.once('exit', code => code === 0 ? resolve() : reject(new Error('系统未能打开视频，请设置默认视频播放器或选择 PotPlayer/VLC。')));
    else child.once('spawn', () => { child.unref(); resolve(); });
  });
}
export function createPlayerService({ platform = process.platform, env = process.env, exists = async p => { try { return (await fs.stat(p)).isFile(); } catch { return false; } }, run = spawnPlayer } = {}) {
  async function installed() {
    if (platform !== 'win32') return [];
    const roots = [...new Set([env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs'), 'C:\\Program Files', 'C:\\Program Files (x86)'].filter(Boolean))];
    const players = [{ id: 'default', name: '系统默认播放器', executable: null }];
    for (const spec of [{ id: 'potplayer', name: 'PotPlayer', suffixes: ['DAUM/PotPlayer/PotPlayerMini64.exe', 'DAUM/PotPlayer/PotPlayerMini.exe', 'PotPlayer/PotPlayerMini64.exe'] }, { id: 'vlc', name: 'VLC', suffixes: ['VideoLAN/VLC/vlc.exe'] }]) {
      let found = '';
      for (const root of roots) { for (const suffix of spec.suffixes) { const p = path.win32.join(root, suffix); if (await exists(p)) { found = p; break; } } if (found) break; }
      if (found) players.push({ id: spec.id, name: spec.name, executable: found });
    }
    return players;
  }
  return {
    async list() { return { supported: platform === 'win32', players: (await installed()).map(({ id, name }) => ({ id, name })), note: '打开的是运行网站服务的这台 Windows 电脑上的播放器，不是远端手机/电视。' }; },
    async open(target, playerId = 'default') {
      const player = (await installed()).find(p => p.id === playerId);
      if (!player) throw new Error('所选播放器未安装或不可用，请选择系统默认播放器。');
      await run(launchSpec(player, target, { platform, env }));
      return { player: player.name, message: `已向${player.name}发送打开请求；是否成功播放取决于播放器和视频文件。` };
    },
  };
}
