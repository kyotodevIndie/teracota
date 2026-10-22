import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Orchestrator, LockBusyError } from '../lib/orchestrator.mjs';
import { readLines } from '../lib/journal.mjs';
import { tmpRoot, spawnJson, runJson, waitFor, sleep } from './helpers.mjs';

const mk = (name, opts = {}) => { const root = tmpRoot(name); const logs = []; return { root, logs, o: new Orchestrator({ root, backoffBaseMs: 10, log: (m) => logs.push(m), ...opts }) }; };
const lines = (f) => readLines(f).records.length;

test('H(1) user interrupt -> interrupted (not failed), lock released', async () => {
  const { o, root } = mk('h1');
  o.createTask('t', 's');
  const { done } = o.start('t', { scenario: 'hang', interval: 20 });
  await waitFor(() => o.runnerPid('t') && lines(o.transcriptOf('s')) > 3);
  assert.equal(o.interrupt('t'), true);
  const fin = await done;
  assert.equal(fin.state, 'interrupted'); assert.equal(fin.reason, 'user_interrupt');
  assert.equal(fs.existsSync(path.join(root, 'locks', 's.lock')), false);
});

test('H(2) runner SIGKILLed -> needs_reconcile, not re-executed, evidence collected', async () => {
  const { o } = mk('h2');
  o.createTask('t', 's');
  const { done } = o.start('t', { scenario: 'hang', interval: 20 });
  await waitFor(() => lines(o.transcriptOf('s')) > 4);
  const pid = o.runnerPid('t');
  process.kill(pid, 'SIGKILL');
  const fin = await done;
  assert.equal(fin.state, 'needs_reconcile');
  assert.match(fin.reason, /runner_died/);
  assert.ok(fin.evidence.lastTranscriptEvent.type);
  const n = lines(o.transcriptOf('s')); await sleep(300);
  assert.equal(lines(o.transcriptOf('s')), n, 'nothing re-executed');
  const starts = o.journal.read().records.filter((r) => r.kind === 'runner_started');
  assert.equal(starts.length, 1);
});

test('D: orchestrator killed (kill -9) while running -> startup reconcile moves to needs_reconcile with evidence, no re-run', async () => {
  const { o, root } = mk('d');
  o.createTask('t', 's');
  const eff = { kind: 'remote_call', log: path.join(root, 'remote.log'), line: 'deploy' };
  const p = spawnJson('orch-cli.mjs', ['start', root, 't', '--scenario', 'hang', '--interval', '20']);
  await p.waitLine((l) => l.result === 'started');
  await waitFor(() => lines(o.transcriptOf('s')) > 3);
  // an effect with intent but no confirmation
  fs.appendFileSync(o.effectsFile, JSON.stringify({ taskId: 't', key: 'k1', step: 'x', status: 'intent', kind: 'write_file', target: path.join(root, 'half.txt'), verifiable: true }) + '\n');
  fs.writeFileSync(path.join(root, 'half.txt'), 'partial');
  process.kill(p.pid, 'SIGKILL'); await p.exit;
  assert.equal(o.state('t').state, 'running'); // journal still says running
  await sleep(500); // runner sees stdin closed and dies
  const o2 = new Orchestrator({ root });
  const moved = o2.reconcileOnStartup();
  assert.deepEqual(moved, ['t']);
  const t = o2.state('t');
  assert.equal(t.state, 'needs_reconcile'); assert.equal(t.hasUnconfirmedEffects, true);
  assert.match(t.reason, /orchestrator_crash\(lock=pid_dead\)/);
  assert.equal(t.evidence.unconfirmedEffects[0].targetExists, true);
  assert.ok(t.evidence.lastTranscriptEvent);
  const n = lines(o2.transcriptOf('s')); await sleep(300);
  assert.equal(lines(o2.transcriptOf('s')), n);
  assert.deepEqual(o2.reconcileOnStartup(), []); // idempotent
  assert.equal(fs.existsSync(path.join(root, 'locks', 's.lock')), false);
});

test('D: reconcile skips a task whose lock is held by a live orchestrator', async () => {
  const { o, root } = mk('d2');
  o.createTask('t', 's');
  const { done } = o.start('t', { scenario: 'hang', interval: 20 });
  const o2 = new Orchestrator({ root });
  assert.deepEqual(o2.reconcileOnStartup(), []);
  assert.equal(o2.state('t').state, 'running');
  o.interrupt('t'); await done;
});

