// PocketStore: único escritor do SQLite. Toda mutação passa por uma transação IMMEDIATE que
// primeiro confere o fence (token monotônico) — um store "velho" nunca grava depois que outro
// assumiu o banco. As invariantes de estado também são protegidas por triggers (schema.ts).
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  Actor, ErrorCode, JournalEntry, RunnerEvent, RunRow, SessionRow, SessionState, TaskRow, TaskState,
} from '../../../shared/pocket';
import { openDatabase, type OpenOptions } from './db';
import { allowedActors, canSessionTransition, InvalidTransitionError } from './states';

export class FencedOutError extends Error {
  readonly code = 'LOCK_LOST' as const;
  constructor() { super('este store perdeu o fence: outro escritor assumiu o banco'); this.name = 'FencedOutError'; }
}
export class GestureError extends Error {
  constructor(readonly reason: 'missing' | 'unknown' | 'expired' | 'consumed' | 'mismatch', detail = '') {
    super(`gesto do usuário inválido (${reason})${detail ? `: ${detail}` : ''}`);
    this.name = 'GestureError';
  }
}
// `bad_hmac`/`run_mismatch` são lançados por security/approvals.ts (o store só persiste o hmac).
export class ApprovalError extends Error {
  constructor(readonly reason: 'unknown' | 'expired' | 'already_decided' | 'not_allowed' | 'already_consumed' | 'run_mismatch' | 'bad_hmac', detail = '') {
    super(`aprovação inválida (${reason})${detail ? `: ${detail}` : ''}`);
    this.name = 'ApprovalError';
  }
}
export class NotFoundError extends Error {
  constructor(what: string, id: string) { super(`${what} não encontrado: ${id}`); this.name = 'NotFoundError'; }
}

export type GestureKind = 'create_task' | 'task_action' | 'approval' | 'effect_resolution';

type Row = Record<string, unknown>;
const bit = (b: boolean): number => (b ? 1 : 0);
const MAX_PAYLOAD = 4096;
const MAX_STR = 400;

const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g, /sk-[A-Za-z0-9]{20,}/g, /gh[pousr]_[A-Za-z0-9]{20,}/g, /github_pat_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g, /xox[baprs]-[A-Za-z0-9-]{10,}/g, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /(authorization|bearer)\s*[:=]?\s*\S{8,}/gi, /(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi,
  /--(password|token|api-key|secret)[= ]\S+/gi,
];
/** Remove padrões comuns de segredo antes de gravar no journal (que é append-only). */
export function redact(s: string): string {
  let out = s;
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDIGIDO]');
  return out;
}

