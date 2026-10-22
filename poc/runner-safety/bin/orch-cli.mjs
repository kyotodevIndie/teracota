// Thin CLI around the orchestrator so tests can run it as separate (killable) processes.
// node orch-cli.mjs <cmd> <root> ...   Output: JSON lines on stdout.
import { Orchestrator, writeApproval, LockBusyError, InvalidTransitionError } from '../lib/orchestrator.mjs';
import { getProcStart, sleepSync } from '../lib/proc.mjs';

const [cmd, root, ...rest] = process.argv.slice(2);
const opt = (k, d) => { const i = rest.indexOf(`--${k}`); return i < 0 ? d : rest[i + 1]; };
const flag = (k) => rest.includes(`--${k}`);
const out = (o) => process.stdout.write(JSON.stringify({ pid: process.pid, ...o }) + '\n');
const mk = () => new Orchestrator({ root, hostId: opt('host', undefined), heartbeatMs: Number(opt('heartbeat', 5000)), staleMs: Number(opt('stale', 30000)), backoffBaseMs: 20 });

if (cmd === 'approve') { writeApproval(root, rest[0]); out({ approved: rest[0] }); }
else if (cmd === 'start') {
  const taskId = rest[0];
  getProcStart(process.pid); // warm up the (slow) own-start-time lookup before the barrier
  const at = Number(opt('at', 0));
  if (at) { while (Date.now() < at) sleepSync(1); }
  const o = mk();
  try {
    const { done } = o.start(taskId, { scenario: opt('scenario', 'ok'), steps: opt('steps'), interval: opt('interval'), userResume: flag('resume') });
    out({ result: 'started', runnerPid: undefined });
    const fin = await done;
    out({ result: 'finished', state: fin.state, reason: fin.reason });
  } catch (e) {
    out({ result: 'refused', error: e.name, message: e.message });
    process.exit(e instanceof LockBusyError ? 3 : e instanceof InvalidTransitionError ? 4 : 5);
  }
} else if (cmd === 'crash-transition') { // half-written journal line, then SIGKILL itself
  const o = mk();
  o.transition(rest[0], 'completed', 'crash_test', { __partial: true });
  out({ wrote: 'partial' });
  process.kill(process.pid, 'SIGKILL');
} else if (cmd === 'effect') {
  const o = mk();
  const hooks = flag('crash-after-exec') ? { afterExec: () => process.kill(process.pid, 'SIGKILL') } : {};
  const r = o.runEffect(rest[0], rest[1], JSON.parse(rest[2]), { destructive: flag('destructive'), continueRequested: flag('continue'), hooks });
  out(r);
} else { out({ error: 'unknown command' }); process.exit(9); }
