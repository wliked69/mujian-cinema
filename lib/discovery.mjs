import dgram from 'node:dgram';
import os from 'node:os';
import { isIP } from 'node:net';

export const DISCOVERY_PORT = 43210;
export const DISCOVERY_VERSION = 1;
const ipv4Number = ip => ip.split('.').reduce((v, p) => (v * 256 + Number(p)) >>> 0, 0);
export function privateIpv4(ip) {
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 || a === 169 && b === 254;
}
export function localDiscoveryPeer(ip, interfaces = os.networkInterfaces()) {
  if (!privateIpv4(ip)) return false;
  return Object.values(interfaces).flat().some(i => i && !i.internal && isIP(i.address) === 4 && isIP(i.netmask) === 4
    && ((ipv4Number(ip) & ipv4Number(i.netmask)) >>> 0) === ((ipv4Number(i.address) & ipv4Number(i.netmask)) >>> 0));
}
export function discoveryReply(message, httpPort) {
  if (!Buffer.isBuffer(message) || message.length > 256 || message.length < 40) return null;
  try {
    const q = JSON.parse(message.toString('utf8'));
    if (q.kind !== 'screenroom-discover' || q.v !== DISCOVERY_VERSION || typeof q.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(q.nonce)) return null;
    if (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65535) return null;
    return Buffer.from(JSON.stringify({ kind: 'screenroom-server', v: DISCOVERY_VERSION, nonce: q.nonce,
      port: httpPort, name: '幕间片库' }));
  } catch { return null; }
}

/** Respond only when LAN was explicitly enabled. No hostname, accounts or titles are advertised. */
export async function startDiscovery({ allowLan, enableDiscovery = true, httpPort,
  port = DISCOVERY_PORT, host = '0.0.0.0', allowedPeer = localDiscoveryPeer, state: suppliedState } = {}) {
  const state = suppliedState || {};
  Object.assign(state, { status: 'disabled', port: DISCOVERY_PORT, error: '', close: async () => {} });
  if (!allowLan || !enableDiscovery) return state;
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let closed = false;
  const peers = new Map();
  state.close = () => new Promise(resolve => {
    if (closed) return resolve();
    closed = true; state.status = 'stopped';
    try { socket.close(resolve); } catch { resolve(); }
  });
  socket.on('error', () => {
    state.error = 'App 搜索服务不可用，请检查 UDP 端口或手动填写地址。';
    state.close().finally(() => { state.status = 'error'; });
  });
  socket.on('message', (message, peer) => {
    if (closed || !allowedPeer(peer.address) || peer.port < 1024) return;
    const reply = discoveryReply(message, httpPort); if (!reply) return;
    const now = Date.now();
    for (const [ip, at] of peers) if (now - at > 10000) peers.delete(ip);
    if (now - (peers.get(peer.address) || 0) < 700 || peers.size >= 128 && !peers.has(peer.address)) return;
    peers.set(peer.address, now);
    socket.send(reply, peer.port, peer.address, () => {});
  });
  await new Promise(resolve => {
    socket.once('error', resolve);
    socket.bind({ port, address: host }, () => {
      state.status = 'listening'; state.port = socket.address().port;
      socket.removeListener('error', resolve); socket.unref(); resolve();
    });
  });
  return state;
}
