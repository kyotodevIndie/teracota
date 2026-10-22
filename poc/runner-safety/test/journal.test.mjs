import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Journal } from '../lib/journal.mjs';
import { STATES, TRANSITIONS, canTransition, InvalidTransitionError, TERMINAL } from '../lib/states.mjs';
import { tmpRoot, spawnJson, runJson } from './helpers.mjs';

const mkJ = (n) => { const warns = []; const f = path.join(tmpRoot(n), 'journal.jsonl'); return { j: new Journal(f, { onWarn: (w) => warns.push(w) }), f, warns }; };

test('C: every transition not in the table is refused (exhaustive)', () => {
  let refused = 0, allowed = 0;
  for (const from of [null, ...STATES]) for (const to of STATES) {
    const ok = (TRANSITIONS[String(from)] ?? []).includes(to);
    assert.equal(canTransition(from, to), ok);
    ok ? allowed++ : refused++;
  }
  assert.ok(refused > allowed);
  for (const t of TERMINAL) assert.deepEqual(TRANSITIONS[t], []);
});

test('C: journal refuses invalid transitions and keeps state intact', () => {
  const { j } = mkJ('jc');
  assert.throws(() => j.transition({ taskId: 't', sessionId: 's', to: 'running' }), InvalidTransitionError); // not created
  j.transition({ taskId: 't', sessionId: 's', to: 'queued' });
  assert.throws(() => j.transition({ taskId: 't', to: 'completed' }), InvalidTransitionError);   // queued -> completed
  j.transition({ taskId: 't', to: 'running' });
  j.transition({ taskId: 't', to: 'interrupted', reason: 'user' });
  assert.throws(() => j.transition({ taskId: 't', to: 'failed' }), InvalidTransitionError);       // interrupted is not failed
  j.transition({ taskId: 't', to: 'running', reason: 'user_resume' });
  j.transition({ taskId: 't', to: 'completed' });
  assert.throws(() => j.transition({ taskId: 't', to: 'running' }), InvalidTransitionError);      // terminal
  assert.equal(j.states().tasks.get('t').state, 'completed');
  assert.equal(j.states().tasks.get('t').seq, 5);
});

test('B: state derives from journal; truncated last line is ignored with warning, earlier lines survive', () => {
  const { j, f, warns } = mkJ('jb');
  j.transition({ taskId: 'a', sessionId: 's1', to: 'queued' });
  j.transition({ taskId: 'a', to: 'running' });
  j.transition({ taskId: 'b', sessionId: 's2', to: 'queued' });
  const full = fs.readFileSync(f, 'utf8');
  j.transition({ taskId: 'a', to: 'completed' });
  const withLast = fs.readFileSync(f, 'utf8');
  const lastLine = withLast.slice(full.length);
  // truncate the last line at EVERY possible byte offset (crash mid-write)
  for (let n = 0; n < lastLine.length - 1; n++) {
    fs.writeFileSync(f, full + lastLine.slice(0, n));
    warns.length = 0;
    const { tasks } = j.states();
    assert.equal(tasks.get('a').state, 'running', `offset ${n}`);
    assert.equal(tasks.get('b').state, 'queued');
    if (n > 0) assert.ok(warns.length >= 1, `warn at offset ${n}`);
  }
});

test('B: appending after a torn line starts a clean line and the torn fragment stays ignored', () => {
  const { j, f, warns } = mkJ('jb2');
  j.transition({ taskId: 'a', sessionId: 's', to: 'queued' });
  j.transition({ taskId: 'a', to: 'running', extra: { __partial: true } }); // half line, no newline
  assert.equal(j.states().tasks.get('a').state, 'queued');
  j.transition({ taskId: 'a', to: 'running', reason: 'retry-after-crash' });
  warns.length = 0;
  const { tasks } = j.states();
  assert.equal(tasks.get('a').state, 'running');
  assert.equal(tasks.get('a').seq, 2);
  assert.equal(warns.length, 1);
  assert.equal(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length, 3);
});

test('H(3) orchestrator process SIGKILLed mid-transition: journal consistent, recovers', async () => {
  const root = tmpRoot('h3');
  const j = new Journal(path.join(root, 'journal.jsonl'));
  j.transition({ taskId: 'x', sessionId: 'sx', to: 'queued' });
  j.transition({ taskId: 'x', to: 'running' });
  const p = spawnJson('orch-cli.mjs', ['crash-transition', root, 'x']);
  const r = await p.exit;
  console.log('H3 child exit:', JSON.stringify(r), 'lines:', JSON.stringify(p.lines));
  assert.ok(r.signal === 'SIGKILL' || r.code !== 0);
  const warns = []; const j2 = new Journal(j.file, { onWarn: (w) => warns.push(w) });
  assert.equal(j2.states().tasks.get('x').state, 'running'); // half-written 'completed' ignored
  assert.ok(warns.some((w) => /truncated/.test(w)), JSON.stringify(warns));
  j2.transition({ taskId: 'x', to: 'needs_reconcile', reason: 'recovery' });
  assert.equal(new Journal(j.file).states().tasks.get('x').state, 'needs_reconcile');
});