/** Defesa em profundidade: nada grande (prompt, conteúdo de arquivo) nem segredo conhecido entra no journal. */
export function sanitizePayload(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') { const r = redact(v); return r.length > MAX_STR ? `${r.slice(0, MAX_STR)}…[+${r.length - MAX_STR}]` : r; }
  if (v === null || typeof v !== 'object') return v;
  if (depth > 4) return '[profundo]';
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => sanitizePayload(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = sanitizePayload(x, depth + 1);
  return out;
}
function encodePayload(v: unknown): string | null {
  if (v === undefined) return null;
  const s = JSON.stringify(sanitizePayload(v));
  return s.length > MAX_PAYLOAD ? JSON.stringify({ truncated: true, bytes: s.length }) : s;
}

function mapTask(r: Row): TaskRow {
  return {
    id: r.id as string, title: r.title as string, prompt: r.prompt as string, cwd: r.cwd as string,
    state: r.state as TaskState, currentSessionId: (r.current_session_id as string | null) ?? null,
    interruptRequested: r.interrupt_requested === 1, cancelRequested: r.cancel_requested === 1,
    pauseRequested: r.pause_requested === 1, retryCount: r.retry_count as number,
    lastErrorCode: (r.last_error_code as ErrorCode | null) ?? null,
    createdAt: r.created_at as number, updatedAt: r.updated_at as number,
  };
}
function mapSession(r: Row): SessionRow {
  return {
    id: r.id as string, taskId: r.task_id as string, generation: r.generation as number,
    state: r.state as SessionState, externalActivity: r.external_activity === 1,
    createdAt: r.created_at as number, updatedAt: r.updated_at as number,
  };
}
function mapRun(r: Row): RunRow {
  return {
    id: r.id as string, taskId: r.task_id as string, sessionId: r.session_id as string,
    kind: r.kind as 'start' | 'resume', gestureId: (r.gesture_id as string | null) ?? null,
    attempt: r.attempt as number, runnerPid: (r.runner_pid as number | null) ?? null,
    runnerStartTime: (r.runner_start_time as string | null) ?? null, startedAt: r.started_at as number,
    endedAt: (r.ended_at as number | null) ?? null, outcome: (r.outcome as string | null) ?? null,
  };
}
function mapJournal(r: Row): JournalEntry {
  return {
    seq: r.seq as number, ts: r.ts as number, taskId: (r.task_id as string | null) ?? null,
    runId: (r.run_id as string | null) ?? null, runSeq: (r.run_seq as number | null) ?? null,
    kind: r.kind as JournalEntry['kind'], fromState: (r.from_state as string | null) ?? null,
    toState: (r.to_state as string | null) ?? null, reason: (r.reason as string | null) ?? null,
    actor: (r.actor as Actor | null) ?? null, gestureId: (r.gesture_id as string | null) ?? null,
    payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : null,
  };
}

export interface ApprovalRow {
  approvalRequestId: string; approvalId: string | null; taskId: string; sessionId: string; runId: string;
  toolUseId: string | null; toolName: string; actionKey: string; classification: string; summaryShown: string;
  requestedAt: number; expiresAt: number; decision: 'allow' | 'deny' | null; actor: 'user' | 'system' | null;
  gestureId: string | null; decidedAt: number | null; consumedAt: number | null; hmac: string | null; decidedFence: number | null;
}
function mapApproval(r: Row): ApprovalRow {
  return {
    approvalRequestId: r.approval_request_id as string, approvalId: (r.approval_id as string | null) ?? null,
    taskId: r.task_id as string, sessionId: r.session_id as string, runId: r.run_id as string,
    toolUseId: (r.tool_use_id as string | null) ?? null, toolName: r.tool_name as string,
    actionKey: r.action_key as string, classification: r.classification as string,
    summaryShown: r.summary_shown as string, requestedAt: r.requested_at as number,
    expiresAt: r.expires_at as number, decision: (r.decision as 'allow' | 'deny' | null) ?? null,
    actor: (r.actor as 'user' | 'system' | null) ?? null, gestureId: (r.gesture_id as string | null) ?? null,
    decidedAt: (r.decided_at as number | null) ?? null, consumedAt: (r.consumed_at as number | null) ?? null,
    hmac: (r.hmac as string | null) ?? null, decidedFence: (r.decided_fence as number | null) ?? null,
  };
}

export type EffectStatus = 'intent' | 'confirmed' | 'denied' | 'unconfirmed' | 'user_applied' | 'user_not_applied' | 'user_unknown';
export interface EffectRow {
  id: string; taskId: string; sessionId: string; runId: string; toolUseId: string | null; toolName: string;
  actionKey: string; classification: string; summary: string; targetPath: string | null;
  expectedHash: string | null; verifiable: boolean; status: EffectStatus; intentAt: number;
  confirmedAt: number | null; resolvedAt: number | null;
}
function mapEffect(r: Row): EffectRow {
  return {
    id: r.id as string, taskId: r.task_id as string, sessionId: r.session_id as string, runId: r.run_id as string,
    toolUseId: (r.tool_use_id as string | null) ?? null, toolName: r.tool_name as string,
    actionKey: r.action_key as string, classification: r.classification as string, summary: r.summary as string,
    targetPath: (r.target_path as string | null) ?? null, expectedHash: (r.expected_hash as string | null) ?? null,
    verifiable: r.verifiable === 1, status: r.status as EffectStatus, intentAt: r.intent_at as number,
    confirmedAt: (r.confirmed_at as number | null) ?? null, resolvedAt: (r.resolved_at as number | null) ?? null,
  };
}

export interface TransitionOpts {
  actor: Actor;
  reason: string;
  gestureId?: string | null;
  runId?: string | null;
  evidence?: unknown;
  /** uso interno: o gesto já foi consumido na mesma transação (aprovação composta). */
  gestureAlreadyConsumed?: boolean;
}

export interface StoreOptions extends OpenOptions {
  pid?: number;
  ownerToken?: string;
}

function translate(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('INVALID_TRANSITION')) throw new InvalidTransitionError(null, '?', 'bloqueado pelo banco');
  if (msg.includes('GESTURE_REQUIRED')) throw new GestureError('missing', 'banco recusou →running sem gesto');
  throw e;
}

export class PocketStore {
  readonly db: DatabaseSync;
  readonly fence: number;
  readonly now: () => number;
  private inTx = false;
  private spN = 0;

  private constructor(db: DatabaseSync, fence: number, now: () => number) {
    this.db = db; this.fence = fence; this.now = now;
  }

