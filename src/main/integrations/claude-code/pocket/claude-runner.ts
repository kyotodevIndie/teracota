// Adapter Claude Code (Agent SDK). Traduz operações do contrato em chamadas ao SDK e o stream em eventos
// normalizados. NÃO guarda estado de tarefa e NÃO muda estado: política vem de `PermissionHooks`, eventos
// vão para o Core via `EventSink`. O SDK entra por `SdkApi` (real ou falso nos testes).
import type { RunnerEvent } from '../../../../shared/pocket';
import { classifyFailure, sanitizedMessage, summarizeToolUse } from './classify';
import type {
  AgentRunner, EventSink, InterruptOutcome, PermissionHooks, ResumeInput, RunContext, RunnerCapabilities,
  SignedDecision, StartInput, ToolDecision, ToolRequest,
} from '../../../pocket/runner/types';

// ── fachada mínima do SDK ────────────────────────────────────────────────────────────────────────
export interface SdkMessageLike { type: string; subtype?: string; [k: string]: unknown }
export interface SdkQuery extends AsyncIterable<SdkMessageLike> {
  interrupt(): Promise<unknown>;
  close(): void;
}
export interface SdkApi {
  query(p: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }): SdkQuery;
}
/** Processo gerenciado (ProcessSupervisor) visto pelo adapter. */
export interface RunnerProcess {
  readonly pid: number;
  stderrTail(): string;
  closeAndWait(ms: number): Promise<boolean>;
}
export interface SpawnRequest {
  command: string; args: string[]; cwd?: string; env: Record<string, string | undefined>; runId: string;
}

export interface ClaudeRunnerDeps {
  sdk: SdkApi;
  sink: EventSink;
  hooks: PermissionHooks;
  /** Spawn pelo supervisor (registra pid/tempo de criação). Opcional: sem ele o SDK cria o processo. */
  spawn?: (r: SpawnRequest) => RunnerProcess & object;
  killTree?: (p: RunnerProcess) => Promise<void>;
  claudePath?: string;
  /** Modelo (ex.: 'haiku' nos testes reais); ausente = padrão do Claude Code. */
  model?: string;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
}

interface Pending {
  req: ToolRequest;
  resolve: (d: ToolDecision) => void;
  timer: NodeJS.Timeout;
}

interface ActiveRun {
  ctx: RunContext;
  query: SdkQuery | null;
  proc: (RunnerProcess & object) | null;
  pending: Map<string, Pending>;
  interrupt: { reason: string; by: 'user' | 'system' } | null;
  forced: boolean;
  terminal: boolean;
  sawInit: boolean;
  rateLimitRejected: boolean;
  creditsRequired: boolean;
  assistantError?: string;
  apiStatus?: number | null;
  stderr: string;
  releasePrompt: () => void;
  abort: AbortController;
  done: Promise<void>;
  markDone: () => void;
}

export class ClaudeCodeRunner implements AgentRunner {
  readonly id = 'claude-code';
  private readonly runs = new Map<string, ActiveRun>();
  private readonly subs = new Set<(e: RunnerEvent) => void>();
  private readonly now: () => number;

  constructor(private readonly deps: ClaudeRunnerDeps) {
    this.now = deps.now ?? Date.now;
  }

  async capabilities(): Promise<RunnerCapabilities> {
    return {
      structuredEvents: true, interrupt: true, resumeSession: true, hostChosenSessionId: true,
      persistentApproval: false, usageMetrics: 'official', authMode: 'user_managed',
    };
  }

  onEvent(cb: (e: RunnerEvent) => void): () => void {
    this.subs.add(cb);
    return () => { this.subs.delete(cb); };
  }

  isRunning(runId: string): boolean { return this.runs.has(runId); }

  start(i: StartInput): Promise<{ runId: string }> { return this.launch(i, false); }
  resume(i: ResumeInput): Promise<{ runId: string }> { return this.launch(i, true, i.userGestureId); }

  // ── ciclo de vida ──────────────────────────────────────────────────────────────────────────────

