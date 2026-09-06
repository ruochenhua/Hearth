import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Windows launcher distinguishes ready, access denied and timeout states', { skip: process.platform !== 'win32' }, async (t) => {
  try {
    const { stdout } = await exec('pwsh.exe', ['-NoProfile', '-File', path.join(root, 'tests', 'windows-start.test.ps1')], { cwd: root, windowsHide: true });
    assert.match(stdout, /WINDOWS_START_HELPERS_OK/);
  } catch (e) {
    if (e && e.code === 'ENOENT') return t.skip('pwsh.exe 未安装，跳过 Windows 启动器测试');
    throw e;
  }
});
