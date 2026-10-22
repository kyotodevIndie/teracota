// Spawna runner.mjs, espera exit_marker no log e mata o processo pai com taskkill /F (sem /T).
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const opts = process.argv[2]; const name = JSON.parse(opts).name;
const log = path.join(here, 'out', name + '.jsonl');
const ps = (c) => execSync(`powershell -NoProfile -Command "${c}"`, { encoding: 'utf8' }).trim();
const child = spawn(process.execPath, [path.join(here, 'runner.mjs'), opts], { stdio: 'ignore' });
const info = { runnerPid: child.pid };
const iv = setInterval(() => {
  const txt = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  if (!info.grandchildren && txt.includes('"first_delta"') === false && txt.includes('"init"')) info.grandchildren = ps(`(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${child.pid}').ProcessId -join ','`);
  if (!txt.includes('"exit_marker"')) return;
  clearInterval(iv);
  info.killedAtMs = Date.now();
  execSync(`taskkill /F /PID ${child.pid}`, { stdio: 'ignore' });
  setTimeout(() => {
    const alive = info.grandchildren ? info.grandchildren.split(',').filter(p => ps(`(Get-Process -Id ${p} -ErrorAction SilentlyContinue).Id`)) : [];
    info.grandchildrenAliveAfter5s = alive;
    fs.writeFileSync(path.join(here, 'out', name + '.kill.json'), JSON.stringify(info, null, 1));
    console.log(JSON.stringify(info));
    process.exit(0);
  }, 5000);
}, 100);
setTimeout(() => { console.log('timeout'); process.exit(1); }, 120000);