  private async launch(i: StartInput, resumed: boolean, gesture?: string): Promise<{ runId: string }> {
    if (this.runs.has(i.runId)) throw new Error(`execução já ativa: ${i.runId}`);
    const ctx: RunContext = {
      taskId: i.taskId, sessionId: i.sessionId, runId: i.runId, cwd: i.cwd, policy: i.policy,
      attempt: i.attempt ?? 1, resumed, userGestureId: gesture,
    };
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let markDone!: () => void;
    const done = new Promise<void>((r) => { markDone = r; });
    const run: ActiveRun = {
      ctx, query: null, proc: null, pending: new Map(), interrupt: null, forced: false, terminal: false,
      sawInit: false, rateLimitRejected: false, creditsRequired: false, stderr: '',
      releasePrompt: release, abort: new AbortController(), done, markDone,
    };
    this.runs.set(i.runId, run);

    async function* promptStream(text: string): AsyncGenerator<unknown> {
      yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
      await gate; // mantém o stdin aberto (necessário para interrupt) até o turno acabar
    }

    try {
      run.query = this.deps.sdk.query({ prompt: promptStream(i.prompt), options: this.buildOptions(run, resumed) });
    } catch (e) {
      this.runs.delete(i.runId);
      this.terminalError(run, 'RUNNER_SPAWN_FAILED', (e as Error).message, true);
      throw e;
    }
    void this.pump(run);
    return { runId: i.runId };
  }

  private buildOptions(run: ActiveRun, resumed: boolean): Record<string, unknown> {
    const env: Record<string, string | undefined> = { ...(this.deps.env ?? process.env) };
    delete env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN; // contrato §3: nunca reexecutar turno interrompido
    const o: Record<string, unknown> = {
      cwd: run.ctx.cwd,
      ...(resumed ? { resume: run.ctx.sessionId } : { sessionId: run.ctx.sessionId }),
      permissionMode: 'default',
      // isola de regras de permissão em settings.json (um `allow` do usuário/projeto pularia o canUseTool)
      settingSources: [],
      env,
      abortController: run.abort,
      stderr: (s: string) => { run.stderr = (run.stderr + s).slice(-4096); },
      // Portão extra e uniforme: roda ANTES do modelo de permissão do CLI (inclusive para o que o CLI
      // liberaria sozinho e para subagentes) e só pode negar. A decisão de allow continua só no canUseTool.
      hooks: { PreToolUse: [{ hooks: [async (input: Record<string, unknown>, toolUseID: string | undefined, o: { signal: AbortSignal }) => this.preToolUse(run, input, toolUseID, o.signal)] }] },
      // ferramentas cujo fluxo de permissão não foi verificado contra o CLI real ficam desligadas na Fase 1
      disallowedTools: ['Task', 'Agent', 'Skill', 'SlashCommand'],
      canUseTool: (toolName: string, input: Record<string, unknown>, opts: { signal: AbortSignal; toolUseID?: string; blockedPath?: string }) =>
        this.canUseTool(run, toolName, input, opts),
    };
    if (this.deps.claudePath) o.pathToClaudeCodeExecutable = this.deps.claudePath;
    if (this.deps.model) o.model = this.deps.model;
    const spawn = this.deps.spawn;
    if (spawn) {
      o.spawnClaudeCodeProcess = (s: { command: string; args: string[]; cwd?: string; env: Record<string, string | undefined> }) => {
        const p = spawn({ ...s, runId: run.ctx.runId });
        run.proc = p;
        return p;
      };
    }
    return o;
  }

  // ── stream do SDK → eventos ────────────────────────────────────────────────────────────────────

  private emit<T extends RunnerEvent['type']>(run: ActiveRun, type: T, payload: Extract<RunnerEvent, { type: T }>['payload']): void {
    try {
      const ev = this.deps.sink(run.ctx.runId, type, payload);
      for (const cb of this.subs) { try { cb(ev); } catch { /* assinante com defeito não derruba o runner */ } }
    } catch {
      // o Core recusou (fence perdido, execução encerrada...): sem journal não há execução segura
      void this.abortRun(run);
    }
  }

  private async pump(run: ActiveRun): Promise<void> {
    const q = run.query as SdkQuery;
    try {
      for await (const msg of q) this.handle(run, msg);
      if (!run.terminal) this.endWithoutResult(run);
    } catch (e) {
      if (!run.terminal) {
        if (run.interrupt || run.forced) this.endWithoutResult(run);
        else this.terminalError(run, 'RUNNER_DIED', (e as Error).message, false);
      }
    } finally {
      for (const [id, p] of run.pending) { clearTimeout(p.timer); p.resolve({ kind: 'deny', message: 'execução encerrada', interrupt: true }); run.pending.delete(id); }
      run.releasePrompt();
      this.runs.delete(run.ctx.runId);
      run.markDone();
    }
  }

