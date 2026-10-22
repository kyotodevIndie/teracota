import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireLock, evaluateLock, readLock, lockPath, LockBusyError } from '../lib/lock.mjs';
import { getProcStart } from '../lib/proc.mjs';
import { tmpRoot, spawnJson, sleep } from './helpers.mjs';

test('A(a) six concurrent processes, same lock: exactly one wins', async () => {
  const dir = path.join(tmpRoot('lockA'), 'locks');
  fs.mkdirSync(dir, { recursive: true });
  const at = Date.now() + 4000; // barrier: start-time lookup (slow) done before it
  const ws = Array.from({ length: 6 }, () => spawnJson('lock-worker.mjs', [dir, 'sess-1', String(at), '1500']));
  const results = await Promise.all(ws.map((w) => w.waitLine((l) => 'ok' in l, 30000)));
  await Promise.all(ws.map((w) => w.exit));
  console.log('A(a) results:', JSON.stringify(results.map((r) => ({ ok: r.ok, reason: r.reason }))));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.filter((r) => !r.ok).length, 5);
});

test('A(b) holder killed with SIGKILL: next one detects abandoned (pid_dead) and takes over', async () => {
  const dir = path.join(tmpRoot('lockB'), 'locks');
  const w = spawnJson('lock-worker.mjs', [dir, 'sess-b', String(Date.now()), '60000']);
  const held = await w.waitLine((l) => l.ok === true);
  assert.ok(readLock(lockPath(dir, 'sess-b')).lock.pid === held.pid);
  process.kill(held.pid, 'SIGKILL'); await w.exit;
  const h = acquireLock(dir, 'sess-b');
  assert.equal(h.tookOver.reason, 'pid_dead');
  assert.equal(readLock(h.file).lock.pid, process.pid);
  h.release();
});

test('A(c) reused PID (alive pid, different process creation time) is detected', () => {
  const dir = path.join(tmpRoot('lockC'), 'locks'); fs.mkdirSync(dir, { recursive: true });
  const real = getProcStart(process.pid);
  const forged = { sessionId: 's', pid: process.pid, startedAt: '1999-01-01T00:00:00.0000000Z', heartbeat: new Date().toISOString(), hostId: os.hostname(), nonce: 'x' };
  assert.deepEqual(evaluateLock(forged), { abandoned: true, reason: 'pid_reused' });
  fs.writeFileSync(lockPath(dir, 's'), JSON.stringify(forged));
  const h = acquireLock(dir, 's');
  assert.equal(h.tookOver.reason, 'pid_reused');
  assert.notEqual(real, forged.startedAt);
  h.release();
});

test('A(d) active lock with recent heartbeat is refused and never removed', async () => {
  const dir = path.join(tmpRoot('lockD'), 'locks');
  const h = acquireLock(dir, 'sess-d', { heartbeatMs: 100 });
  const before = readLock(h.file).lock.nonce;
  assert.throws(() => acquireLock(dir, 'sess-d'), (e) => e instanceof LockBusyError && e.info.reason === 'active');
  // 4 hostile processes hammer it while heartbeats are being written
  const ws = Array.from({ length: 4 }, () => spawnJson('lock-worker.mjs', [dir, 'sess-d', String(Date.now()), '10']));
  const rs = await Promise.all(ws.map((w) => w.waitLine((l) => 'ok' in l)));
  assert.ok(rs.every((r) => r.ok === false && r.reason === 'active'), JSON.stringify(rs));
  await sleep(350);
  assert.equal(readLock(h.file).lock.nonce, before);
  h.release();
  assert.equal(fs.existsSync(h.file), false);
});

test('heartbeat: rewritten atomically, stale (>30s) lock of a live pid is abandoned', async () => {
  const dir = path.join(tmpRoot('lockH'), 'locks');
  const h = acquireLock(dir, 'sess-h', { heartbeatMs: 50 });
  const hb0 = readLock(h.file).lock.heartbeat;
  await sleep(300);
  const hb1 = readLock(h.file).lock.heartbeat;
  assert.notEqual(hb0, hb1);
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')).length, 0);
  const l = readLock(h.file).lock;
  assert.equal(evaluateLock(l, { now: Date.now() + 29000 }).abandoned, false);
  assert.deepEqual(evaluateLock(l, { now: Date.now() + 31000 }).reason, 'heartbeat_stale');
  h.release();
});

test('lock lost to a takeover is noticed by the old holder at next heartbeat', () => {
  const dir = path.join(tmpRoot('lockL'), 'locks');
  const h = acquireLock(dir, 'sess-l', { heartbeatMs: 100000 });
  fs.unlinkSync(h.file);
  const h2 = acquireLock(dir, 'sess-l');
  assert.equal(h.beat(), false); assert.equal(h.lost, true);
  assert.equal(h.release(), false); // does not delete the new owner's lock
  assert.ok(fs.existsSync(h2.file));
  h2.release();
});

test('regression: failed OS start-time lookup (null) must NOT be read as PID reuse', () => {
  const lock = { pid: process.pid, startedAt: getProcStart(process.pid), heartbeat: new Date().toISOString(), hostId: os.hostname() };
  assert.equal(evaluateLock(lock, { getStart: () => null }).abandoned, false);
  assert.equal(evaluateLock({ ...lock, startedAt: null }).abandoned, false);
});