test('H(4) two orchestrator processes, same session: one refused', async () => {
  const { o, root } = mk('h4');
  o.createTask('t', 's');
  const at = String(Date.now() + 4000);
  const ps = [0, 1].map(() => spawnJson('orch-cli.mjs', ['start', root, 't', '--scenario', 'hang', '--interval', '50', '--at', at]));
  const first = await Promise.all(ps.map((p) => p.waitLine((l) => l.result === 'started' || l.result === 'refused')));
  console.log('H4 outputs:', JSON.stringify(first));
  assert.equal(first.filter((l) => l.result === 'started').length, 1);
  const refused = first.find((l) => l.result === 'refused');
  assert.equal(refused.error, 'LockBusyError');
  const winner = ps[first.findIndex((l) => l.result === 'started')];
  const running = o.journal.read().records.filter((r) => r.type === 'transition' && r.to === 'running');
  assert.equal(running.length, 1);
  process.kill(winner.pid, 'SIGKILL'); await Promise.all(ps.map((p) => p.exit));
});

test('H(5) explicit resume after reconcile: new run, new lock, same session transcript continues', async () => {
  const { o, root } = mk('h5');
  o.createTask('t', 's');
  let { done } = o.start('t', { scenario: 'hang', interval: 20 });
  await waitFor(() => lines(o.transcriptOf('s')) > 4);
  process.kill(o.runnerPid('t'), 'SIGKILL'); await done;
  assert.equal(o.state('t').state, 'needs_reconcile');
  // no implicit restart
  assert.throws(() => o.start('t', { scenario: 'ok' }), /userResume/);
  assert.equal(fs.existsSync(path.join(root, 'locks', 's.lock')), false); // failed attempt left no lock
  const before = lines(o.transcriptOf('s'));
  const r = o.start('t', { scenario: 'ok', steps: 2, interval: 10, userResume: true });
  const nonce = JSON.parse(fs.readFileSync(path.join(root, 'locks', 's.lock'), 'utf8')).nonce;
  const fin = await r.done;
  assert.equal(fin.state, 'completed');
  assert.ok(lines(o.transcriptOf('s')) > before);
  const recs = o.journal.read().records;
  const resumed = recs.filter((x) => x.kind === 'runner_started').at(-1);
  assert.equal(resumed.resume, true);
  assert.ok(nonce);
  const tr = readLines(o.transcriptOf('s')).records;
  assert.ok(tr.some((x) => x.resumed === true));
});

test('G: auth_error / session_expired / usage_limited are distinct states with NO retry', async () => {
  for (const [scenario, state] of [['auth', 'auth_error'], ['expired', 'session_expired'], ['usage', 'usage_limited']]) {
    const { o } = mk(`g-${scenario}`);
    o.createTask('t', 's');
    const fin = await o.start('t', { scenario }).done;
    assert.equal(fin.state, state);
    assert.equal(o.journal.read().records.filter((r) => r.kind === 'runner_started').length, 1, `${scenario}: exactly one attempt`);
    assert.equal(o.journal.read().records.filter((r) => r.kind === 'retry').length, 0);
  }
});

test('G: transient error retried with exponential backoff, max 3 retries, then failed', async () => {
  const { o } = mk('g-t1', { backoffBaseMs: 20 });
  o.createTask('t', 's');
  const fin = await o.start('t', { scenario: 'transient', failUntil: 99 }).done;
  assert.equal(fin.state, 'failed'); assert.equal(fin.reason, 'retries_exhausted');
  const rs = o.journal.read().records;
  assert.deepEqual(rs.filter((r) => r.kind === 'retry').map((r) => r.delayMs), [20, 40, 80]);
  assert.equal(rs.filter((r) => r.kind === 'runner_started').length, 4);
});

test('G: transient error that clears after 2 failures -> completes', async () => {
  const { o } = mk('g-t2');
  o.createTask('t', 's');
  const fin = await o.start('t', { scenario: 'transient', failUntil: 2, steps: 1, interval: 5 }).done;
  assert.equal(fin.state, 'completed');
  assert.equal(o.journal.read().records.filter((r) => r.kind === 'retry').length, 2);
});

test('H: live lock on session refuses start from same-process second orchestrator', async () => {
  const { o, root } = mk('h6');
  o.createTask('t', 's');
  const a = o.start('t', { scenario: 'hang', interval: 20 });
  const o2 = new Orchestrator({ root });
  assert.throws(() => o2.start('t', { scenario: 'ok' }), LockBusyError);
  o.interrupt('t'); await a.done;
});
