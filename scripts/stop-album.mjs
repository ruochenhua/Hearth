import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exec = promisify(execFile);

try {
  const result = await exec('docker', ['compose', 'stop', 'album'], { cwd: root, windowsHide: true });
  if (result.stdout.trim()) console.log(result.stdout.trim());
  console.log('围炉（Hearth）相册已停止。');
} catch (error) {
  console.error((error.stderr || error.stdout || error.message).trim());
  process.exitCode = 1;
}
