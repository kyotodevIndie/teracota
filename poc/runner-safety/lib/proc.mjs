import { execFileSync } from 'node:child_process';

const own = new Map();

export function pidExists(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Process creation time as read from the OS (ISO string), or null if the PID does not exist. */
export function getProcStart(pid) {
  if (!pidExists(pid)) return null;
  if (own.has(pid)) return own.get(pid);
  let v = null;
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `$p=Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue; if($p){$p.StartTime.ToUniversalTime().ToString('o')}`],
        { encoding: 'utf8', windowsHide: true }).trim();
      v = out || null;
    } else {
      v = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim() || null;
    }
  } catch { v = null; }
  if (pid === process.pid && v) own.set(pid, v);
  return v;
}

export function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
