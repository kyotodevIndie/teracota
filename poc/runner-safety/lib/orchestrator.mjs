import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Journal, appendLine, readLines } from './journal.mjs';
import { acquireLock, inspectLock, removeLockIfAbandoned, LockBusyError } from './lock.mjs';
import { InvalidTransitionError, RESUMABLE, canTransition } from './states.mjs';

const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fake-runner.mjs');
const TRANSIENT = new Set(['overloaded', 'network_error']);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const stable = (o) => JSON.stringify(o, Object.keys(o).sort());

export { LockBusyError, InvalidTransitionError };

/** Approval written by a SEPARATE command (bin/orch-cli.mjs approve), never by the executor. */
export function writeApproval(root, actionId, by = 'user') {
  appendLine(path.join(root, 'approvals.jsonl'), { actionId, by, at: new Date().toISOString() });
}

export class Orchestrator {
  constructor({ root, hostId = os.hostname(), staleMs = 30000, heartbeatMs = 5000, backoffBaseMs = 1000, maxRetries = 3, log = () => {} }) {
    Object.assign(this, { root, hostId, staleMs, heartbeatMs, backoffBaseMs, maxRetries, log });
    this.journal = new Journal(path.join(root, 'journal.jsonl'), { onWarn: (w) => log(`WARN journal: ${w}`) });
    this.locksDir = path.join(root, 'locks');
    this.effectsFile = path.join(root, 'effects.jsonl');
    this.approvalsFile = path.join(root, 'approvals.jsonl');
    this.transcripts = path.join(root, 'transcripts');
    fs.mkdirSync(this.transcripts, { recursive: true });
    this.handles = new Map(); this.children = new Map(); this.interruptRequested = new Set();
  }

  lockOpts() { return { hostId: this.hostId, staleMs: this.staleMs, heartbeatMs: this.heartbeatMs }; }
  transcriptOf(sessionId) { return path.join(this.transcripts, `${sessionId}.jsonl`); }
  state(taskId) { return this.journal.states().tasks.get(taskId) ?? null; }
  createTask(taskId, sessionId) { return this.journal.transition({ taskId, sessionId, to: 'queued', reason: 'created' }); }
  transition(taskId, to, reason, extra) { return this.journal.transition({ taskId, to, reason, extra }); }

  // ---------- run / lock ----------
  /** Starts (queued) or explicitly resumes (RESUMABLE) a task. Lock first, state check under the lock. */
  start(taskId, { scenario = 'ok', steps, interval, failUntil, userResume = false } = {}) {
    const t = this.state(taskId);
    if (!t) throw new Error(`unknown task ${taskId}`);
    let fromState;
    const handle = acquireLock(this.locksDir, t.sessionId, this.lockOpts()); // throws LockBusyError
    try {
      const cur = this.state(taskId);
      fromState = cur.state;
      if (!canTransition(cur.state, 'running')) throw new InvalidTransitionError(cur.state, 'running');
      if (cur.state !== 'queued' && !userResume) throw new Error(`resume from ${cur.state} requires userResume=true`);
      this.transition(taskId, 'running', cur.state === 'queued' ? 'start' : 'user_resume', { lockPid: process.pid, tookOver: handle.tookOver?.reason });
    } catch (e) { handle.release(); throw e; }
    this.handles.set(taskId, handle);
    const done = this.#runLoop(taskId, t.sessionId, { scenario, steps, interval, failUntil, resume: fromState !== 'queued' });
    return { done, lock: handle };
  }

