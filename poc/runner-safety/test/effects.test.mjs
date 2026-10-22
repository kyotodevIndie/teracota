import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Orchestrator } from '../lib/orchestrator.mjs';
import { tmpRoot, runJson } from './helpers.mjs';

function setup(name) {
  const root = tmpRoot(name);
  const o = new Orchestrator({ root, backoffBaseMs: 5 });
  o.createTask('t1', 's1'); o.transition('t1', 'running', 'test');
  return { root, o, ws: root };
}

test('E: destructive action needs a separately written approval; wrong id refused; once only', () => {
  const { root, o } = setup('e');
  const victim = path.join(root, 'victim.txt'); fs.writeFileSync(victim, 'x');
  const rm = { kind: 'rm', path: victim };
  const key = Orchestrator.effectKey('t1', 'step1', rm);

  let r = o.runEffect('t1', 'step1', rm, { destructive: true });
  assert.equal(r.reason, 'approval_required'); assert.equal(r.actionId, key);
  assert.equal(o.state('t1').state, 'awaiting_approval');
  assert.ok(fs.existsSync(victim));

  // approval of ANOTHER action, via the separate command
  const other = runJson('orch-cli.mjs', ['approve', root, 'deadbeefdeadbeef']);
  assert.equal(other.code, 0);
  r = o.runEffect('t1', 'step1', rm, { destructive: true });
  assert.equal(r.reason, 'approval_required'); assert.ok(fs.existsSync(victim));

  // correct approval
  runJson('orch-cli.mjs', ['approve', root, key]);
  r = o.runEffect('t1', 'step1', rm, { destructive: true });
  assert.equal(r.executed, true); assert.ok(!fs.existsSync(victim));
  assert.equal(o.state('t1').state, 'running'); // awaiting_approval -> running

  // repeat: refused (idempotent) even with approval still on file
  fs.writeFileSync(victim, 'recreated');
  r = o.runEffect('t1', 'step1', rm, { destructive: true });
  assert.equal(r.refused, true); assert.equal(r.reason, 'already_confirmed');
  assert.ok(fs.existsSync(victim));
});

test('E: approval is bound to taskId+step+action (same action in another step is not approved)', () => {
  const { root, o } = setup('e2');
  const push = { kind: 'remote_call', log: path.join(root, 'remote.log'), line: 'git push origin main' };
  runJson('orch-cli.mjs', ['approve', root, Orchestrator.effectKey('t1', 'stepA', push)]);
  assert.equal(o.runEffect('t1', 'stepB', push, { destructive: true }).reason, 'approval_required');
  assert.equal(fs.existsSync(push.log), false);
});

test('F: crash after effect, before confirmation; verifiable effect is NOT duplicated on explicit Continue', () => {
  const { root, o } = setup('f1');
  const target = path.join(root, 'out.txt');
  const act = { kind: 'write_file', path: target, content: 'hello' };
  assert.throws(() => o.runEffect('t1', 's', act, { hooks: { afterExec: () => { throw new Error('CRASH'); } } }), /CRASH/);
  const eff = () => fs.readFileSync(o.effectsFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(eff().map((e) => e.status), ['intent']);
  // new orchestrator (post-crash). Without "Continue": refused, goes to needs_reconcile
  const o2 = new Orchestrator({ root });
  let r = o2.runEffect('t1', 's', act);
  assert.equal(r.refused, true); assert.equal(o2.state('t1').state, 'needs_reconcile'); assert.equal(o2.state('t1').hasUnconfirmedEffects, true);
  // user: Continue (needs_reconcile -> running), verifiable -> confirmed without re-executing
  fs.writeFileSync(target, 'hello'); const m0 = fs.statSync(target).mtimeMs;
  o2.transition('t1', 'running', 'user_resume');
  r = o2.runEffect('t1', 's', act, { continueRequested: true });
  assert.equal(r.executed, false); assert.equal(r.reason, 'verified_already_applied');
  assert.equal(fs.statSync(target).mtimeMs, m0);
  assert.deepEqual(eff().map((e) => e.status), ['intent', 'confirmed']);
  assert.equal(o2.runEffect('t1', 's', act).reason, 'already_confirmed');
});

test('F: verifiable effect that did NOT land before crash is executed once on Continue', () => {
  const { root, o } = setup('f2');
  const target = path.join(root, 'o.txt'); const act = { kind: 'write_file', path: target, content: 'v' };
  assert.throws(() => o.runEffect('t1', 's', act, { hooks: { afterIntent: () => { throw new Error('CRASH'); } } }), /CRASH/);
  assert.ok(!fs.existsSync(target));
  o.transition('t1', 'needs_reconcile', 'crash'); o.transition('t1', 'running', 'user_resume');
  assert.equal(o.runEffect('t1', 's', act, { continueRequested: true }).executed, true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'v');
});

test('F: UNVERIFIABLE effect after crash -> needs_reconcile, never re-executed (even with Continue)', () => {
  const { root, o } = setup('f3');
  const log = path.join(root, 'remote.log'); const act = { kind: 'remote_call', log, line: 'POST /charge' };
  assert.throws(() => o.runEffect('t1', 's', act, { hooks: { afterExec: () => { throw new Error('CRASH'); } } }), /CRASH/);
  o.transition('t1', 'needs_reconcile', 'crash'); o.transition('t1', 'running', 'user_resume');
  const r = o.runEffect('t1', 's', act, { continueRequested: true });
  assert.equal(r.reason, 'unconfirmed_effect_not_verifiable');
  assert.equal(o.state('t1').state, 'needs_reconcile'); assert.equal(o.state('t1').hasUnconfirmedEffects, true);
  assert.equal(fs.readFileSync(log, 'utf8'), 'POST /charge\n'); // exactly one
});

test('F: real SIGKILL of a process between effect and confirmation (separate process)', () => {
  const { root, o } = setup('f4');
  const target = path.join(root, 'k.txt'); const act = JSON.stringify({ kind: 'write_file', path: target, content: 'kk' });
  const c = runJson('orch-cli.mjs', ['effect', root, 't1', 's', act, '--crash-after-exec']);
  assert.ok(c.signal === 'SIGKILL' || c.code !== 0, JSON.stringify(c));
  assert.equal(fs.readFileSync(target, 'utf8'), 'kk');
  const st = fs.readFileSync(o.effectsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l).status);
  assert.deepEqual(st, ['intent']);
});
