import os from 'node:os';
import { isIP } from 'node:net';

export function networkSettings(input = {}, previous = {}) {
  const port = Number(input.port ?? 3210), allowLan = input.allowLan ?? false;
  const enableIpv6 = input.enableIpv6 === undefined ? previous.enableIpv6 ?? false : input.enableIpv6;
  const enableDiscovery = input.enableDiscovery === undefined ? previous.enableDiscovery ?? true : input.enableDiscovery;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口号需要是 1–65535 的整数。');
  if (typeof allowLan !== 'boolean') throw new Error('局域网访问设置必须是开启或关闭。');
  if (typeof enableIpv6 !== 'boolean') throw new Error('IPv6 设置必须是开启或关闭。');
  if (typeof enableDiscovery !== 'boolean') throw new Error('App 搜索设置必须是开启或关闭。');
  return { port, allowLan, enableIpv6, enableDiscovery };
}

// Canonicalize OS socket addresses, including expanded IPv6 and IPv4-mapped forms.
// Interface scope IDs are not part of the address. Scoped HTTP Host values are rejected separately.
function canonicalAddress(address = '') {
  if (typeof address !== 'string') return '';
  let raw = address;
  if (raw.startsWith('[') || raw.endsWith(']')) {
    if (!raw.startsWith('[') || !raw.endsWith(']')) return '';
    raw = raw.slice(1, -1);
  }
  if (raw.includes('%')) {
    if (isIP(raw) !== 6) return '';
    raw = raw.split('%')[0];
  }
  const family = isIP(raw);
  if (family === 4) return raw;
  if (family !== 6) return '';
  return new URL(`http://[${raw}]`).hostname.slice(1, -1);
}
function mappedIpv4(address) {
  const match = /^::ffff:([a-f\d]{1,4}):([a-f\d]{1,4})$/.exec(address);
  if (!match) return '';
  const hi = parseInt(match[1], 16), lo = parseInt(match[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}
export function isLoopback(address = '') {
  const normalized = canonicalAddress(address);
  return normalized === '::1' || /^(?:127)\./.test(mappedIpv4(normalized) || normalized);
}
export function lanAddresses(interfaces = os.networkInterfaces(), { enableIpv6 = false } = {}) {
  const result = [];
  for (const entry of Object.values(interfaces).flat()) {
    if (!entry || entry.internal) continue;
    const address = canonicalAddress(entry.address);
    if (!address || isLoopback(address) || ['::', '0.0.0.0'].includes(address)) continue;
    const ipv4 = (entry.family === 'IPv4' || entry.family === 4) && isIP(address) === 4;
    const ipv6 = (entry.family === 'IPv6' || entry.family === 6) && isIP(address) === 6;
    // fe80::/10 needs a client-side interface identifier, which common browser URLs
    // and WHATWG URL do not support. Do not generate unusable or unscoped links.
    const firstWord = parseInt(address.split(':')[0], 16);
    const linkLocal = ipv6 && firstWord >= 0xfe80 && firstWord <= 0xfebf;
    if (ipv4 || enableIpv6 && ipv6 && !linkLocal && !mappedIpv4(address)) result.push(address);
  }
  return [...new Set(result)];
}
export function allowedHost(header, allowLan, { enableIpv6 = false, addresses = lanAddresses(undefined, { enableIpv6 }), hostname = os.hostname() } = {}) {
  try {
    if (typeof header !== 'string' || !header || /[\s/@\\#?%]/.test(header)) return false;
    const host = new URL(`http://${header}`).hostname.toLowerCase();
    if (host.startsWith('[') && !enableIpv6) return false;
    const address = canonicalAddress(host);
    if (host === 'localhost' || isLoopback(address)) return true;
    return allowLan && (host === hostname.toLowerCase() || !!address && addresses.some(known => canonicalAddress(known) === address));
  } catch { return false; }
}

export function accessUrls({ port, allowLan, enableIpv6 = false }, interfaces = os.networkInterfaces()) {
  const addresses = ['127.0.0.1', ...(enableIpv6 ? ['::1'] : []), ...(allowLan ? lanAddresses(interfaces, { enableIpv6 }) : [])];
  return [...new Set(addresses)].map(ip => `http://${isIP(ip) === 6 ? `[${ip}]` : ip}:${port}`);
}

export function bindingOptions({ port, allowLan, enableIpv6 = false }) {
  // Separate IPv4 + IPv6-only sockets work on Windows/Linux and never turn a
  // local-only setting into a wildcard bind as an accidental dual-stack side effect.
  return [{ port, host: allowLan ? '0.0.0.0' : '127.0.0.1' },
    ...(enableIpv6 ? [{ port, host: allowLan ? '::' : '::1', ipv6Only: true }] : [])];
}

function listenOne(server, options) {
  return new Promise((resolve, reject) => {
    const failed = error => { server.off('listening', listening); reject(error); };
    const listening = () => { server.off('error', failed); resolve(); };
    server.once('error', failed); server.once('listening', listening);
    try { server.listen(options); }
    catch (error) { server.off('error', failed); failed(error); }
  });
}
export async function closeListeners({ server, ipv6Server }) {
  await Promise.all([server, ipv6Server].filter(Boolean).map(listener => new Promise((resolve, reject) => {
    if (!listener.listening) return resolve();
    listener.close(error => error ? reject(error) : resolve());
    listener.closeAllConnections?.();
  })));
}
export async function startListening(app, { port = app.listenConfig.port } = {}) {
  if (app.server.listening || app.ipv6Server?.listening) throw new Error('服务已经运行，请先停止后再启动。');
  const options = bindingOptions({ ...app.listenConfig, port });
  try {
    await listenOne(app.server, options[0]);
    if (options.length > 1) {
      // Port 0 is only used by isolated tests. Both protocols must share the actual port.
      await listenOne(app.ipv6Server, { ...options[1], port: app.server.address().port });
    }
  } catch (error) {
    // Never silently claim IPv6 is enabled, or leave a half-started service behind.
    await closeListeners(app);
    throw error;
  }
  return app.server.address().port;
}
