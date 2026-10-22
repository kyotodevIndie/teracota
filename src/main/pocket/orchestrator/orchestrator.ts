// Orquestrador: liga Core, runner, permissões e locks. É o único que muda o estado das tarefas em reação
// a eventos do runner. Execução MANUAL (decisão 11): nada inicia sozinho; retomar sempre exige gesto.
import type { RunnerEvent, TaskRow, TaskState, TaskView, ErrorCode } from '../../../shared/pocket';
import type { PocketStore } from '../core/store';
import { RESUMABLE_STATES, allowedActors } from '../core/states';
import type { ExecLease, ExecLocks } from '../process/exec-locks';
import type { AgentRunner, RunPolicy } from '../runner/types';
import { APPROVAL_TTL_MS, type ApprovalService } from '../security/approvals';
import { collectEvidence, suggestFor, type Evidence, type GitProbe, type TranscriptProbe } from '../reconcile/reconcile';

export type CommandErrorCode =
  | 'INVALID_STATE' | 'BAD_INPUT' | 'LOCK_BUSY' | 'SLOT_BUSY' | 'RECONCILE_REQUIRED' | 'NEW_SESSION_REQUIRED'
  | 'NOT_RUNNING' | 'RUNNER_FAILED';
export class CommandError extends Error {
  constructor(readonly code: CommandErrorCode, message: string) { super(message); this.name = 'CommandError'; }
}

export interface OrchestratorDeps {
  store: PocketStore;
  runner: AgentRunner;
  approvals: ApprovalService;
  locks: ExecLocks;
  sleep?: (ms: number) => Promise<void>;
  /** Base do backoff exponencial dos retries (contrato §5: 1 s). */
  retryBaseMs?: number;
  /** Retries ADICIONAIS (decisão 6: até 3). */
  maxRetries?: number;
  /** Prazo da interrupção limpa (decisão 5: 10 s). */
  forceAfterMs?: number;
  policy?: RunPolicy;
  /** Reconciliação: sonda de transcrito (somente leitura) e de git. */
  probe?: TranscriptProbe;
  git?: GitProbe;
}

interface Live {
  runId: string;
  taskId: string;
  sessionId: string;
  cwd: string;
  prompt: string;
  kind: 'start' | 'resume';
  attempt: number;
  lease: ExecLease;
  startedSeen: boolean;
  phase: 'running' | 'backoff' | 'done';
  cancelGesture?: string;
  chain: Promise<void>;
}

const RETRY_PROMPT = 'Continue a tarefa anterior de onde parou (nova tentativa automática após um erro transitório de rede/serviço).';
const MAX_PROMPT = 20_000;

export class PocketOrchestrator {
  private readonly live = new Map<string, Live>();
  private readonly listeners = new Set<(taskId: string) => void>();
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly retryBase: number;
  private readonly maxRetries: number;
  private readonly forceAfter: number;
  private readonly policy: RunPolicy;
  private readonly unsub: () => void;
  private busy = new Set<string>();
  private disposed = false;
  private readonly releasing = new Map<string, Promise<void>>();

  constructor(private readonly d: OrchestratorDeps) {
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.retryBase = d.retryBaseMs ?? 1000;
    this.maxRetries = d.maxRetries ?? 3;
    this.forceAfter = d.forceAfterMs ?? 10_000;
    this.policy = d.policy ?? { approvalTtlMs: APPROVAL_TTL_MS };
    this.unsub = d.runner.onEvent((e) => this.enqueue(e));
  }