  async #runLoop(taskId, sessionId, o) {
    let attempt = 0;
    try {
      for (;;) {
        attempt++;
        const out = await this.#spawnRunner(taskId, sessionId, { ...o, attempt });
        const k = this.#classify(taskId, out);
        if (k.retry) {
          if (attempt > this.maxRetries) { this.transition(taskId, 'failed', 'retries_exhausted', { error: k.error, attempts: attempt }); break; }
          const delay = this.backoffBaseMs * 2 ** (attempt - 1);
          this.journal.event(taskId, 'retry', { attempt, error: k.error, delayMs: delay });
          await new Promise((r) => setTimeout(r, delay));
          o = { ...o, resume: true };
          continue;
        }
        if (k.to === 'needs_reconcile') {
          const ev = this.collectEvidence(taskId);
          this.transition(taskId, 'needs_reconcile', k.reason, { evidence: ev, hasUnconfirmedEffects: ev.hasUnconfirmedEffects });
        } else this.transition(taskId, k.to, k.reason, k.error ? { error: k.error } : {});
        break;
      }
    } finally {
      this.handles.get(taskId)?.release(); this.handles.delete(taskId); this.children.delete(taskId); this.interruptRequested.delete(taskId);
    }
    return this.state(taskId);
  }

  #spawnRunner(taskId, sessionId, o) {
    return new Promise((resolve) => {
      const args = [RUNNER, '--transcript', this.transcriptOf(sessionId), '--session', sessionId, '--scenario', o.scenario, '--attempt', String(o.attempt)];
      if (o.resume) args.push('--resume');
      for (const k of ['steps', 'interval', 'failUntil']) if (o[k] != null) args.push(`--${k}`, String(o[k]));
      const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      this.children.set(taskId, child);
      this.journal.event(taskId, 'runner_started', { runnerPid: child.pid, attempt: o.attempt, resume: !!o.resume });
      let buf = ''; child.stdout.on('data', (d) => { buf += d; });
      child.stdin.on('error', () => {});
      child.on('close', (code, signal) => {
        let result = null;
        for (const l of buf.split('\n')) { try { const j = JSON.parse(l); if (j.type === 'result') result = j; } catch {} }
        resolve({ code, signal, result });
      });
    });
  }

  #classify(taskId, { code, signal, result }) {
    if (!result) return { to: 'needs_reconcile', reason: `runner_died(code=${code},signal=${signal})` };
    if (result.subtype === 'success') return { to: 'completed', reason: 'runner_success' };
    if (this.interruptRequested.has(taskId) && result.subtype === 'error_during_execution') return { to: 'interrupted', reason: 'user_interrupt' };
    const e = result.error;
    if (e === 'authentication_failed') return { to: 'auth_error', reason: e, error: e };        // never retried
    if (e === 'session_not_found') return { to: 'session_expired', reason: e, error: e };
    if (e === 'usage_limit_reached') return { to: 'usage_limited', reason: e, error: e };
    if (TRANSIENT.has(e)) return { retry: true, error: e };
    return { to: 'failed', reason: e ?? result.subtype, error: e };
  }

  interrupt(taskId) {
    const c = this.children.get(taskId);
    if (!c) return false;
    this.interruptRequested.add(taskId);
    c.stdin.write('interrupt\n');
    return true;
  }

  runnerPid(taskId) { return this.children.get(taskId)?.pid; }

  // ---------- reconciliation ----------
  collectEvidence(taskId) {
    const t = this.state(taskId);
    const { records } = readLines(this.transcriptOf(t.sessionId));
    const last = records.at(-1) ?? null;
    const effects = this.#effects(taskId);
    const unconfirmed = [...effects.values()].filter((e) => e.status !== 'confirmed')
      .map((e) => ({ key: e.key, step: e.step, kind: e.kind, target: e.target, verifiable: e.verifiable, targetExists: e.target ? fs.existsSync(e.target) : null }));
    return { lastTranscriptEvent: last && { type: last.type, tool_use: last.tool_use, tool_result: last.tool_result, ts: last.ts }, transcriptLines: records.length,
      unconfirmedEffects: unconfirmed, hasUnconfirmedEffects: unconfirmed.length > 0 };
  }

  /** On startup: running/awaiting_approval tasks without an active lock -> needs_reconcile. NEVER re-executes. */
  reconcileOnStartup() {
    const moved = [];
    for (const t of this.journal.states().tasks.values()) {
      if (t.state !== 'running' && t.state !== 'awaiting_approval') continue;
      const ev = inspectLock(this.locksDir, t.sessionId, { staleMs: this.staleMs, hostId: this.hostId });
      if (ev.state === 'active') continue; // someone else alive owns it
      removeLockIfAbandoned(this.locksDir, t.sessionId, { staleMs: this.staleMs, hostId: this.hostId });
      const evidence = this.collectEvidence(t.taskId);
      this.transition(t.taskId, 'needs_reconcile', `orchestrator_crash(lock=${ev.state === 'gone' ? 'missing' : ev.reason})`,
        { evidence, hasUnconfirmedEffects: evidence.hasUnconfirmedEffects, previousState: t.state });
      moved.push(t.taskId);
    }
    return moved;
  }

  // ---------- effects ----------
  #effects(taskId) {
    const m = new Map();
    for (const r of readLines(this.effectsFile).records) if (r.taskId === taskId) m.set(r.key, { ...(m.get(r.key) ?? {}), ...r });
    return m;
  }
  #approved(key) { return readLines(this.approvalsFile).records.some((r) => r.actionId === key); }

  static effectKey(taskId, step, action) { return sha(`${taskId}|${step}|${sha(stable(action))}`).slice(0, 16); }

  /**
   * Runs an effect once. action: {kind:'write_file',path,content} | {kind:'rm',path} | {kind:'remote_call',log,line}.
   * write_file/rm are verifiable (state can be checked); remote_call is not.
   */
  runEffect(taskId, step, action, { destructive = false, continueRequested = false, hooks = {} } = {}) {
    let t = this.state(taskId);
    if (!t || (t.state !== 'running' && t.state !== 'awaiting_approval')) return { executed: false, refused: true, reason: 'task_not_running', state: t?.state };
    const key = Orchestrator.effectKey(taskId, step, action);
    const verifiable = action.kind === 'write_file' || action.kind === 'rm';
    const existing = this.#effects(taskId).get(key);
    if (existing?.status === 'confirmed') return { executed: false, refused: true, reason: 'already_confirmed', actionId: key };

    if (destructive && !this.#approved(key)) {
      if (t.state === 'running') this.transition(taskId, 'awaiting_approval', `approval_required:${key}`);
      return { executed: false, refused: true, reason: 'approval_required', actionId: key };
    }
    if (t.state === 'awaiting_approval') this.transition(taskId, 'running', `approved:${key}`);

    if (existing?.status === 'intent') {
      const stuck = (reason) => {
        this.transition(taskId, 'needs_reconcile', reason, { hasUnconfirmedEffects: true, evidence: this.collectEvidence(taskId) });
        return { executed: false, refused: true, reason, actionId: key, state: 'needs_reconcile' };
      };
      if (!continueRequested) return stuck('unconfirmed_effect_needs_user_continue');
      if (!verifiable) return stuck('unconfirmed_effect_not_verifiable');
      if (this.#verify(action)) { // effect landed before the crash: just confirm
        appendLine(this.effectsFile, { taskId, key, status: 'confirmed', via: 'verified_after_crash', at: new Date().toISOString() });
        return { executed: false, refused: false, reason: 'verified_already_applied', actionId: key };
      }
    } else {
      appendLine(this.effectsFile, { taskId, key, step, status: 'intent', kind: action.kind, target: action.path ?? action.log, verifiable, destructive, at: new Date().toISOString() });
    }
    hooks.afterIntent?.();
    this.#exec(action);
    hooks.afterExec?.();
    appendLine(this.effectsFile, { taskId, key, status: 'confirmed', via: 'executed', at: new Date().toISOString() });
    return { executed: true, refused: false, actionId: key };
  }

  #exec(a) {
    if (a.kind === 'write_file') fs.writeFileSync(a.path, a.content);
    else if (a.kind === 'rm') fs.rmSync(a.path, { force: true });
    else if (a.kind === 'remote_call') fs.appendFileSync(a.log, a.line + '\n');
    else throw new Error(`unknown action ${a.kind}`);
  }
  #verify(a) {
    if (a.kind === 'write_file') { try { return fs.readFileSync(a.path, 'utf8') === a.content; } catch { return false; } }
    if (a.kind === 'rm') return !fs.existsSync(a.path);
    return false;
  }
}

export { RESUMABLE };