  private handle(run: ActiveRun, m: SdkMessageLike): void {
    switch (m.type) {
      case 'system': this.handleSystem(run, m); return;
      case 'assistant': this.handleAssistant(run, m); return;
      case 'user': this.handleUser(run, m); return;
      case 'rate_limit_event': this.handleRateLimit(run, m); return;
      case 'result': this.handleResult(run, m); return;
      default: return; // stream_event, tool_progress, etc.: ruído para o Core
    }
  }

  private handleSystem(run: ActiveRun, m: SdkMessageLike): void {
    if (m.subtype === 'init') {
      run.sawInit = true;
      if (typeof m.session_id === 'string' && m.session_id !== run.ctx.sessionId) {
        this.terminalError(run, 'SESSION_ID_MISMATCH', 'o Claude Code usou outro id de sessão', true);
        void this.abortRun(run);
        return;
      }
      this.emit(run, 'started', {
        resumed: run.ctx.resumed,
        model: typeof m.model === 'string' ? m.model : undefined,
        claudeVersion: typeof m.claude_code_version === 'string' ? m.claude_code_version : undefined,
        cwd: run.ctx.cwd,
      });
    } else if (m.subtype === 'api_retry') {
      run.apiStatus = typeof m.error_status === 'number' ? m.error_status : null;
      this.emit(run, 'activity', { kind: 'api_retry', summary: `tentativa ${String(m.attempt)}/${String(m.max_retries)} (status ${String(m.error_status)})` });
    }
  }

  private handleAssistant(run: ActiveRun, m: SdkMessageLike): void {
    if (typeof m.error === 'string') run.assistantError = m.error;
    const content = ((m.message as { content?: unknown[] } | undefined)?.content ?? []) as { type?: string; name?: string; id?: string; input?: Record<string, unknown>; text?: string }[];
    for (const b of content) {
      if (b.type === 'text') this.emit(run, 'activity', { kind: 'text', summary: `texto (${(b.text ?? '').length} caracteres)` });
      else if (b.type === 'thinking') this.emit(run, 'activity', { kind: 'thinking' });
      else if (b.type === 'tool_use') {
        this.emit(run, 'activity', { kind: 'tool_use', toolName: b.name, toolUseId: b.id, summary: summarizeToolUse(b.name ?? '', b.input ?? {}) });
      }
    }
  }

  private handleUser(run: ActiveRun, m: SdkMessageLike): void {
    const content = (m.message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) return;
    for (const b of content as { type?: string; tool_use_id?: string }[]) {
      if (b.type === 'tool_result' && b.tool_use_id) {
        this.emit(run, 'activity', { kind: 'tool_result', toolUseId: b.tool_use_id });
        try { this.deps.hooks.toolResult(run.ctx, b.tool_use_id); } catch { /* ledger falhou: o Core reconcilia */ }
      }
    }
  }

  private handleRateLimit(run: ActiveRun, m: SdkMessageLike): void {
    const info = (m.rate_limit_info ?? {}) as { status?: string; resetsAt?: number; rateLimitType?: string; utilization?: number; errorCode?: string };
    if (info.status === 'rejected') run.rateLimitRejected = true;
    if (info.errorCode === 'credits_required') run.creditsRequired = true;
    this.emit(run, 'usage_updated', {
      source: 'official',
      windows: { status: info.status, type: info.rateLimitType, resetsAt: info.resetsAt, utilization: info.utilization },
    });
  }

