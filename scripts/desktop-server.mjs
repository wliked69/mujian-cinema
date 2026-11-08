import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { closeListeners, startListening } from '../lib/network.mjs';
import { startDiscovery } from '../lib/discovery.mjs';

// The desktop control pipe and the authenticated admin action use the same shutdown.
export async function runDesktopServer({ dataDir, portOverride = process.env.PORT } = {}) {
  const input = createInterface({ input: process.stdin, terminal: false });
  const send = line => process.stdout.write(line + '\n');
  let app, ready = false, stopping = false, parentGone = false, pendingStop = false;
  async function stop(force = false) {
    if (stopping) return;
    if (!ready) { pendingStop ||= force; return; }
    if (!force && app.getJob().status === 'running') { send('BUSY'); return; }
    stopping = true;
    input.close();
    process.stdin.destroy();
    try {
      await app.shutdown();
    } catch {
      if (!parentGone) send('ERROR save');
      process.exitCode = 1;
    }
  }
  input.on('line', line => {
    if (line === 'stop') void stop();
    if (line === 'shutdown') void stop(true);
  });
  input.on('close', () => {
    if (!stopping) { parentGone = true; void stop(true); }
  });
  try {
    app = await createApp({ dataDir, portOverride, onShutdown: () => { void stop(true); } });
    const port = await startListening(app);
    await startDiscovery({ ...app.listenConfig, httpPort: port, state: app.discovery });
    ready = true;
    if (parentGone || pendingStop) await stop(true);
    else send(`READY ${port}`);
  } catch (error) {
    stopping = true;
    input.close();
    process.stdin.destroy();
    if (app) await Promise.allSettled([app.discovery.close(), closeListeners(app)]);
    const code = error.code === 'EADDRINUSE' ? 'port'
      : ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT'].includes(error.code) ? 'network'
      : /^片库文件/.test(error.message) ? 'library' : 'startup';
    if (!parentGone) send(`ERROR ${code}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runDesktopServer();
}
