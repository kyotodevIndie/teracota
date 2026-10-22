import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { getProcStart, pidExists, sleepSync } from './proc.mjs';

export class LockBusyError extends Error {
  constructor(info) { super(`lock busy: ${info.reason}`); this.name = 'LockBusyError'; this.info = info; }
}

export function writeAtomic(file, obj) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) {
      if (i < 20 && ['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { sleepSync(5); continue; }
      try { fs.unlinkSync(tmp); } catch {}
      throw e;
    }
  }
}

/** Decides whether a parsed lock is abandoned. Order: dead PID, reused PID, stale heartbeat. */
export function evaluateLock(lock, o = {}) {
  const { now = Date.now(), staleMs = 30000, hostId = os.hostname(), getStart = getProcStart, exists = pidExists } = o;
  if (lock.hostId === hostId) {
    if (!exists(lock.pid)) return { abandoned: true, reason: 'pid_dead' };
    const s = getStart(lock.pid);
    // Only a POSITIVE mismatch counts. If the OS lookup failed (null) we cannot tell: fall through to the heartbeat rule.
    if (s && lock.startedAt && s !== lock.startedAt) return { abandoned: true, reason: 'pid_reused' };
  }
  const age = now - Date.parse(lock.heartbeat);
  if (!(age <= staleMs)) return { abandoned: true, reason: 'heartbeat_stale', ageMs: age };
  return { abandoned: false, reason: 'active' };
}

export function lockPath(dir, sessionId) { return path.join(dir, `${sessionId}.lock`); }

export function readLock(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return { gone: true }; throw e; }
  try { return { lock: JSON.parse(raw), raw }; } catch { return { corrupt: true, raw }; }
}

function evalFile(file, o) {
  const r = readLock(file);
  if (r.gone) return { state: 'gone' };
  if (r.corrupt) {
    let age = 0;
    try { age = (o.now ?? Date.now()) - fs.statSync(file).mtimeMs; } catch { return { state: 'gone' }; }
    return age > (o.staleMs ?? 30000) ? { state: 'abandoned', reason: 'corrupt_old' } : { state: 'active', reason: 'unreadable_recent' };
  }
  const ev = evaluateLock(r.lock, o);
  return { state: ev.abandoned ? 'abandoned' : 'active', reason: ev.reason, lock: r.lock };
}

/** Removes the lock only if it is abandoned; serialised by a takeover guard. Returns the reason if removed, else false. */
function removeIfAbandoned(file, o) {
  const guard = `${file}.takeover`;
  try { fs.closeSync(fs.openSync(guard, 'wx')); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    try { if (Date.now() - fs.statSync(guard).mtimeMs > 10000) fs.unlinkSync(guard); } catch {}
    return false;
  }
  try {
    const ev = evalFile(file, o); // re-evaluate under the guard
    if (ev.state === 'abandoned') { try { fs.unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; } return ev.reason; }
    return false;
  } finally { try { fs.unlinkSync(guard); } catch {} }
}

export function acquireLock(dir, sessionId, o = {}) {
  const { hostId = os.hostname(), heartbeatMs = 5000, staleMs = 30000, getStart = getProcStart } = o;
  fs.mkdirSync(dir, { recursive: true });
  const file = lockPath(dir, sessionId);
  const ctx = { ...o, hostId, staleMs };
  const startedAt = getStart(process.pid);
  const mine = () => ({ sessionId, pid: process.pid, startedAt, heartbeat: new Date().toISOString(), hostId, nonce: crypto.randomUUID(), acquiredAt: new Date().toISOString() });
  let tookOver = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const data = mine();
    let fd;
    try { fd = fs.openSync(file, 'wx'); }
    catch (e) {
      if (e.code !== 'EEXIST' && e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
      const ev = evalFile(file, ctx);
      if (ev.state === 'active') throw new LockBusyError({ reason: ev.reason, holder: ev.lock && { pid: ev.lock.pid, hostId: ev.lock.hostId, heartbeat: ev.lock.heartbeat } });
      if (ev.state === 'abandoned') {
        const r = removeIfAbandoned(file, ctx);
        if (r) tookOver = { reason: r, previous: ev.lock ?? null };
      } else sleepSync(10);
      continue;
    }
    try { fs.writeSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return makeHandle(file, data, { heartbeatMs, tookOver });
  }
  throw new LockBusyError({ reason: 'contention' });
}

function makeHandle(file, data, { heartbeatMs, tookOver }) {
  const h = { file, data, tookOver, lost: false, timer: null };
  h.beat = () => {
    if (h.lost) return false;
    const r = readLock(file);
    if (!r.lock || r.lock.nonce !== data.nonce) { h.lost = true; h.stop(); return false; }
    data.heartbeat = new Date().toISOString();
    writeAtomic(file, data);
    return true;
  };
  h.stop = () => { if (h.timer) clearInterval(h.timer); h.timer = null; };
  h.release = () => {
    h.stop();
    const r = readLock(file);
    if (r.lock && r.lock.nonce === data.nonce) { try { fs.unlinkSync(file); } catch {} return true; }
    return false;
  };
  h.timer = setInterval(() => { try { h.beat(); } catch {} }, heartbeatMs);
  h.timer.unref();
  return h;
}

/** Inspect without taking: used by reconciliation. */
export function inspectLock(dir, sessionId, o = {}) {
  return evalFile(lockPath(dir, sessionId), { hostId: os.hostname(), ...o });
}

export function removeLockIfAbandoned(dir, sessionId, o = {}) {
  return removeIfAbandoned(lockPath(dir, sessionId), { hostId: os.hostname(), ...o });
}