  private handleResult(run: ActiveRun, m: SdkMessageLike): void {
    if (run.terminal) return;
    const subtype = String(m.subtype);
    if (subtype === 'success' && m.is_error !== true) {
      run.terminal = true;
      this.emit(run, 'completed', { resultSubtype: 'success', durationMs: Number(m.duration_ms ?? 0) });
    } else if (run.interrupt && subtype === 'error_during_execution') {
      run.terminal = true;
      this.emit(run, 'interrupted', { requestedBy: run.interrupt.by, forced: false, reason: run.interrupt.reason });
    } else {
      const errors = Array.isArray(m.errors) ? (m.errors as unknown[]).map(String) : [];
      const c = classifyFailure({
        subtype, errors, assistantError: run.assistantError, rateLimitRejected: run.rateLimitRejected,
        creditsRequired: run.creditsRequired, startupFailure: typeof m.startup_failure_reason === 'string' ? m.startup_failure_reason : undefined,
        stderrTail: run.stderr + (run.proc?.stderrTail() ?? ''), resumed: run.ctx.resumed, apiStatus: run.apiStatus,
      });
      run.terminal = true;
      this.emit(run, 'failed', { code: c.code, retryable: c.retryable, attempt: run.ctx.attempt, message: sanitizedMessage(c.code) });
    }
    run.releasePrompt(); // turno acabou: fecha a entrada para o CLI sair sozinho
  }

  private endWithoutResult(run: ActiveRun): void {
    if (run.terminal) return;
    run.terminal = true;
    if (run.interrupt || run.forced) {
      // processo acabou sem `result` após pedido de parada: saída NÃO comprovadamente limpa
      this.emit(run, 'interrupted', { requestedBy: run.interrupt?.by ?? 'system', forced: true, reason: run.interrupt?.reason });
    } else {
      this.emit(run, 'failed', { code: 'RUNNER_DIED', retryable: false, attempt: run.ctx.attempt, message: sanitizedMessage('RUNNER_DIED') });
    }
  }

  private terminalError(run: ActiveRun, code: 'RUNNER_SPAWN_FAILED' | 'SESSION_ID_MISMATCH' | 'RUNNER_DIED', detail: string, fatal: boolean): void {
    if (run.terminal) return;
    run.terminal = true;
    if (code === 'RUNNER_DIED') {
      this.emit(run, 'failed', { code, retryable: false, attempt: run.ctx.attempt, message: sanitizedMessage(code) });
    } else {
      this.emit(run, 'error', { code, fatal, detail: detail.slice(0, 200) });
    }
  }

  // ── permissões ────────────────────────────────────────────────────────────────────────────────

  private async canUseTool(run: ActiveRun, toolName: string, input: Record<string, unknown>,
    opts: { signal: AbortSignal; toolUseID?: string; blockedPath?: string }): Promise<Record<string, unknown>> {
    const req: ToolRequest = { toolName, input, toolUseId: opts.toolUseID, blockedPath: opts.blockedPath, signal: opts.signal };
    if (run.interrupt || run.terminal) return this.toSdk({ kind: 'deny', message: 'execução em encerramento', interrupt: true }, req);
    let d: ToolDecision;
    try { d = await this.deps.hooks.decide(run.ctx, req); } catch {
      d = { kind: 'deny', message: 'falha ao avaliar a política; ação negada' };
    }
    if (d.kind === 'deny' && d.code === 'LOCK_LOST') run.interrupt ??= { reason: 'lock_lost', by: 'system' };
    if (d.kind === 'ask') d = await this.waitApproval(run, req, d);
    return this.toSdk(d, req);
  }

