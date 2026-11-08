import fs from 'node:fs/promises';
import path from 'node:path';

export async function createStore(dir) {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'library.json');
  let state;
  try { state = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('片库文件损坏，已停止启动以避免覆盖。请先备份 data/library.json。');
    state = { sources: [], movies: [], favorites: {}, history: {}, updatedAt: null };
  }
  if (!state || !Array.isArray(state.sources) || !Array.isArray(state.movies) || (state.users && !Array.isArray(state.users)) || (state.profiles && (typeof state.profiles !== 'object' || Array.isArray(state.profiles))) || (state.sessions && (typeof state.sessions !== 'object' || Array.isArray(state.sessions))) || (state.loginEvents && !Array.isArray(state.loginEvents)) || (state.comments && !Array.isArray(state.comments))) {
    throw new Error('片库文件结构不正确，已停止启动以避免覆盖。请先备份 data/library.json。');
  }
  let pending = Promise.resolve();
  return {
    state,
    flush: () => pending,
    save() {
      const snapshot = JSON.stringify(state, null, 2);
      const operation = pending.catch(() => {}).then(async () => {
        const temp = `${file}.tmp`;
        await fs.writeFile(temp, snapshot, { encoding: 'utf8', mode: 0o600 });
        await fs.rename(temp, file);
      });
      pending = operation;
      return operation;
    },
  };
}
