// Crash scenarios with real processes. Writes a readable log to out/crash-scenarios.log
// Usage: node scripts/crash-scenarios.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Orchestrator } from '../lib/orchestrator.mjs';
import { acquireLock } from '../lib/lock.mjs';
import { tmpRoot, spawnJson, runJson, waitFor, sleep } from '../test/helpers.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'out');
fs.mkdirSync(OUT, { recursive: true });
const logf = path.join(OUT, 'crash-scenarios.log');
fs.writeFileSync(logf, `# crash scenarios ${new Date().toISOString()} node ${process.version} ${process.platform}\n`);
const log = (...a) => { const s = a.join(' '); console.log(s); fs.appendFileSync(logf, s + '\n'); };
const dump = (title, f) => { log(`--- ${title}`); if (fs.existsSync(f)) log(fs.readFileSync(f, 'utf8').trimEnd()); };
const nlines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length;

// S1: runner SIGKILL
{
  log('\n=== S1 runner SIGKILL (orchestrator alive)');
  const root = tmpRoot('s1'); const o = new Orchestrator({ root, log });
  o.createTask('t', 's1');
  const { done } = o.start('t', { scenario: 'hang', interval: 20 });
  await waitFor(() => fs.existsSync(o.transcriptOf('s1')) && nlines(o.transcriptOf('s1')) > 4);
  const pid = o.runnerPid('t'); log('killing runner pid', pid); process.kill(pid, 'SIGKILL');
  const fin = await done; log('final state:', fin.state, '|', fin.reason);
  log('evidence:', JSON.stringify(fin.evidence));
  dump('journal', o.journal.file); dump('transcript', o.transcriptOf('s1'));
}
// S2: orchestrator SIGKILL while running, then startup reconciliation
{
  log('\n=== S2 orchestrator SIGKILL while task running; restart + reconcile');
  const root = tmpRoot('s2'); const o = new Orchestrator({ root, log });
  o.createTask('t', 's2');
  const p = spawnJson('orch-cli.mjs', ['start', root, 't', '--scenario', 'hang', '--interval', '20']);
  await p.waitLine((l) => l.result === 'started');
  await waitFor(() => fs.existsSync(o.transcriptOf('s2')) && nlines(o.transcriptOf('s2')) > 4);
  log('lock file:', fs.readFileSync(path.join(root, 'locks', 's2.lock'), 'utf8'));
  log('killing orchestrator pid', p.pid); process.kill(p.pid, 'SIGKILL'); await p.exit; await sleep(500);
  log('journal state before reconcile:', o.state('t').state);
  const moved = new Orchestrator({ root, log }).reconcileOnStartup(); log('reconciled:', JSON.stringify(moved));
  const t = o.state('t'); log('state after:', t.state, '|', t.reason); log('evidence:', JSON.stringify(t.evidence));
  const n = nlines(o.transcriptOf('s2')); await sleep(400); log('transcript stable (no re-run):', n === nlines(o.transcriptOf('s2')));
  dump('journal', o.journal.file);
}
// S3: torn journal write
{
  log('\n=== S3 orchestrator SIGKILL mid journal write');
  const root = tmpRoot('s3'); const o = new Orchestrator({ root, log });
  o.createTask('t', 's3'); o.transition('t', 'running', 'x');
  const r = runJson('orch-cli.mjs', ['crash-transition', root, 't']); log('child exit:', JSON.stringify({ code: r.code, signal: r.signal }));
  dump('journal (note torn last line)', o.journal.file);
  log('derived state:', o.state('t').state);
}
// S4: lock holder SIGKILL, takeover
{
  log('\n=== S4 lock holder SIGKILL -> takeover');
  const dir = path.join(tmpRoot('s4'), 'locks');
  const w = spawnJson('lock-worker.mjs', [dir, 's4', String(Date.now()), '60000']);
  const held = await w.waitLine((l) => l.ok === true); log('holder', held.pid);
  try { acquireLock(dir, 's4'); } catch (e) { log('while alive ->', e.message); }
  process.kill(held.pid, 'SIGKILL'); await w.exit;
  const h = acquireLock(dir, 's4'); log('after kill -> takeover:', h.tookOver.reason); h.release();
}
log('\nlog written to', logf);
