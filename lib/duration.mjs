import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const validDuration = n => Number.isFinite(n) && n > 0 && n <= 366 * 86400;
export function durationLabel(seconds) {
  if (!validDuration(seconds)) return '';
  const total = Math.max(1, Math.round(seconds)), minutes = Math.floor(total / 60), rest = total % 60;
  return `${minutes ? `${minutes} 分钟` : ''}${rest ? `${minutes ? ' ' : ''}${rest} 秒` : ''}`;
}
async function containerDuration(file) {
  const handle = await fs.open(file, 'r');
  try {
    const end = (await handle.stat()).size; let reads = 0, bytes = 0;
    const deadline = Date.now() + 3000;
    async function read(position, length) {
      if (++reads > 2048 || (bytes += length) > 4_000_000 || Date.now() > deadline || position < 0 || length < 0 || position + length > end) throw new Error('metadata limit');
      const b = Buffer.alloc(length), result = await handle.read(b, 0, length, position);
      if (result.bytesRead !== length) throw new Error('truncated metadata'); return b;
    }
    async function mp4(start, limit, nested = false) {
      for (let pos = start; pos + 8 <= limit;) {
        const head = await read(pos, Math.min(16, limit - pos)); let size = head.readUInt32BE(0), offset = 8;
        const type = head.toString('ascii', 4, 8);
        if (size === 1) { if (head.length < 16) return null; size = Number(head.readBigUInt64BE(8)); offset = 16; }
        if (size === 0) size = limit - pos;
        if (!Number.isSafeInteger(size) || size < offset || pos + size > limit) return null;
        if (type === 'moov' && !nested) { const n = await mp4(pos + offset, pos + size, true); if (validDuration(n)) return n; }
        if (type === 'mvhd' && nested) {
          const b = await read(pos + offset, Math.min(size - offset, 32)), version = b[0];
          if (version === 0 && b.length >= 20) return b.readUInt32BE(16) / b.readUInt32BE(12);
          if (version === 1 && b.length >= 32) return Number(b.readBigUInt64BE(24)) / b.readUInt32BE(20);
        }
        pos += size;
      }
      return null;
    }
    const vint = (b, pos, id) => {
      let length = 1; while (length <= 8 && !(b[pos] & (0x80 >> (length - 1)))) length++;
      if (length > (id ? 4 : 8) || pos + length > b.length) throw new Error('invalid EBML');
      let value = BigInt(id ? b[pos] : b[pos] & (0xff >> length));
      for (let i = 1; i < length; i++) value = value * 256n + BigInt(b[pos + i]);
      return { length, value: Number(value), unknown: !id && value === (1n << BigInt(length * 7)) - 1n };
    };
    async function ebml(start, limit, level = 0) {
      let scale = 1000000, duration = null;
      for (let pos = start; pos + 2 <= limit;) {
        const head = await read(pos, Math.min(12, limit - pos)), id = vint(head, 0, true), size = vint(head, id.length, false);
        const data = pos + id.length + size.length, next = size.unknown ? limit : data + size.value;
        if (!Number.isSafeInteger(next) || next > limit || next <= pos) return null;
        if ([0x18538067, 0x1549a966].includes(id.value) && level < 2) {
          const n = await ebml(data, next, level + 1); if (validDuration(n)) return n;
        } else if (level === 2 && id.value === 0x2ad7b1 && size.value > 0 && size.value <= 8) {
          const b = await read(data, size.value); scale = Number(b.reduce((n, v) => n * 256n + BigInt(v), 0n));
        } else if (level === 2 && id.value === 0x4489 && [4, 8].includes(size.value)) {
          const b = await read(data, size.value); duration = b.length === 4 ? b.readFloatBE() : b.readDoubleBE();
        }
        if (size.unknown) break;
        pos = next;
      }
      return duration === null ? null : duration * scale / 1e9;
    }
    const ext = path.extname(file).toLowerCase();
    const n = ['.mp4', '.m4v', '.mov'].includes(ext) ? await mp4(0, end) : ['.mkv', '.webm'].includes(ext) ? await ebml(0, end) : null;
    return validDuration(n) ? n : null;
  } finally { await handle.close(); }
}
let ffprobeMissing = false;
async function externalDuration(file) {
  if (ffprobeMissing) return null;
  return new Promise(resolve => {
    let output = '', settled = false;
    const child = spawn(process.env.SCREENROOM_FFPROBE || 'ffprobe', ['-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm,avi,asf,mpeg,mpegts', '-probesize', '1000000', '-analyzeduration', '1000000', '-show_entries', 'format=duration', '-of', 'json', '-i', file], { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
    const finish = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => { child.kill(); finish(null); }, 5000);
    child.on('error', error => { if (error.code === 'ENOENT') ffprobeMissing = true; finish(null); });
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 65536) { child.kill(); finish(null); } });
    child.on('close', code => { let n; try { n = Number(JSON.parse(output).format.duration); } catch {} finish(code === 0 && validDuration(n) ? n : null); });
  });
}
export async function probeDuration(file, { external = true } = {}) {
  try { const n = await containerDuration(file); if (validDuration(n)) return n; } catch { /* Bad or unsupported header: keep unknown, not guessed. */ }
  return external ? externalDuration(file).catch(() => null) : null;
}
