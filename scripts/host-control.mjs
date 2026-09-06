import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.MYMOMENT_CONTROL_PORT || 3090);
const run = (file, args, options = {}) => new Promise((resolve, reject) => execFile(file, args, { cwd: root, windowsHide: true, timeout: 900000, ...options }, (error, stdout, stderr) => error ? reject(new Error((stderr || stdout || error.message).trim())) : resolve(stdout.trim())));
const localAddresses = () => Object.values(os.networkInterfaces()).flat().filter(Boolean).filter(x => x.family === 'IPv4' && !x.internal).map(x => x.address);
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
const readBody = req => new Promise((resolve, reject) => { let body = ''; req.on('data', chunk => { body += chunk; if (body.length > 10000) reject(new Error('request too large')); }); req.on('end', () => resolve(body ? JSON.parse(body) : {})); req.on('error', reject); });
const health = async () => { try { const response = await fetch('http://127.0.0.1:3080/api/health'); return response.ok; } catch { return false; } };
const waitForHealth = async (timeoutMs = 120000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await health()) return true;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
};
async function firewall(action) {
  if (process.platform === 'win32') {
    const script = path.join(root, 'scripts', 'windows-start.ps1');
    await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-NoBrowser', '-NoPause'], { windowsHide: false });
    return 'Windows local-subnet firewall rule verified or repaired.';
  }
  if (process.platform === 'linux') {
    if (await run('sh', ['-lc', 'command -v ufw || true'])) { await run('sudo', ['ufw', 'allow', 'from', '192.168.0.0/16', 'to', 'any', 'port', '3080', 'proto', 'tcp']); return 'Linux UFW local-subnet rule repaired.'; }
    if (await run('sh', ['-lc', 'command -v firewall-cmd || true'])) { await run('sudo', ['firewall-cmd', '--permanent', '--add-port=3080/tcp']); await run('sudo', ['firewall-cmd', '--reload']); return 'Linux firewalld rule repaired.'; }
    return 'No supported Linux firewall manager was detected; Docker is still bound to the LAN interface.';
  }
  return 'macOS uses the Docker Desktop network permission. No separate port rule is required by MyMoment.';
}
async function start() {
  if (process.platform === 'win32') { await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'windows-start.ps1'), '-ForceRecreate', '-NoBrowser', '-NoPause'], { windowsHide: false }); }
  else { await run('docker', ['compose', 'up', '-d', '--build', '--wait', '--wait-timeout', '90']); }
  const running = await waitForHealth();
  if (!running) throw new Error('The album did not become ready. Check Docker Desktop and the control center message.');
  return { running, message: 'Album started and ready.' };
}
async function stop() { await run('docker', ['compose', 'stop', 'album']); return { running: false, message: 'Album stopped.' }; }
async function status() { return { running: await health(), platform: process.platform, addresses: localAddresses(), albumUrl: 'http://localhost:3080' }; }

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MyMoment Control Center</title><style>body{margin:0;background:#f5f8f9;color:#173f4b;font:16px system-ui,-apple-system,Segoe UI,sans-serif}.card{max-width:680px;margin:8vh auto;padding:38px;background:white;border:1px solid #dfe8ea;border-radius:18px;box-shadow:0 16px 50px #173f4b12}h1{margin:0 0 8px;font-size:32px}p{color:#6f858e}.status{padding:14px 16px;border-radius:10px;background:#eef5f6;margin:26px 0}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#c17c5e;margin-right:8px}.up .dot{background:#529172}.buttons{display:flex;flex-wrap:wrap;gap:10px}button{border:0;border-radius:9px;padding:12px 17px;background:#173f4b;color:white;font-size:15px;cursor:pointer}button.secondary{background:#e7f0f1;color:#173f4b}button:disabled{opacity:.5}small{color:#81949c;display:block;margin-top:25px;line-height:1.7}.url{display:block;margin:6px 0;color:#4f8290}</style></head><body><main class="card"><h1>MyMoment</h1><p>Family album control center</p><div id="status" class="status"><span class="dot"></span><b>Checking…</b></div><div id="urls"></div><div class="buttons"><button id="start">Start album</button><button id="stop" class="secondary">Stop album</button><button id="repair" class="secondary">Repair LAN access</button><button id="open" class="secondary">Open album</button></div><small>This control center runs only on this computer. It detects Windows, macOS, or Linux automatically and keeps firewall details inside the platform adapter.</small></main><script>const $=s=>document.querySelector(s);async function api(path,method='GET'){const r=await fetch(path,{method,headers:{'Content-Type':'application/json'}});const b=await r.json();if(!r.ok)throw Error(b.error||'Action failed');return b}async function refresh(){try{const s=await api('/api/status');$('#status').className='status '+(s.running?'up':'');$('#status').innerHTML='<span class="dot"></span><b>'+(s.running?'Running':'Stopped')+'</b> · '+s.platform;$('#urls').innerHTML='<a class="url" href="http://localhost:3080">Local: http://localhost:3080</a>'+s.addresses.map(a=>'<span class="url">LAN: http://'+a+':3080</span>').join('');$('#start').disabled=s.running;$('#stop').disabled=!s.running}catch(e){$('#status').innerHTML='<span class="dot"></span><b>Control agent unavailable</b>'}}async function action(path){try{for(const b of document.querySelectorAll('button'))b.disabled=true;await api(path,'POST');await refresh()}catch(e){alert(e.message)}finally{await refresh()}}$('#start').onclick=()=>action('/api/start');$('#stop').onclick=()=>action('/api/stop');$('#repair').onclick=()=>action('/api/repair');$('#open').onclick=()=>window.open('http://localhost:3080','_blank');refresh();setInterval(refresh,2500)</script></body></html>`;
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page); return; }
    if (req.method === 'GET' && req.url === '/api/status') { json(res, 200, await status()); return; }
    if (req.method === 'POST' && req.url === '/api/start') { await readBody(req); json(res, 200, await start()); return; }
    if (req.method === 'POST' && req.url === '/api/stop') { await readBody(req); json(res, 200, await stop()); return; }
    if (req.method === 'POST' && req.url === '/api/repair') { await readBody(req); json(res, 200, { message: await firewall('repair') }); return; }
    json(res, 404, { error: 'Not found' });
  } catch (error) { json(res, error.status || 500, { error: error.message }); }
});
server.listen(port, '127.0.0.1', () => console.log(`MyMoment Control Center: http://127.0.0.1:${port}`));
