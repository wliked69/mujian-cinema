export function createNativeClient(bridge, { timeoutMs = 5000 } = {}) {
  let sequence = 0;
  const pending = new Map();
  bridge.onmessage = event => {
    try {
      const result = JSON.parse(event.data), task = pending.get(result.id);
      if (!task) return;
      clearTimeout(task.timer); pending.delete(result.id);
      result.ok === true ? task.resolve(result.value) : task.reject(new Error(result.value || '手机播放器操作失败。'));
    } catch { /* Ignore unsolicited/malformed bridge data. */ }
  };
  return (type, payload = {}) => new Promise((resolve, reject) => {
    if (!['getPlayback', 'settings', 'connectionSettings', 'openVideo'].includes(type)) return reject(new Error('不支持的 App 操作。'));
    const id = `m_${Date.now().toString(36)}_${(++sequence).toString(36)}`;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('App 未响应，请更新系统 WebView 或重开 App。')); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try { bridge.postMessage(JSON.stringify({ ...payload, id, type })); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
}
let request;
export function mobileAvailable() { return typeof window !== 'undefined' && typeof window.ScreenRoomAndroid?.postMessage === 'function'; }
export function mobileRequest(type, payload) {
  if (!mobileAvailable()) return Promise.reject(new Error('此页面不在支持手机播放器的新版 App 内。'));
  request ||= createNativeClient(window.ScreenRoomAndroid);
  return request(type, payload);
}
