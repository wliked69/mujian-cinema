import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_APPEARANCE, loadDeviceAppearance, saveDeviceAppearance } from '../public/device-appearance.js';

function deviceStorage() {
  const data = new Map();
  return { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
}

test('同一账号的主题、颜色和列数按设备隔离，同设备也不串号', () => {
  const desktop = deviceStorage(), phone = deviceStorage();
  const prior = { theme: 'dark', accent: '#abcDEF', columns: '6', playback: 'external' };
  assert.deepEqual(loadDeviceAppearance('account-1', prior, phone), { theme: 'dark', accent: '#abcdef', columns: '6' });
  saveDeviceAppearance('account-1', { theme: 'light', accent: '#ff9fad', columns: '2' }, phone);
  assert.deepEqual(loadDeviceAppearance('account-1', prior, phone), { theme: 'light', accent: '#ff9fad', columns: '2' });
  assert.deepEqual(loadDeviceAppearance('account-1', prior, desktop), { theme: 'dark', accent: '#abcdef', columns: '6' });
  assert.deepEqual(loadDeviceAppearance('account-2', null, phone), DEFAULT_APPEARANCE);
  assert.equal(prior.playback, 'external');
});

test('本地存储受限或数据损坏时安全回退，并提示保存失败', () => {
  const storage = { getItem() { throw new Error(); }, setItem() { throw new Error(); } };
  assert.deepEqual(loadDeviceAppearance('account-1', null, storage), DEFAULT_APPEARANCE);
  assert.throws(() => saveDeviceAppearance('account-1', DEFAULT_APPEARANCE, storage), /无法保存本机外观/);
  assert.deepEqual(loadDeviceAppearance('account-1', { theme: 'system' }, { getItem: () => '{"theme":"unknown","accent":"red","columns":"0"}' }), { ...DEFAULT_APPEARANCE, theme: 'system' });
});