  dispose(): void { this.disposed = true; this.unsub(); }
  onChange(cb: (taskId: string) => void): () => void { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  private changed(taskId: string): void { for (const cb of this.listeners) { try { cb(taskId); } catch { /* UI com defeito não derruba o core */ } } }

  /** Gancho para `createPermissionHooks`: o lock desta execução ainda é nosso? */
  lockHeld = (ctx: { runId: string }): boolean => this.live.get(ctx.runId)?.lease.held === true;

  // ── consultas ──────────────────────────────────────────────────────────────────────────────────

  view(taskId: string): TaskView {
    const t = this.d.store.mustTask(taskId);
    return {
      ...t,
      pendingApprovals: this.d.store.pendingApprovals(taskId).map((a) => ({
        approvalRequestId: a.approvalRequestId, taskId: a.taskId, runId: a.runId, toolName: a.toolName,
        classification: a.classification as TaskView['pendingApprovals'][number]['classification'], summary: a.summaryShown, expiresAt: a.expiresAt,
      })),
      unconfirmedEffects: this.d.store.effectsOf(taskId, ['unconfirmed', 'user_applied', 'user_unknown']).map((e) => ({
        id: e.id, taskId: e.taskId, toolName: e.toolName, actionKey: e.actionKey, summary: e.summary, verifiable: e.verifiable,
        suggestion: suggestFor(e), status: e.status,
      })),
      resumable: RESUMABLE_STATES.includes(t.state),
    };
  }
  listViews(): TaskView[] { return this.d.store.listTasks().map((t) => this.view(t.id)); }

  /** Espera todas as execuções ativas e retries terminarem (testes/shutdown). */
  async idle(): Promise<void> {
    for (let i = 0; i < 200 && [...this.live.values()].some((l) => l.phase !== 'done'); i++) {
      await Promise.all([...this.live.values()].map((l) => l.chain));
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  // ── comandos do usuário (todos exigem gesto emitido pela UI) ─────────────────────────────────

  createTask(i: { title: string; prompt: string; cwd: string }, gestureId: string): TaskRow {
    const title = i.title.trim().slice(0, 120);
    const prompt = i.prompt.trim();
    if (!title || !prompt || prompt.length > MAX_PROMPT || !i.cwd) throw new CommandError('BAD_INPUT', 'título, prompt (até 20 mil caracteres) e pasta são obrigatórios');
    const t = this.d.store.createTask({ title, prompt, cwd: i.cwd, gestureId });
    this.changed(t.id);
    return t;
  }

  /** "Iniciar" (queued → running). Nunca automático. */
  async startTask(taskId: string, gestureId: string): Promise<{ runId: string }> {
    return this.exclusive(taskId, async () => {
      const store = this.d.store;
      const task = store.mustTask(taskId);
      if (task.state !== 'queued') throw new CommandError('INVALID_STATE', `a tarefa está em ${task.state}`);
      this.assertSlotFree(taskId);
      let session = task.currentSessionId ? store.getSession(task.currentSessionId) : null;
      if (session?.state !== 'reserved') session = store.reserveSession(taskId);
      await this.releasing.get(taskId);
      const lease = await this.acquire(session.id);
      try {
        if (store.mustTask(taskId).state !== 'queued') throw new CommandError('INVALID_STATE', 'a tarefa mudou de estado');
        store.transition(taskId, 'running', { actor: 'user', reason: 'start', gestureId });
        store.setRetryCount(taskId, 0, null);
        return await this.launch({ task, sessionId: session.id, kind: 'start', prompt: task.prompt, attempt: 1, lease, gestureId });
      } catch (e) {
        await lease.release().catch(() => undefined);
        throw e;
      }
    });
  }

  /** Retomar com prompt explícito e editável (contrato §1.3 resume). */
  async resumeTask(taskId: string, prompt: string, gestureId: string, opts: { newSession?: boolean } = {}): Promise<{ runId: string }> {
    return this.exclusive(taskId, async () => {
      const store = this.d.store;
      const task = store.mustTask(taskId);
      // idempotência: o mesmo gesto já iniciou a execução atual → no-op com o runId vigente
      const open = store.openRunOf(taskId);
      if (open && open.gestureId === gestureId) return { runId: open.id };
      const text = prompt.trim();
      if (!text || text.length > MAX_PROMPT) throw new CommandError('BAD_INPUT', 'o prompt de retomada não pode ser vazio (até 20 mil caracteres)');
      if (!RESUMABLE_STATES.includes(task.state)) throw new CommandError('INVALID_STATE', `a tarefa está em ${task.state}`);
      this.assertSlotFree(taskId);
      if (task.state === 'needs_reconcile') {
        if (store.effectsOf(taskId, ['unconfirmed']).length > 0 || !store.hasReconcileAck(taskId)) {
          throw new CommandError('RECONCILE_REQUIRED', 'revise a evidência e decida cada efeito incerto antes de retomar');
        }
      }
      let session = task.currentSessionId ? store.getSession(task.currentSessionId) : null;
      let kind: 'start' | 'resume' = 'resume';
      if (task.state === 'session_expired') {
        if (!opts.newSession) throw new CommandError('NEW_SESSION_REQUIRED', 'a sessão anterior não existe mais; iniciar uma nova perde o contexto');
        kind = 'start';
      }
      if (!session) throw new CommandError('INVALID_STATE', 'a tarefa não tem sessão');
      await this.releasing.get(taskId);
      // fencing da sessão ANTIGA primeiro: o lock é tomado sobre o id que a tarefa tem agora; nada é arquivado,
      // reservado ou alterado antes de o lock e o gesto estarem em mãos (uma falha aqui não deixa sessões órfãs)
      const lease = await this.acquire(session.id);
      let sessionId = session.id;
      try {
        if (!RESUMABLE_STATES.includes(store.mustTask(taskId).state)) throw new CommandError('INVALID_STATE', 'a tarefa mudou de estado');
        if (session.state === 'orphaned') session = store.setSessionState(session.id, 'idle', 'resume');
        store.transition(taskId, 'running', { actor: 'user', reason: kind === 'start' ? 'resume_new_session' : 'resume', gestureId });
        store.setRetryCount(taskId, 0, null);
        if (kind === 'start') {
          // sessão expirada: a nova geração só nasce depois de lock + gesto; a antiga é arquivada, nunca reutilizada
          const old = session;
          sessionId = store.tx(() => {
            if (old.state === 'expired') store.setSessionState(old.id, 'archived', 'substituída');
            return store.reserveSession(taskId);
          }).id;
        }
        return await this.launch({ task, sessionId, kind, prompt: text, attempt: 1, lease, gestureId });
      } catch (e) {
        await lease.release().catch(() => undefined);
        // a transição para running já ocorreu mas a execução não subiu: não deixa a tarefa presa em running sem runner
        const now = store.getTask(taskId);
        if (now && (now.state === 'running' || now.state === 'awaiting_approval') && !this.liveOf(taskId)) this.safeTransition(taskId, 'needs_reconcile', 'resume_failed_before_launch', null);
        throw e;
      }
    });
  }

  /** Interromper (running/awaiting_approval). A transição acontece quando o runner confirma. */
  async interruptTask(taskId: string, gestureId: string): Promise<'interrupted' | 'forced_kill'> {
    const store = this.d.store;
    const task = store.mustTask(taskId);
    const l = this.liveOf(taskId);
    if (!l || (task.state !== 'running' && task.state !== 'awaiting_approval')) throw new CommandError('NOT_RUNNING', 'não há execução ativa desta tarefa');
    store.useGesture(gestureId, taskId, 'task_action', 'to:interrupted');
    store.setFlag(taskId, 'interrupt_requested', true, l.runId); // vai ao journal ANTES de pedir a parada
    if (l.phase === 'backoff') {
      l.phase = 'done';
      this.settle(l, 'interrupted_in_backoff');
      store.transition(taskId, 'interrupted', { actor: 'system', reason: 'user_interrupt', runId: l.runId });
      this.changed(taskId);
      return 'interrupted';
    }
    const out = await this.d.runner.interrupt(l.runId, { reason: 'user', forceAfterMs: this.forceAfter });
    await l.chain; await this.releasing.get(l.taskId);
    return out.outcome === 'forced_kill' ? 'forced_kill' : 'interrupted';
  }

  /** Cancelar. Em execução: para primeiro (saída limpa) e só então vira `cancelled`. */
  async cancelTask(taskId: string, gestureId: string): Promise<void> {
    const store = this.d.store;
    const task = store.mustTask(taskId);
    const l = this.liveOf(taskId);
    if (l && (task.state === 'running' || task.state === 'awaiting_approval')) {
      // o gesto vale ANTES de qualquer marca no journal (um gesto inválido não pode deixar cancel_requested para trás)
      if (task.state === 'running') store.useGesture(gestureId, taskId, 'task_action', 'to:cancelled');
      else store.useGesture(gestureId, taskId, 'task_action', 'to:cancelled'); // consumido já (TTL de 60 s não pode vencer durante a parada)
      store.setFlag(taskId, 'cancel_requested', true, l.runId);
      l.cancelGesture = gestureId;
      if (l.phase === 'backoff') {
        l.phase = 'done';
        this.settle(l, 'cancelled_in_backoff');
        store.transition(taskId, 'cancelled', { actor: 'system', reason: 'user_cancel', runId: l.runId, evidence: { cleanExit: true } });
        this.archiveSession(taskId);
        this.changed(taskId);
        return;
      }
      await this.d.runner.interrupt(l.runId, { reason: 'cancel', forceAfterMs: this.forceAfter });
      await l.chain; await this.releasing.get(l.taskId);
      return;
    }
    store.transition(taskId, 'cancelled', { actor: 'user', reason: 'user_cancel', gestureId });
    this.archiveSession(taskId);
    this.changed(taskId);
  }

  /** Aprovar ou negar uma ação pendente. Um gesto = decisão + volta a running. */
  async resolveApproval(approvalRequestId: string, decision: 'allow' | 'deny', gestureId: string): Promise<void> {
    const a = this.d.store.mustApproval(approvalRequestId);
    const l = this.live.get(a.runId);
    if (!l || l.phase === 'done') throw new CommandError('NOT_RUNNING', 'a execução desta aprovação já terminou');
    if (this.d.store.mustTask(a.taskId).state !== 'awaiting_approval') throw new CommandError('INVALID_STATE', 'a tarefa não está aguardando aprovação');
    const signed = this.d.approvals.decideByUser(approvalRequestId, decision, gestureId);
    this.changed(a.taskId);
    await this.d.runner.resolveApproval(a.runId, approvalRequestId, signed);
  }

  /** review → completed (conclusão só após aprovação humana — decisão 2). */
  approveReview(taskId: string, gestureId: string): void {
    this.d.store.transition(taskId, 'completed', { actor: 'user', reason: 'review_approved', gestureId });
    this.archiveSession(taskId);
    this.changed(taskId);
  }

  /** interrupted → review ("o que foi feito basta"). */
  acceptAsIs(taskId: string, gestureId: string): void {
    this.d.store.transition(taskId, 'review', { actor: 'user', reason: 'accepted_as_is', gestureId });
    this.changed(taskId);
  }

  // ── reconciliação (decisões do usuário) ────────────────────────────────────────────────────

  async evidence(taskId: string, opts: { includeGit?: boolean } = {}): Promise<Evidence> {
    if (!this.d.probe) throw new CommandError('BAD_INPUT', 'sonda de transcrito não configurada');
    return collectEvidence({ store: this.d.store, probe: this.d.probe, git: this.d.git }, taskId, opts);
  }

  /** Decisão por efeito incerto: aplicado / não aplicado / não sei (todos exigem gesto). */
  resolveEffect(effectId: string, resolution: 'applied' | 'not_applied' | 'unknown', gestureId: string): void {
    const e = this.d.store.mustEffect(effectId);
    this.d.store.resolveEffect(effectId, `user_${resolution}` as 'user_applied' | 'user_not_applied' | 'user_unknown', gestureId);
    this.changed(e.taskId);
  }

  /** "Revisei a evidência e decidi cada efeito": pré-condição para retomar de needs_reconcile. */
  acknowledgeReconcile(taskId: string, gestureId: string): void {
    this.d.store.acknowledgeReconcile(taskId, gestureId);
    this.changed(taskId);
  }

  /** Sair de needs_reconcile sem retomar: aceitar como está (review), marcar falha ou cancelar. */
  resolveReconcile(taskId: string, to: 'review' | 'failed' | 'cancelled', gestureId: string): void {
    this.d.store.transition(taskId, to, { actor: 'user', reason: `reconcile_${to}`, gestureId });
    if (to !== 'review') this.archiveSession(taskId);
    this.changed(taskId);
  }

  /** Encerrar o app: interrompe com limpeza o que estiver rodando. */
  async shutdown(): Promise<void> {
    this.disposed = true; // acorda do backoff e não inicia nada novo
    for (const l of [...this.live.values()].filter((x) => x.phase === 'backoff')) {
      l.phase = 'done';
      this.settle(l, 'shutdown_in_backoff');
      this.safeTransition(l.taskId, 'interrupted', 'app_shutdown', l.runId);
    }
    await Promise.all([...this.live.values()].filter((l) => l.phase === 'running').map(async (l) => {
      try {
        this.d.store.setFlag(l.taskId, 'interrupt_requested', true, l.runId);
        await this.d.runner.interrupt(l.runId, { reason: 'user', forceAfterMs: Math.min(this.forceAfter, 5000) });
        await l.chain;
      } catch { /* o próximo boot reconcilia */ }
    }));
  }

  // ── execução ───────────────────────────────────────────────────────────────────────────────────

  private liveOf(taskId: string): Live | undefined {
    for (const l of this.live.values()) if (l.taskId === taskId && l.phase !== 'done') return l;
    return undefined;
  }

  private assertSlotFree(taskId: string): void {
    const busy = this.d.store.listTasks(['running', 'awaiting_approval']).find((t) => t.id !== taskId);
    if (busy) throw new CommandError('SLOT_BUSY', 'já existe uma tarefa em execução (uma por vez nesta versão)');
  }

  private async acquire(sessionId: string): Promise<ExecLease> {
    try { return await this.d.locks.acquire(sessionId); } catch (e) {
      if ((e as { code?: string }).code === 'LOCK_BUSY') throw new CommandError('LOCK_BUSY', 'outra execução detém o lock (outra instância ou sessão em uso)');
      throw e;
    }
  }

  private exclusive<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(taskId)) return Promise.reject(new CommandError('INVALID_STATE', 'operação em andamento nesta tarefa'));
    this.busy.add(taskId);
    return fn().finally(() => { this.busy.delete(taskId); });
  }

  private async launch(a: { task: TaskRow; sessionId: string; kind: 'start' | 'resume'; prompt: string; attempt: number; lease: ExecLease; gestureId?: string }): Promise<{ runId: string }> {
    const store = this.d.store;
    const run = store.beginRun({ taskId: a.task.id, sessionId: a.sessionId, kind: a.kind, gestureId: a.gestureId ?? null, attempt: a.attempt });
    store.setSessionState(a.sessionId, 'active', a.kind);
    const l: Live = {
      runId: run.id, taskId: a.task.id, sessionId: a.sessionId, cwd: a.task.cwd, prompt: a.prompt, kind: a.kind, attempt: a.attempt,
      lease: a.lease, startedSeen: false, phase: 'running', chain: Promise.resolve(),
    };
    this.live.set(run.id, l);
    const input = { taskId: a.task.id, runId: run.id, sessionId: a.sessionId, cwd: a.task.cwd, prompt: a.prompt, policy: this.policy, attempt: a.attempt };
    try {
      if (a.kind === 'start') await this.d.runner.start(input);
      else await this.d.runner.resume({ ...input, userGestureId: a.gestureId ?? 'system-retry' });
    } catch (e) {
      // não subiu: nenhum efeito possível; falha limpa
      l.phase = 'done';
      this.settle(l, 'spawn_failed');
      this.safeTransition(a.task.id, 'failed', 'RUNNER_SPAWN_FAILED', run.id);
      this.d.store.setRetryCount(a.task.id, 0, 'RUNNER_SPAWN_FAILED');
      this.changed(a.task.id);
      throw new CommandError('RUNNER_FAILED', `não foi possível iniciar o Claude Code: ${(e as Error).message.slice(0, 200)}`);
    }
    this.changed(a.task.id);
    return { runId: run.id };
  }

  // ── eventos do runner (serializados por execução) ───────────────────────────────────────────

  private enqueue(e: RunnerEvent): void {
    const l = this.live.get(e.runId);
    if (!l) return;
    l.chain = l.chain.then(() => this.handle(l, e)).catch((err) => {
      try { this.d.store.note(l.taskId, 'orchestrator_error', { message: String((err as Error).message).slice(0, 200) }, l.runId); } catch { /* store fechado */ }
      try { this.toReconcile(l, 'orchestrator_error'); } catch { /* já resolvido */ }
    });
  }

  private async handle(l: Live, e: RunnerEvent): Promise<void> {
    if (l.phase === 'done') return;
    const store = this.d.store;
    switch (e.type) {
      case 'started': l.startedSeen = true; break;
      case 'activity': case 'usage_updated': break;
      case 'approval_requested':
        if (store.mustTask(l.taskId).state === 'running') store.transition(l.taskId, 'awaiting_approval', { actor: 'system', reason: 'approval_requested', runId: l.runId });
        break;
      case 'completed':
        this.finish(l, 'completed', () => { this.settleTask(l, 'review', 'turn_success'); });
        break;
      case 'interrupted': this.onInterrupted(l, e.payload); break;
      case 'error':
        this.finish(l, e.payload.code, () => {
          if (e.payload.code === 'SESSION_ID_MISMATCH') this.toReconcile(l, 'session_id_mismatch');
          else this.settleTask(l, 'failed', e.payload.code);
        });
        break;
      case 'failed': await this.onFailed(l, e.payload); break;
    }
    this.changed(l.taskId);
  }

  private onInterrupted(l: Live, p: { forced: boolean; reason?: string }): void {
    const store = this.d.store;
    this.finish(l, p.forced ? 'forced_kill' : 'interrupted', () => {
      if (p.forced) { this.toReconcile(l, 'forced_kill'); return; }
      if (p.reason === 'lock_lost') { this.toReconcile(l, 'lock_lost'); return; } // exclusividade perdida: nada é seguro de assumir
      const task = store.mustTask(l.taskId);
      if (task.cancelRequested) {
        if (task.state === 'running') {
          store.transition(l.taskId, 'cancelled', { actor: 'system', reason: 'user_cancel', runId: l.runId, evidence: { cleanExit: true } });
        } else {
          // awaiting_approval→cancelled é ato do usuário: passa por interrupted e usa o gesto guardado
          store.transition(l.taskId, 'interrupted', { actor: 'system', reason: 'cancel_clean_exit', runId: l.runId });
          store.transition(l.taskId, 'cancelled', { actor: 'user', reason: 'user_cancel', gestureId: l.cancelGesture, gestureAlreadyConsumed: true });
        }
        this.archiveSession(l.taskId);
        return;
      }
      store.transition(l.taskId, 'interrupted', { actor: 'system', reason: p.reason === 'approval_expired' ? 'approval_expired' : 'user_interrupt', runId: l.runId });
    });
  }

  private async onFailed(l: Live, p: { code: ErrorCode; retryable: boolean }): Promise<void> {
    const store = this.d.store;
    const code = p.code;
    if (p.retryable) {
      const hadEffects = store.effectsOf(l.taskId).some((x) => x.runId === l.runId);
      const task = store.mustTask(l.taskId);
      if (hadEffects) { this.finish(l, code, () => { this.toReconcile(l, 'transient_after_effects'); }); return; }
      if (task.retryCount >= this.maxRetries) {
        this.finish(l, code, () => { store.setRetryCount(l.taskId, task.retryCount, code); this.settleTask(l, 'failed', 'retries_exhausted'); });
        return;
      }
      // retry: a tarefa continua `running` ("tentando de novo n/3"); sem tool_use autorizado nada foi feito
      store.setRetryCount(l.taskId, task.retryCount + 1, code);
      l.phase = 'backoff';
      this.denyPending(l);
      store.endRun(l.runId, `retry:${code}`);
      store.setSessionState(l.sessionId, 'idle', 'retry');
      this.changed(l.taskId); // l continua em this.live durante o backoff (interromper/cancelar o encontram)
      await this.sleep(this.retryBase * 2 ** task.retryCount);
      if (l.phase !== 'backoff' || this.disposed) return; // interrompido/cancelado/encerrado durante a espera
      const now = store.mustTask(l.taskId);
      if (now.state !== 'running') return; // interrompido/cancelado durante a espera
      const kind = l.startedSeen ? 'resume' : 'start';
      this.live.delete(l.runId);
      const next: Live = { ...l, kind, prompt: kind === 'resume' ? RETRY_PROMPT : l.prompt, attempt: l.attempt + 1, phase: 'running', startedSeen: false, chain: Promise.resolve(), runId: '' };
      try {
        const run = store.beginRun({ taskId: l.taskId, sessionId: l.sessionId, kind, attempt: next.attempt });
        store.setSessionState(l.sessionId, 'active', 'retry');
        next.runId = run.id;
        this.live.set(run.id, next);
        const input = { taskId: l.taskId, runId: run.id, sessionId: l.sessionId, cwd: l.cwd, prompt: next.prompt, policy: this.policy, attempt: next.attempt };
        if (kind === 'start') await this.d.runner.start(input); else await this.d.runner.resume({ ...input, userGestureId: 'system-retry' });
      } catch {
        if (next.runId) this.live.delete(next.runId);
        next.phase = 'done';
        this.settle(next, 'retry_spawn_failed');
        this.safeTransition(l.taskId, 'failed', 'RUNNER_SPAWN_FAILED', next.runId || null);
      }
      return;
    }
    this.finish(l, code, () => {
      switch (code) {
        case 'AUTH_REQUIRED': this.settleTask(l, 'auth_error', code); break;
        case 'SESSION_NOT_FOUND': this.settleTask(l, 'session_expired', code); store.setSessionState(l.sessionId, 'expired', 'resume recusado'); break;
        case 'USAGE_LIMITED': case 'CREDITS_REQUIRED': this.settleTask(l, 'usage_limited', code); break;
        case 'RUNNER_DIED': this.toReconcile(l, 'runner_died'); break;
        default: this.settleTask(l, 'failed', code);
      }
    });
  }

  // ── helpers de fim de execução ─────────────────────────────────────────────────────────────

  /** Encerra o registro da execução (uma vez), roda `apply` (transições) e libera locks. */
  private finish(l: Live, outcome: string, apply: () => void): void {
    if (l.phase === 'done') return;
    l.phase = 'done';
    try {
      this.denyPending(l);
      // efeito autorizado sem tool_result (interrupção ou falha no meio de uma ferramenta): é incerto → needs_reconcile,
      // nunca interrupted/failed "limpos". Exceções: sucesso do turno e cancelamento pedido pelo usuário.
      const uncertain = outcome !== 'completed' && !this.d.store.mustTask(l.taskId).cancelRequested
        && this.d.store.effectsOf(l.taskId, ['intent']).some((e) => e.runId === l.runId);
      this.closeRun(l, outcome); // sessão volta a idle ANTES das transições (arquivar/expirar dependem disso)
      if (uncertain) this.toReconcile(l, `unconfirmed_effects:${outcome}`); else apply();
    } finally {
      this.releaseLease(l);
    }
  }

  private closeRun(l: Live, outcome: string): void {
    const store = this.d.store;
    try { store.endRun(l.runId, outcome); } catch { /* run já encerrada */ }
    try {
      const s = store.getSession(l.sessionId);
      if (s?.state === 'active') store.setSessionState(l.sessionId, 'idle', outcome);
    } catch { /* sessão já tratada */ }
  }

  /** O lock é um objeto do kernel liberado de forma assíncrona: quem vai readquirir espera por `releasing`. */
  private releaseLease(l: Live): void {
    this.live.delete(l.runId);
    const p = l.lease.release().catch(() => undefined);
    this.releasing.set(l.taskId, p);
    void p.finally(() => { if (this.releasing.get(l.taskId) === p) this.releasing.delete(l.taskId); });
  }

  private settle(l: Live, outcome: string): void {
    this.closeRun(l, outcome);
    this.releaseLease(l);
  }

  private denyPending(l: Live): void {
    for (const a of this.d.store.pendingApprovals(l.taskId)) {
      if (a.runId === l.runId) { try { this.d.approvals.denyBySystem(a.approvalRequestId); } catch { /* já decidida */ } }
    }
  }

  /** Vai para `target`; se o estado atual (awaiting_approval) não permite, passa por needs_reconcile. */
  private settleTask(l: Live, target: TaskState, reason: string): void {
    const store = this.d.store;
    const t = store.mustTask(l.taskId);
    if (t.state === target) return;
    if (!allowedActors(t.state, target)?.includes('system')) { this.toReconcile(l, `${reason}_from_${t.state}`); return; }
    store.transition(l.taskId, target, { actor: 'system', reason, runId: l.runId });
    if (target === 'failed' || target === 'cancelled' || target === 'completed') this.archiveSession(l.taskId);
  }

  private toReconcile(l: Live, reason: string): void {
    const store = this.d.store;
    const t = store.mustTask(l.taskId);
    if (t.state !== 'needs_reconcile' && allowedActors(t.state, 'needs_reconcile')?.includes('system')) {
      store.transition(l.taskId, 'needs_reconcile', { actor: 'system', reason, runId: l.runId, evidence: { forced: reason === 'forced_kill' } });
    }
    store.markUnconfirmed(l.taskId);
    const s = store.getSession(l.sessionId);
    if (s?.state === 'active') { store.setSessionState(l.sessionId, 'orphaned', reason); store.setSessionState(l.sessionId, 'idle', reason); }
  }

  private safeTransition(taskId: string, to: TaskState, reason: string, runId: string | null): void {
    try { this.d.store.transition(taskId, to, { actor: 'system', reason, runId }); } catch { this.d.store.note(taskId, 'transition_refused', { to, reason }); }
  }

  private archiveSession(taskId: string): void {
    const store = this.d.store;
    for (const s of store.sessionsOf(taskId)) {
      if (s.state === 'active') continue;
      try {
        if (s.state === 'reserved' || s.state === 'idle' || s.state === 'orphaned' || s.state === 'expired') store.setSessionState(s.id, 'archived', 'task_terminal');
      } catch { /* já arquivada */ }
    }
  }
}

