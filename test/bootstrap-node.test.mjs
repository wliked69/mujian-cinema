import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('Windows Node 启动器：PS 5.1 版本判断、官方来源、校验、缓存、安全解压和失败清理', { skip: process.platform !== 'win32', timeout: 45000 }, () => {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const run = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./bootstrap-node.ps1', import.meta.url)), '-KnownNode', process.execPath],
    { encoding: 'utf8', timeout: 40000, windowsHide: true });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /BOOTSTRAP TESTS: \d+ passed/);
});