  private async preToolUse(run: ActiveRun, input: Record<string, unknown>, toolUseID: string | undefined, signal: AbortSignal): Promise<Record<string, unknown>> {
    if (input.hook_event_name !== 'PreToolUse') return {};
    let d: ToolDecision | 'ask' | null = null;
    try {
      d = this.deps.hooks.precheck(run.ctx, {
        toolName: String(input.tool_name), input: (input.tool_input ?? {}) as Record<string, unknown>,
        toolUseId: toolUseID ?? (typeof input.tool_use_id === 'string' ? input.tool_use_id : undefined), signal,
      });
    } catch {
      d = { kind: 'deny', message: 'falha ao avaliar a política; ação negada' };
    }
    if (d === 'ask') return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' } };
    if (d?.kind !== 'deny') return {};
    if (d.interrupt) run.interrupt ??= { reason: 'lock_lost', by: 'system' };
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.message } };
  }

  private waitApproval(run: ActiveRun, req: ToolRequest, ask: Extract<ToolDecision, { kind: 'ask' }>): Promise<ToolDecision> {
    return new Promise<ToolDecision>((resolve) => {
      const ttl = Math.max(0, ask.expiresAt - this.now());
      const timer = setTimeout(() => {
        if (!run.pending.delete(ask.approvalRequestId)) return;
        run.interrupt ??= { reason: 'approval_expired', by: 'system' };
        resolve({ kind: 'deny', message: 'aprovação expirada', interrupt: true });
        void run.query?.interrupt().catch(() => undefined);
      }, ttl);
      timer.unref?.();
      run.pending.set(ask.approvalRequestId, { req, resolve, timer });
      req.signal.addEventListener('abort', () => {
        const p = run.pending.get(ask.approvalRequestId);
        if (!p) return;
        clearTimeout(p.timer);
        run.pending.delete(ask.approvalRequestId);
        resolve({ kind: 'deny', message: 'turno abortado' });
      }, { once: true });
      this.emit(run, 'approval_requested', {
        approvalRequestId: ask.approvalRequestId, toolUseId: req.toolUseId, toolName: req.toolName,
        actionKey: ask.actionKey, classification: ask.classification, summary: ask.summary, expiresAt: ask.expiresAt,
      });
    });
  }

  async resolveApproval(runId: string, approvalRequestId: string, decision: SignedDecision): Promise<void> {
    const run = this.runs.get(runId);
    const p = run?.pending.get(approvalRequestId);
    if (!run || !p) throw new Error('aprovação não está pendente neste runner');
    run.pending.delete(approvalRequestId);
    clearTimeout(p.timer);
    let d: ToolDecision;
    try { d = await this.deps.hooks.finalize(run.ctx, p.req, decision); } catch {
      d = { kind: 'deny', message: 'falha ao finalizar a aprovação; ação negada' };
    }
    p.resolve(d);
  }

  private toSdk(d: ToolDecision, req: ToolRequest): Record<string, unknown> {
    if (d.kind === 'allow') return { behavior: 'allow', updatedInput: d.updatedInput ?? req.input, toolUseID: req.toolUseId };
    if (d.kind === 'deny') return { behavior: 'deny', message: d.message, interrupt: d.interrupt === true, toolUseID: req.toolUseId };
    return { behavior: 'deny', message: 'aprovação indisponível', toolUseID: req.toolUseId };
  }

  // ── interrupção ───────────────────────────────────────────────────────────────────────────────

  async interrupt(runId: string, o: { reason: 'user' | 'cancel'; forceAfterMs: number }): Promise<InterruptOutcome> {
    const run = this.runs.get(runId);
    if (!run) return { accepted: false, outcome: 'not_running' };
    if (run.interrupt) return { accepted: false, outcome: 'already_pending' };
    run.interrupt = { reason: o.reason, by: 'user' };
    for (const [id, p] of run.pending) {
      clearTimeout(p.timer);
      run.pending.delete(id);
      p.resolve({ kind: 'deny', message: 'interrompido pelo usuário', interrupt: true });
    }
    try { await run.query?.interrupt(); } catch { /* o prazo abaixo decide */ }
    const clean = await this.waitDone(run, o.forceAfterMs);
    if (clean) return { accepted: true, outcome: 'interrupted' };
    await this.abortRun(run);
    await this.waitDone(run, 3000);
    return { accepted: true, outcome: 'forced_kill' };
  }

  /** Encerramento forçado (timeout de interrupt, fence perdido, id de sessão trocado). */
  private async abortRun(run: ActiveRun): Promise<void> {
    run.forced = true;
    run.releasePrompt();
    try { run.abort.abort(); } catch { /* já abortado */ }
    try { if (run.proc && this.deps.killTree) await this.deps.killTree(run.proc); } catch { /* best-effort */ }
    try { run.query?.close(); } catch { /* já fechado */ }
  }

  private async waitDone(run: ActiveRun, ms: number): Promise<boolean> {
    let t: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((r) => { t = setTimeout(() => r(false), ms); });
    const ok = await Promise.race([run.done.then(() => true as const), timeout]);
    if (t) clearTimeout(t);
    return ok;
  }

  /** Para testes e shutdown: espera o término de todas as execuções. */
  async idle(): Promise<void> {
    await Promise.all([...this.runs.values()].map((r) => r.done));
  }
}

/** Carrega o SDK real sob demanda (pacote ESM; o bundle do app é CJS). */
export async function loadClaudeSdk(): Promise<SdkApi> {
  const mod = (await import('@anthropic-ai/claude-agent-sdk')) as unknown as SdkApi;
  return { query: (p) => mod.query(p) };
}
