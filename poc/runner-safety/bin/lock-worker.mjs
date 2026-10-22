// node lock-worker.mjs <locksDir> <sessionId> <atEpochMs> <holdMs> [heartbeatMs]
import { acquireLock } from '../lib/lock.mjs';
import { getProcStart, sleepSync } from '../lib/proc.mjs';

const [dir, sid, at, hold, hb] = process.argv.slice(2);
getProcStart(process.pid);
while (Date.now() < Number(at)) sleepSync(1);
try {
  const h = acquireLock(dir, sid, { heartbeatMs: Number(hb ?? 5000) });
  process.stdout.write(JSON.stringify({ pid: process.pid, ok: true, tookOver: h.tookOver?.reason ?? null }) + '\n');
  setTimeout(() => { h.release(); process.exit(0); }, Number(hold));
} catch (e) {
  process.stdout.write(JSON.stringify({ pid: process.pid, ok: false, reason: e.info?.reason ?? e.message }) + '\n');
  process.exit(3);
}
