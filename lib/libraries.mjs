import { randomUUID } from 'node:crypto';
import { clean } from './catalog.mjs';

export function initializeLibraries(state) {
  if (state.libraries === undefined) {
    // One migration bucket, never one library per source. Future sources are not auto-assigned.
    state.libraries = state.sources.length ? [{ id: 'default-library', name: '默认片库', sourceIds: state.sources.map(s => s.id), revision: 1 }] : [];
  }
  if (!Array.isArray(state.libraries) || state.libraries.length > 100 || state.libraries.some(l =>
    !l || typeof l.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(l.id) || ['all', 'demo', '__unassigned'].includes(l.id)
    || typeof l.name !== 'string' || !l.name.trim() || l.name.length > 60 || !Array.isArray(l.sourceIds)
    || l.sourceIds.length > 100 || l.sourceIds.some(id => typeof id !== 'string' || !id || id.length > 100)
    || l.revision !== undefined && (!Number.isSafeInteger(l.revision) || l.revision < 1))
    || new Set(state.libraries.map(l => l.id)).size !== state.libraries.length) {
    throw new Error('自定义影片库数据格式错误，已停止启动以避免覆盖。请先备份 data/library.json。');
  }
}

export function planLibrary(libraries, sources, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('影片库设置格式不正确。');
  const previous = input.id ? libraries.find(l => l.id === input.id) : null;
  if (input.id && !previous) { const error = new Error('影片库不存在，请刷新后重试。'); error.status = 404; throw error; }
  if (previous && input.revision !== (previous.revision || 1)) { const error = new Error('影片库已被修改，请刷新后重试。'); error.status = 409; throw error; }
  if (!previous && libraries.length >= 100) throw new Error('最多创建 100 个自定义影片库。');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 60 || clean(input.name, 60) !== input.name.trim()) throw new Error('影片库名称需为 1–60 个普通文字字符。');
  const name = input.name.trim();
  if (libraries.some(l => l !== previous && l.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('已有同名影片库，请换个名称。');
  if (!Array.isArray(input.sourceIds) || input.sourceIds.length > 100 || input.sourceIds.some(id => typeof id !== 'string' || !sources.some(s => s.id === id))) throw new Error('请勾选当前存在的影片来源。');
  return { id: previous?.id || randomUUID(), name, sourceIds: [...new Set(input.sourceIds)], revision: (previous?.revision || 0) + 1 };
}
