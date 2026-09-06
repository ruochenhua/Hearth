import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = `http://127.0.0.1:${process.env.MYMOMENT_CONTROL_PORT || 3090}`;
const agent = path.join(root, 'scripts', 'host-control.mjs');

async function isReady() {
  try { return (await fetch(`${url}/api/status`)).ok; } catch { return false; }
}

function startAgent() {
  const child = spawn(process.execPath, [agent], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
}

function openBrowser() {
  const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : null;
  if (!command) return console.log(`Open ${url} in your browser.`);
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

if (!(await isReady())) {
  startAgent();
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && !(await isReady())) await new Promise(resolve => setTimeout(resolve, 250));
}

if (!(await isReady())) throw new Error(`MyMoment control center did not start. Open ${url} manually to inspect it.`);
if (process.env.MYMOMENT_AUTOSTART === '1') {
  const response = await fetch(`${url}/api/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'MyMoment album failed to start.');
}
openBrowser();