  static open(dbPath: string, opts: StoreOptions = {}): PocketStore {
    const now = opts.now ?? Date.now;
    const db = openDatabase(dbPath, opts);
    try {
      db.exec('BEGIN IMMEDIATE');
      db.prepare('UPDATE core_owner SET fence = fence + 1, owner_pid = ?, owner_token = ?, acquired_at = ? WHERE id = 1')
        .run(opts.pid ?? process.pid, opts.ownerToken ?? randomUUID(), now());
      const fence = (db.prepare('SELECT fence FROM core_owner WHERE id = 1').get() as { fence: number }).fence;
      db.exec('COMMIT');
      return new PocketStore(db, fence, now);
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* sem tx */ }
      try { db.close(); } catch { /* já fechado */ }
      throw e;
    }
  }

  close(): void {
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ocupado ou fenceado: o autocheckpoint resolve */ }
    try { this.db.close(); } catch { /* já fechado */ }
  }

  /** Executa `fn` numa transação IMMEDIATE protegida por fence. */
  tx<T>(fn: () => T): T {
    if (this.inTx) {
      // aninhado: SAVEPOINT — erro engolido pelo chamador não deixa estado parcial
      const sp = `sp_${this.spN++}`;
      this.db.exec(`SAVEPOINT ${sp}`);
      try {
        const out = fn();
        if (out instanceof Promise) throw new Error('tx() não aceita funções assíncronas');
        this.db.exec(`RELEASE ${sp}`);
        return out;
      } catch (e) {
        this.db.exec(`ROLLBACK TO ${sp}`);
        this.db.exec(`RELEASE ${sp}`);
        throw e;
      }
    }
    this.db.exec('BEGIN IMMEDIATE');
    this.inTx = true;
    try {
      const cur = (this.db.prepare('SELECT fence FROM core_owner WHERE id = 1').get() as { fence: number }).fence;
      if (cur !== this.fence) throw new FencedOutError();
      const out = fn();
      if (out instanceof Promise) throw new Error('tx() não aceita funções assíncronas');
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch { /* sem tx */ }
      return translate(e);
    } finally {
      this.inTx = false;
    }
  }

  /** O fence ainda é o meu? (leitura; usado antes de efeitos — contrato §4). */
  fenceIsCurrent(): boolean {
    const cur = (this.db.prepare('SELECT fence FROM core_owner WHERE id = 1').get() as { fence: number }).fence;
    return cur === this.fence;
  }

  // ── gestos do usuário ────────────────────────────────────────────────────

  /** Só o caminho de comando da UI chama isto (o orquestrador recebe `GestureConsumer`, não o issuer). */
  issueGesture(kind: GestureKind, taskId: string | null, purpose: string | null = null, ttlMs = 60_000): string {
    return this.tx(() => {
      const id = `g_${randomUUID()}`;
      const t = this.now();
      this.db.prepare('INSERT INTO gestures(id, kind, task_id, purpose, issued_at, expires_at) VALUES (?,?,?,?,?,?)')
        .run(id, kind, taskId, purpose, t, t + ttlMs);
      return id;
    });
  }

  private consumeGestureTx(id: string | null | undefined, expectTask: string | null, purpose: string, kind: GestureKind, purposeExpected?: string): void {
    if (!id) throw new GestureError('missing');
    const g = this.db.prepare('SELECT * FROM gestures WHERE id = ?').get(id) as Row | undefined;
    if (!g) throw new GestureError('unknown');
    if (g.consumed_at !== null) throw new GestureError('consumed');
    if (g.kind !== kind) throw new GestureError('mismatch', `gesto ${String(g.kind)} não vale para ${kind}`);
    if ((g.expires_at as number) < this.now()) throw new GestureError('expired');
    if (g.purpose !== null && g.purpose !== (purposeExpected ?? null)) throw new GestureError('mismatch', `propósito ${String(g.purpose)}`);
    if (kind !== 'create_task' && g.task_id !== expectTask) throw new GestureError('mismatch', 'outra tarefa');
    this.db.prepare('UPDATE gestures SET consumed_at = ?, consumed_for = ? WHERE id = ?').run(this.now(), purpose, id);
  }

  /** Para idempotência: a que execução este gesto já serviu? */
  gestureConsumedFor(id: string): string | null {
    const g = this.db.prepare('SELECT consumed_for FROM gestures WHERE id = ?').get(id) as Row | undefined;
    return (g?.consumed_for as string | null | undefined) ?? null;
  }

  /** Consome um gesto sem transição associada (interromper/cancelar com transição feita pelo sistema). */
  useGesture(id: string, taskId: string, kind: GestureKind, purpose: string): void {
    this.tx(() => { this.consumeGestureTx(id, taskId, purpose, kind, purpose); });
  }

  /** Valida um gesto SEM consumi-lo (para gravar um pedido só depois de saber que o gesto vale). */
  checkGesture(id: string, taskId: string, kind: GestureKind, purpose: string): void {
    const g = this.db.prepare('SELECT * FROM gestures WHERE id = ?').get(id) as Row | undefined;
    if (!g) throw new GestureError('unknown');
    if (g.consumed_at !== null) throw new GestureError('consumed');
    if (g.expires_at as number < this.now()) throw new GestureError('expired');
    if (g.kind !== kind || g.task_id !== taskId || (g.purpose !== null && g.purpose !== purpose)) throw new GestureError('mismatch');
  }

  /** Reconhecimento explícito da reconciliação (contrato §3): evidência revista e decisões por efeito tomadas. */
  acknowledgeReconcile(taskId: string, gestureId: string): void {
    this.tx(() => {
      const task = this.mustTask(taskId);
      if (task.state !== 'needs_reconcile') throw new InvalidTransitionError(task.state, 'reconcile_ack', 'a tarefa não está em needs_reconcile');
      if (this.effectsOf(taskId, ['unconfirmed']).length > 0) throw new InvalidTransitionError(task.state, 'reconcile_ack', 'ainda há efeitos sem decisão do usuário');
      this.consumeGestureTx(gestureId, taskId, 'reconcile_ack', 'task_action', 'reconcile_ack');
      this.journal({ taskId, kind: 'note', reason: 'reconcile_ack', actor: 'user', gestureId });
    });
  }
  /** Há reconhecimento posterior à última entrada em needs_reconcile? */
  hasReconcileAck(taskId: string): boolean {
    const last = (kind: string, extra: string) => (this.db.prepare(
      `SELECT COALESCE(MAX(seq),0) AS s FROM journal WHERE task_id = ? AND kind = ? ${extra}`,
    ).get(taskId, kind) as { s: number }).s;
    const enter = last('transition', "AND to_state = 'needs_reconcile'");
    const ack = last('note', "AND reason = 'reconcile_ack'");
    return ack > enter;
  }
  /** Execução ainda aberta da tarefa (no máximo uma). */
  openRunOf(taskId: string): RunRow | null {
    const r = this.db.prepare('SELECT * FROM runs WHERE task_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get(taskId) as Row | undefined;
    return r ? mapRun(r) : null;
  }

  // ── tarefas ──────────────────────────────────────────────────────────────

  createTask(i: { title: string; prompt: string; cwd: string; gestureId: string }): TaskRow {
    return this.tx(() => {
      this.consumeGestureTx(i.gestureId, null, 'create_task', 'create_task', 'create_task');
      const id = `task_${randomUUID()}`;
      const t = this.now();
      this.db.prepare(`INSERT INTO tasks(id, title, prompt, cwd, state, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`)
        .run(id, i.title, i.prompt, i.cwd, 'queued', t, t);
      this.journal({ taskId: id, kind: 'transition', fromState: null, toState: 'queued', reason: 'created', actor: 'user', gestureId: i.gestureId });
      return this.mustTask(id);
    });
  }

  getTask(id: string): TaskRow | null {
    const r = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined;
    return r ? mapTask(r) : null;
  }
  mustTask(id: string): TaskRow {
    const t = this.getTask(id);
    if (!t) throw new NotFoundError('tarefa', id);
    return t;
  }
  listTasks(states?: readonly TaskState[]): TaskRow[] {
    const rows = states?.length
      ? this.db.prepare(`SELECT * FROM tasks WHERE state IN (${states.map(() => '?').join(',')}) ORDER BY created_at, id`).all(...states)
      : this.db.prepare('SELECT * FROM tasks ORDER BY created_at, id').all();
    return (rows as Row[]).map(mapTask);
  }

  transition(taskId: string, to: TaskState, o: TransitionOpts): TaskRow {
    return this.tx(() => {
      const task = this.mustTask(taskId);
      const actors = allowedActors(task.state, to);
      if (!actors) throw new InvalidTransitionError(task.state, to);
      if (!actors.includes(o.actor)) throw new InvalidTransitionError(task.state, to, `ator ${o.actor} não permitido`);
      if ((task.state === 'running' || task.state === 'awaiting_approval') && to === 'cancelled' && (o.evidence as { cleanExit?: boolean } | undefined)?.cleanExit !== true) {
        throw new InvalidTransitionError(task.state, to, `${task.state}→cancelled exige saída limpa do runner`);
      }
      if (o.actor === 'user' && !o.gestureAlreadyConsumed) this.consumeGestureTx(o.gestureId, taskId, `${task.state}->${to}`, 'task_action', `to:${to}`);
      const t = this.now();
      const resetFlags = to === 'running';
      // journal primeiro: o trigger da tabela tasks exige a transição já registrada
      this.journal({
        taskId, runId: o.runId ?? null, kind: 'transition', fromState: task.state, toState: to,
        reason: o.reason, actor: o.actor, gestureId: o.actor === 'user' ? (o.gestureId ?? null) : null, payload: o.evidence,
      });
      this.db.prepare(
        `UPDATE tasks SET state = ?, updated_at = ?${resetFlags ? ', interrupt_requested = 0, cancel_requested = 0, pause_requested = 0' : ''} WHERE id = ?`,
      ).run(to, t, taskId);
      return this.mustTask(taskId);
    });
  }

  setFlag(taskId: string, flag: 'interrupt_requested' | 'cancel_requested' | 'pause_requested', value: boolean, runId: string | null = null): void {
    this.tx(() => {
      this.db.prepare(`UPDATE tasks SET ${flag} = ?, updated_at = ? WHERE id = ?`).run(bit(value), this.now(), taskId);
      this.journal({ taskId, runId, kind: 'note', reason: flag, payload: { value } });
    });
  }

  setRetryCount(taskId: string, n: number, errorCode: ErrorCode | null): void {
    this.tx(() => {
      this.db.prepare('UPDATE tasks SET retry_count = ?, last_error_code = ?, updated_at = ? WHERE id = ?')
        .run(n, errorCode, this.now(), taskId);
      this.journal({ taskId, kind: 'note', reason: 'retry_count', payload: { n, errorCode } });
    });
  }

  // ── sessões ──────────────────────────────────────────────────────────────

  reserveSession(taskId: string): SessionRow {
    return this.tx(() => {
      this.mustTask(taskId);
      const gen = (this.db.prepare('SELECT COALESCE(MAX(generation),0)+1 AS g FROM sessions WHERE task_id = ?').get(taskId) as { g: number }).g;
      const id = randomUUID();
      const t = this.now();
      this.db.prepare('INSERT INTO sessions(id, task_id, generation, state, created_at, updated_at) VALUES (?,?,?,?,?,?)')
        .run(id, taskId, gen, 'reserved', t, t);
      this.db.prepare('UPDATE tasks SET current_session_id = ?, updated_at = ? WHERE id = ?').run(id, t, taskId);
      this.journal({ taskId, kind: 'note', reason: 'session_reserved', payload: { sessionId: id, generation: gen } });
      return this.mustSession(id);
    });
  }
  getSession(id: string): SessionRow | null {
    const r = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Row | undefined;
    return r ? mapSession(r) : null;
  }
  mustSession(id: string): SessionRow {
    const s = this.getSession(id);
    if (!s) throw new NotFoundError('sessão', id);
    return s;
  }
  setSessionState(sessionId: string, to: SessionState, reason: string): SessionRow {
    return this.tx(() => {
      const s = this.mustSession(sessionId);
      if (s.state === to) return s;
      if (!canSessionTransition(s.state, to)) throw new InvalidTransitionError(`sessão:${s.state}`, to);
      this.db.prepare('UPDATE sessions SET state = ?, updated_at = ? WHERE id = ?').run(to, this.now(), sessionId);
      this.journal({ taskId: s.taskId, kind: 'note', reason: `session_${to}`, payload: { sessionId, from: s.state, why: reason } });
      return this.mustSession(sessionId);
    });
  }
  setExternalActivity(sessionId: string, v: boolean): void {
    this.tx(() => {
      this.db.prepare('UPDATE sessions SET external_activity = ?, updated_at = ? WHERE id = ?').run(bit(v), this.now(), sessionId);
    });
  }
  sessionsOf(taskId: string): SessionRow[] {
    return (this.db.prepare('SELECT * FROM sessions WHERE task_id = ? ORDER BY generation').all(taskId) as Row[]).map(mapSession);
  }

  // ── execuções (runs) e processos ─────────────────────────────────────────

  beginRun(i: { taskId: string; sessionId: string; kind: 'start' | 'resume'; gestureId?: string | null; attempt?: number }): RunRow {
    return this.tx(() => {
      const sess = this.mustSession(i.sessionId);
      if (sess.taskId !== i.taskId) throw new InvalidTransitionError(`sessão:${sess.state}`, 'run', 'sessão de outra tarefa');
      if (sess.state !== 'reserved' && sess.state !== 'idle') throw new InvalidTransitionError(`sessão:${sess.state}`, 'run', 'sessão não retomável');
      const task = this.mustTask(i.taskId);
      if (task.state !== 'running') throw new InvalidTransitionError(task.state, 'run', 'a tarefa precisa estar running');
      const id = `run_${randomUUID()}`;
      this.db.prepare(`INSERT INTO runs(id, task_id, session_id, kind, gesture_id, attempt, fence, started_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, i.taskId, i.sessionId, i.kind, i.gestureId ?? null, i.attempt ?? 1, this.fence, this.now());
      this.journal({ taskId: i.taskId, runId: id, kind: 'note', reason: 'run_started', payload: { kind: i.kind, sessionId: i.sessionId, attempt: i.attempt ?? 1 } });
      return this.mustRun(id);
    });
  }
  endRun(runId: string, outcome: string): void {
    this.tx(() => {
      const r = this.mustRun(runId);
      if (r.endedAt !== null) return;
      this.db.prepare('UPDATE runs SET ended_at = ?, outcome = ? WHERE id = ?').run(this.now(), outcome, runId);
      this.journal({ taskId: r.taskId, runId, kind: 'note', reason: 'run_ended', payload: { outcome } });
    });
  }
  setRunnerProcess(runId: string, pid: number, startTime: string | null): void {
    this.tx(() => {
      this.db.prepare('UPDATE runs SET runner_pid = ?, runner_start_time = ? WHERE id = ?').run(pid, startTime, runId);
    });
  }
  getRun(id: string): RunRow | null {
    const r = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Row | undefined;
    return r ? mapRun(r) : null;
  }
  mustRun(id: string): RunRow {
    const r = this.getRun(id);
    if (!r) throw new NotFoundError('execução', id);
    return r;
  }
  runsOf(taskId: string): RunRow[] {
    return (this.db.prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY started_at, id').all(taskId) as Row[]).map(mapRun);
  }
  /** Runs sem `ended_at` (candidatos a reconciliação). */
  openRuns(): RunRow[] {
    return (this.db.prepare('SELECT * FROM runs WHERE ended_at IS NULL ORDER BY started_at').all() as Row[]).map(mapRun);
  }

  recordProcess(i: { runId: string | null; pid: number; startTime: string | null; role: string }): number {
    return this.tx(() => {
      const r = this.db.prepare('INSERT INTO processes(run_id, pid, start_time, role, spawned_at) VALUES (?,?,?,?,?)')
        .run(i.runId, i.pid, i.startTime, i.role, this.now());
      return Number(r.lastInsertRowid);
    });
  }
  updateProcessStartTime(id: number, startTime: string | null): void {
    this.tx(() => { this.db.prepare('UPDATE processes SET start_time = ? WHERE id = ?').run(startTime, id); });
  }
  endProcess(id: number, reason: string): void {
    this.tx(() => {
      this.db.prepare('UPDATE processes SET ended_at = ?, end_reason = ? WHERE id = ? AND ended_at IS NULL').run(this.now(), reason, id);
    });
  }
  liveProcesses(): { id: number; runId: string | null; pid: number; startTime: string | null; role: string; spawnedAt: number }[] {
    return (this.db.prepare('SELECT * FROM processes WHERE ended_at IS NULL ORDER BY id').all() as Row[]).map((r) => ({
      id: r.id as number, runId: (r.run_id as string | null) ?? null, pid: r.pid as number,
      startTime: (r.start_time as string | null) ?? null, role: r.role as string, spawnedAt: r.spawned_at as number,
    }));
  }

  // ── journal / eventos ────────────────────────────────────────────────────

  private journal(e: {
    taskId?: string | null; runId?: string | null; runSeq?: number | null; kind: JournalEntry['kind'];
    fromState?: string | null; toState?: string | null; reason?: string | null; actor?: Actor | null;
    gestureId?: string | null; payload?: unknown;
  }): number {
    const r = this.db.prepare(
      `INSERT INTO journal(ts, task_id, run_id, run_seq, kind, from_state, to_state, reason, actor, gesture_id, payload)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(this.now(), e.taskId ?? null, e.runId ?? null, e.runSeq ?? null, e.kind, e.fromState ?? null,
      e.toState ?? null, e.reason ?? null, e.actor ?? null, e.gestureId ?? null, encodePayload(e.payload));
    return Number(r.lastInsertRowid);
  }

  note(taskId: string | null, reason: string, payload?: unknown, runId: string | null = null): void {
    this.tx(() => { this.journal({ taskId, runId, kind: 'note', reason, payload }); });
  }

  /** Grava um evento normalizado; `seq` é por runId e atribuído aqui (escritor único). */
  appendEvent<T extends RunnerEvent['type']>(
    runId: string, type: T, payload: Extract<RunnerEvent, { type: T }>['payload'],
  ): Extract<RunnerEvent, { type: T }> {
    return this.tx(() => {
      const run = this.mustRun(runId);
      if (run.endedAt !== null) throw new NotFoundError('execução ativa', runId);
      const seq = (this.db.prepare('SELECT COALESCE(MAX(run_seq),0)+1 AS s FROM journal WHERE run_id = ? AND run_seq IS NOT NULL').get(runId) as { s: number }).s;
      const eventId = `ev_${randomUUID()}`;
      const ts = this.now();
      let clean = sanitizePayload(payload);
      if (JSON.stringify(clean).length > MAX_PAYLOAD - 200) clean = { truncated: true };
      this.journal({ taskId: run.taskId, runId, runSeq: seq, kind: 'event', reason: type, payload: { eventId, sessionId: run.sessionId, payload: clean } });
      return { v: 1, eventId, seq, taskId: run.taskId, sessionId: run.sessionId, runId, ts, type, payload: clean } as unknown as Extract<RunnerEvent, { type: T }>;
    });
  }

  journalSince(seq = 0, taskId?: string): JournalEntry[] {
    const rows = taskId
      ? this.db.prepare('SELECT * FROM journal WHERE seq > ? AND task_id = ? ORDER BY seq').all(seq, taskId)
      : this.db.prepare('SELECT * FROM journal WHERE seq > ? ORDER BY seq').all(seq);
    return (rows as Row[]).map(mapJournal);
  }

  // ── aprovações ───────────────────────────────────────────────────────────

  createApprovalRequest(i: {
    approvalRequestId: string; taskId: string; sessionId: string; runId: string; toolUseId?: string | null;
    toolName: string; actionKey: string; classification: string; summary: string; expiresAt: number;
  }): ApprovalRow {
    return this.tx(() => {
      const run = this.mustRun(i.runId);
      i = { ...i, taskId: run.taskId, sessionId: run.sessionId };
      this.db.prepare(`INSERT INTO approvals(approval_request_id, task_id, session_id, run_id, tool_use_id, tool_name, action_key,
        classification, summary_shown, requested_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(i.approvalRequestId, i.taskId, i.sessionId, i.runId, i.toolUseId ?? null, i.toolName, i.actionKey,
          i.classification, i.summary.slice(0, 300), this.now(), i.expiresAt);
      this.journal({ taskId: i.taskId, runId: i.runId, kind: 'approval', reason: 'requested', payload: { approvalRequestId: i.approvalRequestId, toolName: i.toolName, classification: i.classification } });
      return this.mustApproval(i.approvalRequestId);
    });
  }
  getApproval(id: string): ApprovalRow | null {
    const r = this.db.prepare('SELECT * FROM approvals WHERE approval_request_id = ?').get(id) as Row | undefined;
    return r ? mapApproval(r) : null;
  }
  mustApproval(id: string): ApprovalRow {
    const a = this.getApproval(id);
    if (!a) throw new ApprovalError('unknown', id);
    return a;
  }
  pendingApprovals(taskId?: string): ApprovalRow[] {
    const base = 'SELECT * FROM approvals WHERE decision IS NULL';
    const rows = taskId ? this.db.prepare(`${base} AND task_id = ? ORDER BY requested_at`).all(taskId) : this.db.prepare(`${base} ORDER BY requested_at`).all();
    return (rows as Row[]).map(mapApproval);
  }
  /**
   * Registra a decisão. `allow` por usuário exige gesto (consumido aqui); expiração e uso único
   * são impostos no banco/aqui. `hmac` calculado por security/approvals.ts.
   */
  decideApproval(approvalRequestId: string, d: { decision: 'allow' | 'deny'; actor: 'user' | 'system'; gestureId?: string | null; hmac: string; resumeTask?: boolean }): ApprovalRow {
    return this.tx(() => {
      const a = this.mustApproval(approvalRequestId);
      if (a.decision !== null) throw new ApprovalError('already_decided');
      const t = this.now();
      if (d.decision === 'allow' && d.actor !== 'user') throw new ApprovalError('not_allowed', 'allow exige o usuário');
      if (d.decision === 'allow' && a.expiresAt <= t) throw new ApprovalError('expired');
      if (this.mustRun(a.runId).endedAt !== null) throw new ApprovalError('run_mismatch', 'execução encerrada');
      if (d.actor === 'user') this.consumeGestureTx(d.gestureId, a.taskId, `approval:${approvalRequestId}`, 'approval', `approval:${approvalRequestId}`);
      this.db.prepare(`UPDATE approvals SET decision = ?, actor = ?, gesture_id = ?, decided_at = ?, approval_id = ?, hmac = ?, decided_fence = ? WHERE approval_request_id = ?`)
        .run(d.decision, d.actor, d.actor === 'user' ? (d.gestureId ?? null) : null, t, `appr_${randomUUID()}`, d.hmac, this.fence, approvalRequestId);
      this.journal({ taskId: a.taskId, runId: a.runId, kind: 'approval', reason: d.decision, actor: d.actor === 'user' ? 'user' : 'system', gestureId: d.gestureId ?? null, payload: { approvalRequestId } });
      const othersPending = (this.db.prepare('SELECT COUNT(*) AS n FROM approvals WHERE run_id = ? AND decision IS NULL').get(a.runId) as { n: number }).n;
      if (d.resumeTask && d.actor === 'user' && othersPending === 0) { // só volta a running quando não resta pedido do mesmo run
        // um clique = um gesto: decide e devolve a tarefa a running na mesma transação
        this.transition(a.taskId, 'running', { actor: 'user', reason: `approval_${d.decision}`, gestureId: d.gestureId, runId: a.runId, gestureAlreadyConsumed: true });
      }
      return this.mustApproval(approvalRequestId);
    });
  }
  /** Consumo único de uma aprovação `allow` vigente (antes de responder ao runner). */
  consumeApproval(approvalRequestId: string): ApprovalRow {
    return this.tx(() => {
      const a = this.mustApproval(approvalRequestId);
      if (a.decision !== 'allow') throw new ApprovalError('not_allowed');
      if (a.consumedAt !== null) throw new ApprovalError('already_consumed');
      if (a.expiresAt <= this.now()) throw new ApprovalError('expired');
      const run = this.mustRun(a.runId);
      if (run.endedAt !== null) throw new ApprovalError('run_mismatch', 'execução encerrada');
      if (a.decidedFence !== this.fence) throw new ApprovalError('run_mismatch', 'decidida por outra instância do core');
      this.db.prepare('UPDATE approvals SET consumed_at = ? WHERE approval_request_id = ?').run(this.now(), approvalRequestId);
      this.journal({ taskId: a.taskId, runId: a.runId, kind: 'approval', reason: 'consumed', payload: { approvalRequestId } });
      return this.mustApproval(approvalRequestId);
    });
  }

  // ── ledger de efeitos ────────────────────────────────────────────────────

  recordIntent(i: {
    taskId: string; sessionId: string; runId: string; toolUseId?: string | null; toolName: string; actionKey: string;
    classification: string; summary: string; targetPath?: string | null; expectedHash?: string | null; verifiable: boolean;
  }): EffectRow {
    return this.tx(() => {
      const run = this.mustRun(i.runId);
      i = { ...i, taskId: run.taskId, sessionId: run.sessionId };
      const id = `eff_${randomUUID()}`;
      this.db.prepare(`INSERT INTO effects(id, task_id, session_id, run_id, tool_use_id, tool_name, action_key, classification, summary,
        target_path, expected_hash, verifiable, status, intent_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, i.taskId, i.sessionId, i.runId, i.toolUseId ?? null, i.toolName, i.actionKey, i.classification,
          i.summary.slice(0, 300), i.targetPath ?? null, i.expectedHash ?? null, bit(i.verifiable), 'intent', this.now());
      this.journal({ taskId: i.taskId, runId: i.runId, kind: 'effect', reason: 'intent', payload: { effectId: id, toolName: i.toolName, actionKey: i.actionKey } });
      return this.mustEffect(id);
    });
  }
  getEffect(id: string): EffectRow | null {
    const r = this.db.prepare('SELECT * FROM effects WHERE id = ?').get(id) as Row | undefined;
    return r ? mapEffect(r) : null;
  }
  mustEffect(id: string): EffectRow {
    const e = this.getEffect(id);
    if (!e) throw new NotFoundError('efeito', id);
    return e;
  }
  effectsOf(taskId: string, statuses?: readonly EffectStatus[]): EffectRow[] {
    const rows = statuses?.length
      ? this.db.prepare(`SELECT * FROM effects WHERE task_id = ? AND status IN (${statuses.map(() => '?').join(',')}) ORDER BY intent_at, id`).all(taskId, ...statuses)
      : this.db.prepare('SELECT * FROM effects WHERE task_id = ? ORDER BY intent_at, id').all(taskId);
    return (rows as Row[]).map(mapEffect);
  }
  /** `tool_result` recebido: intent → confirmed. Retorna false se não havia intent correspondente. */
  confirmEffect(runId: string, toolUseId: string): boolean {
    return this.tx(() => {
      const r = this.db.prepare(`UPDATE effects SET status = 'confirmed', confirmed_at = ? WHERE run_id = ? AND tool_use_id = ? AND status = 'intent'`)
        .run(this.now(), runId, toolUseId);
      if (Number(r.changes) > 0) this.journal({ taskId: this.mustRun(runId).taskId, runId, kind: 'effect', reason: 'confirmed', payload: { toolUseId } });
      return Number(r.changes) > 0;
    });
  }
  denyEffect(effectId: string): void {
    this.tx(() => {
      const r = this.db.prepare(`UPDATE effects SET status = 'denied' WHERE id = ? AND status = 'intent'`).run(effectId);
      if (Number(r.changes) > 0) { const e = this.mustEffect(effectId); this.journal({ taskId: e.taskId, runId: e.runId, kind: 'effect', reason: 'denied', payload: { effectId } }); }
    });
  }
  /** Marca como `unconfirmed` toda intenção em aberto da tarefa (ao ir para needs_reconcile). */
  markUnconfirmed(taskId: string): number {
    return this.tx(() => {
      const r = this.db.prepare(`UPDATE effects SET status = 'unconfirmed' WHERE task_id = ? AND status = 'intent'`).run(taskId);
      if (Number(r.changes) > 0) this.journal({ taskId, kind: 'effect', reason: 'unconfirmed', payload: { count: Number(r.changes) } });
      return Number(r.changes);
    });
  }
  resolveEffect(effectId: string, resolution: 'user_applied' | 'user_not_applied' | 'user_unknown', gestureId: string): EffectRow {
    return this.tx(() => {
      const e = this.mustEffect(effectId);
      if (e.status !== 'unconfirmed') throw new InvalidTransitionError(`efeito:${e.status}`, resolution);
      this.consumeGestureTx(gestureId, e.taskId, `effect:${effectId}`, 'effect_resolution');
      this.db.prepare('UPDATE effects SET status = ?, resolved_at = ?, resolved_gesture_id = ? WHERE id = ?')
        .run(resolution, this.now(), gestureId, effectId);
      this.journal({ taskId: e.taskId, runId: e.runId, kind: 'effect', reason: resolution, actor: 'user', gestureId, payload: { effectId } });
      return this.mustEffect(effectId);
    });
  }
  /**
   * R6. 'deny' = intenção ainda não resolvida pelo usuário (nega); 'reapprove' = o usuário marcou como
   * aplicada/desconhecida: repetir pode duplicar, então exige NOVA aprovação com gesto (nunca bloqueio permanente).
   */
  blockedActionKeys(taskId: string): Map<string, 'deny' | 'reapprove'> {
    const rows = this.db.prepare(
      `SELECT action_key, status FROM effects WHERE task_id = ? AND status IN ('intent','unconfirmed','user_applied','user_unknown')`,
    ).all(taskId) as { action_key: string; status: string }[];
    const out = new Map<string, 'deny' | 'reapprove'>();
    for (const r of rows) {
      if (r.status === 'intent' || r.status === 'unconfirmed') out.set(r.action_key, 'deny');
      else if (!out.has(r.action_key)) out.set(r.action_key, 'reapprove');
    }
    return out;
  }
}
