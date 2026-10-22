import { afterEach, describe, expect, it, vi } from 'vitest';
import { lockName, OsLock } from '../process/os-lock';
import { happy, init, result, toolUse, toolResultMsg, type Scenario } from '../../integrations/claude-code/pocket/fake-sdk';
import { harness, type Harness } from '../../integrations/claude-code/pocket/harness';
import { CommandError } from './orchestrator';

const hs: Harness[] = [];
afterEach(async () => { while (hs.length) await hs.pop()?.cleanup(); });
function mk(opts: Parameters<typeof harness>[0] = {}): Harness { const h = harness(opts); hs.push(h); return h; }
const state = (h: Harness, id: string) => h.store.mustTask(id).state;
const waitState = (h: Harness, id: string, s: string) => vi.waitFor(() => expect(state(h, id)).toBe(s), { timeout: 5000, interval: 10 });

const hang: Scenario = async function* (ctl) {
  yield init(ctl);
  await ctl.interrupted;
  yield result({ subtype: 'error_during_execution', is_error: true });
  await ctl.promptClosed;
};
const stuck: Scenario = async function* (ctl) { yield init(ctl); await new Promise<never>(() => undefined); };
const failing = (over: Record<string, unknown>, assistantError?: string): Scenario => async function* (ctl) {
  yield init(ctl);
  if (assistantError) yield { type: 'assistant', error: assistantError, message: { content: [] } };
  yield result({ subtype: 'error_during_execution', is_error: true, ...over });
  await ctl.promptClosed;
};

describe('fluxo completo', () => {
  it('criar → iniciar → escrita livre → ação destrutiva pede aprovação → aprovar → review → concluir', async () => {
    const h = mk({ scenarios: [happy([
      { id: 'w1', name: 'Write', input: { file_path: 'src/novo.ts', content: 'abc' } },
      { id: 'b1', name: 'Bash', input: { command: 'rm -rf build' } },
    ])] });
    const id = h.user.create();
    expect(state(h, id)).toBe('queued');
    await h.user.start(id);
    await waitState(h, id, 'awaiting_approval');
    const view = h.orch.view(id);
    expect(view.pendingApprovals).toHaveLength(1);
    expect(view.pendingApprovals[0]).toMatchObject({ toolName: 'Bash', classification: 'destructive' });
    await h.user.approve(view.pendingApprovals[0]!.approvalRequestId);
    await waitState(h, id, 'review'); // success → review, nunca direto a completed
    await h.orch.idle();
    expect(h.store.effectsOf(id).map((e) => [e.toolName, e.status])).toEqual(expect.arrayContaining([['Write', 'confirmed'], ['Bash', 'confirmed']]));
    expect(h.store.mustSession(h.store.mustTask(id).currentSessionId!).state).toBe('idle');
    h.user.approveReview(id);
    expect(state(h, id)).toBe('completed');
    expect(h.store.sessionsOf(id).every((s) => s.state === 'archived')).toBe(true);
    // toda transição →running tem gesto do usuário (exceto queued→running por política, que não foi usada)
    const toRunning = h.store.journalSince(0, id).filter((e) => e.kind === 'transition' && e.toState === 'running');
    expect(toRunning.length).toBeGreaterThan(0);
    for (const e of toRunning) { expect(e.actor).toBe('user'); expect(e.gestureId).toBeTruthy(); }
    // nenhum prompt no journal
    expect(JSON.stringify(h.store.journalSince(0, id))).not.toContain('faça algo');
  });

  it('nada inicia sozinho: tarefa criada permanece queued', async () => {
    const h = mk();
    const id = h.user.create();
    await new Promise((r) => setTimeout(r, 100));
    expect(state(h, id)).toBe('queued');
    expect(h.sdk.calls).toHaveLength(0);
  });

  it('negar uma ação: o agente segue (volta a running) e termina', async () => {
    const h = mk({ scenarios: [happy([{ id: 'b1', name: 'Bash', input: { command: 'git push' } }])] });
    const id = h.user.create();
    await h.user.start(id);
    await waitState(h, id, 'awaiting_approval');
    await h.user.approve(h.orch.view(id).pendingApprovals[0]!.approvalRequestId, 'deny');
    await waitState(h, id, 'review');
    expect(h.store.effectsOf(id)).toHaveLength(0); // negado: nenhuma intenção
  });

  it('o gesto é de uso único e vinculado: iniciar com gesto reutilizado ou de outra tarefa falha', async () => {
    const h = mk();
    const a = h.user.create(); const b = h.user.create();
    const g = h.user.gesture(a, 'to:running');
    await expect(h.orch.startTask(b, g)).rejects.toThrow();
    expect(state(h, b)).toBe('queued');
    await h.orch.startTask(a, g);
    await h.orch.idle();
    await expect(h.orch.resumeTask(a, 'de novo', g)).rejects.toThrow();
  });
});

describe('exclusividade', () => {
  it('só uma tarefa ativa por vez (SLOT_BUSY) e a segunda continua queued', async () => {
    const h = mk({ scenarios: [stuck] });
    const a = h.user.create(); const b = h.user.create();
    await h.user.start(a);
    await expect(h.user.start(b)).rejects.toMatchObject({ code: 'SLOT_BUSY' });
    expect(state(h, b)).toBe('queued');
    await h.user.interrupt(a).catch(() => undefined);
  });

  it('lock da sessão ocupado por outro dono (outra instância) → LOCK_BUSY, tarefa permanece queued', async () => {
    const h = mk();
    const id = h.user.create();
    const sess = h.store.reserveSession(id);
    const other = await OsLock.acquire(lockName('session', sess.id), 'intruso');
    await expect(h.user.start(id)).rejects.toMatchObject({ code: 'LOCK_BUSY' });
    expect(state(h, id)).toBe('queued');
    expect(h.store.openRunOf(id)).toBeNull();
    await other.release();
    await h.user.start(id); // com o lock livre, a mesma sessão reservada é reaproveitada
    await h.orch.idle();
    expect(h.store.sessionsOf(id)).toHaveLength(1);
  });

  it('após terminar, os locks são liberados (nova tarefa pode iniciar)', async () => {
    const h = mk();
    const a = h.user.create(); const b = h.user.create();
    await h.user.start(a); await waitState(h, a, 'review');
    await h.orch.idle();
    await h.user.start(b); await waitState(h, b, 'review');
  });
});

describe('interrupção e retomada', () => {
  it('interromper limpo → interrupted; retomar com prompt editável; mesmo gesto é idempotente', async () => {
    const h = mk({ scenarios: [hang] });
    const id = h.user.create();
    await h.user.start(id);
    await waitState(h, id, 'running');
    await vi.waitFor(() => expect(h.sdk.calls).toHaveLength(1));
    expect(await h.user.interrupt(id)).toBe('interrupted');
    await waitState(h, id, 'interrupted');
    expect(h.store.journalSince(0, id).some((e) => e.kind === 'note' && e.reason === 'interrupt_requested')).toBe(true);
    const g = h.user.gesture(id, 'to:running');
    const r1 = await h.orch.resumeTask(id, 'prossiga só com a parte A', g);
    const r2 = await h.orch.resumeTask(id, 'prossiga só com a parte A', g); // repetido: no-op com o runId vigente
    expect(r2.runId).toBe(r1.runId);
    await waitState(h, id, 'review');
    expect(h.sdk.calls).toHaveLength(2);
    expect(h.sdk.calls[1]!.options.resume).toBe(h.store.mustTask(id).currentSessionId);
    expect(h.sdk.calls[1]!.prompt[0]).toMatchObject({ message: { content: 'prossiga só com a parte A' } });
  });

  it('retomar com prompt vazio é recusado; de estado não retomável também', async () => {
    const h = mk({ scenarios: [hang] });
    const id = h.user.create();
    await expect(h.user.resume(id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await h.user.start(id);
    await waitState(h, id, 'running');
    await vi.waitFor(() => expect(h.sdk.calls).toHaveLength(1));
    await h.user.interrupt(id);
    await expect(h.user.resume(id, '   ')).rejects.toMatchObject({ code: 'BAD_INPUT' });
    expect(state(h, id)).toBe('interrupted');
  });

  it('não responde a tempo → forced_kill → needs_reconcile; retomar exige decidir efeitos e reconhecer', async () => {
    const stuckAfterWrite: Scenario = async function* (ctl) {
      yield init(ctl);
      yield toolUse('w1', 'Write', { file_path: 'src/x.ts', content: 'abc' });
      const r = await ctl.canUse('Write', { file_path: 'src/x.ts', content: 'abc' }, 'w1');
      expect(r.behavior).toBe('allow');
      await new Promise<never>(() => undefined); // morre antes do tool_result
    };
    const h = mk({ scenarios: [stuckAfterWrite], forceAfterMs: 100 });
    const id = h.user.create();
    await h.user.start(id);
    await vi.waitFor(() => expect(h.store.effectsOf(id)).toHaveLength(1));
    expect(await h.user.interrupt(id)).toBe('forced_kill');
    await waitState(h, id, 'needs_reconcile');
    const eff = h.store.effectsOf(id)[0]!;
    expect(eff.status).toBe('unconfirmed');
    // sem decisão por efeito, sem retomada
    await expect(h.user.resume(id)).rejects.toMatchObject({ code: 'RECONCILE_REQUIRED' });
    h.store.resolveEffect(eff.id, 'user_not_applied', h.store.issueGesture('effect_resolution', id));
    await expect(h.user.resume(id)).rejects.toMatchObject({ code: 'RECONCILE_REQUIRED' }); // falta o reconhecimento
    h.store.acknowledgeReconcile(id, h.user.gesture(id, 'reconcile_ack'));
    await h.user.resume(id);
    await waitState(h, id, 'review');
  });

  it('a mesma tarefa só tem uma execução aberta por vez', async () => {
    const h = mk({ scenarios: [stuck] });
    const id = h.user.create();
    await h.user.start(id);
    await expect(h.user.start(id)).rejects.toBeInstanceOf(CommandError);
    expect(h.store.runsOf(id).filter((r) => r.endedAt === null)).toHaveLength(1);
    await h.user.interrupt(id).catch(() => undefined);
  });
});

describe('aprovações no orquestrador', () => {
  it('aprovação expirada: o runner nega com interrupt → interrupted(approval_expired) e a decisão do sistema é registrada', async () => {
    const h = mk({ scenarios: [(async function* (ctl) {
      yield init(ctl);
      yield toolUse('b1', 'Bash', { command: 'rm -rf x' });
      const r = await ctl.canUse('Bash', { command: 'rm -rf x' }, 'b1');
      expect(r).toMatchObject({ behavior: 'deny', interrupt: true });
      yield result({ subtype: 'error_during_execution', is_error: true });
      await ctl.promptClosed;
    }) as Scenario] });
    // TTL curtíssimo via relógio do ApprovalService
    (h.approvals as unknown as { opts: { ttlMs: number } }).opts.ttlMs = 60;
    (h.runner as unknown as { now: () => number }).now = Date.now;
    (h.store as unknown as { now: () => number }).now = Date.now;
    const id = h.user.create();
    await h.user.start(id);
    await waitState(h, id, 'interrupted');
    const appr = h.store.db.prepare('SELECT decision, actor FROM approvals').all() as { decision: string; actor: string }[];
    expect(appr).toEqual([{ decision: 'deny', actor: 'system' }]);
    expect(h.store.journalSince(0, id).some((e) => e.kind === 'transition' && e.reason === 'approval_expired')).toBe(true);
  });

  it('aprovar uma aprovação cuja execução já terminou é recusado', async () => {
    const h = mk({ scenarios: [happy([{ id: 'b1', name: 'Bash', input: { command: 'rm -rf x' } }])] });
    const id = h.user.create();
    await h.user.start(id);
    await waitState(h, id, 'awaiting_approval');
    const aid = h.orch.view(id).pendingApprovals[0]!.approvalRequestId;
    await h.user.interrupt(id);
    await expect(h.user.approve(aid)).rejects.toBeInstanceOf(CommandError);
  });
});

describe('cancelamento', () => {
  it('cancelar tarefa em fila: cancelled direto', async () => {
    const h = mk();
    const id = h.user.create();
    await h.user.cancel(id);
    expect(state(h, id)).toBe('cancelled');
  });

  it('cancelar em execução: só vira cancelled depois da saída limpa (running→cancelled com cleanExit)', async () => {
    const h = mk({ scenarios: [hang] });
    const id = h.user.create();
    await h.user.start(id);
    await vi.waitFor(() => expect(h.sdk.calls).toHaveLength(1));
    await h.user.cancel(id);
    expect(state(h, id)).toBe('cancelled');
    const last = h.store.journalSince(0, id).filter((e) => e.kind === 'transition').at(-1);
    expect(last).toMatchObject({ fromState: 'running', toState: 'cancelled', payload: { cleanExit: true } });
    expect(h.store.sessionsOf(id).every((s) => s.state === 'archived')).toBe(true);
  });

  it('cancelar aguardando aprovação: passa por interrupted e termina cancelled (gesto do usuário)', async () => {
    const h = mk({ scenarios: [(async function* (ctl) {
      yield init(ctl);
      const r = await ctl.canUse('Bash', { command: 'rm -rf x' }, 'b1');
      if (r.interrupt) { yield result({ subtype: 'error_during_execution', is_error: true }); }
      await ctl.promptClosed;
    }) as Scenario] });
    const id = h.user.create();
    await h.user.start(id);
    await waitState(h, id, 'awaiting_approval');
    await h.user.cancel(id);
    expect(state(h, id)).toBe('cancelled');
    const trans = h.store.journalSince(0, id).filter((e) => e.kind === 'transition').map((e) => `${e.fromState}>${e.toState}`);
    expect(trans.slice(-2)).toEqual(['awaiting_approval>interrupted', 'interrupted>cancelled']);
  });

  it('cancelar sem saída limpa (kill forçado) NÃO vira cancelled: needs_reconcile', async () => {
    const h = mk({ scenarios: [stuck], forceAfterMs: 100 });
    const id = h.user.create();
    await h.user.start(id);
    await vi.waitFor(() => expect(h.sdk.calls).toHaveLength(1));
    await h.user.cancel(id);
    expect(state(h, id)).toBe('needs_reconcile');
  });
});

describe('falhas de autenticação, sessão e limite (sem retry automático)', () => {
  it('AUTH_REQUIRED → auth_error; nenhuma segunda execução; retomar só por gesto', async () => {
    const h = mk({ scenarios: [failing({ errors: ['Not logged in'] }, 'authentication_failed')] });
    const id = h.user.create();
    await h.user.start(id);
    await waitState(h, id, 'auth_error');
    expect(h.sdk.calls).toHaveLength(1);
    expect(h.sleeps).toEqual([]);
    expect(h.store.mustTask(id).lastErrorCode).toBeNull(); // retry_count/erro só são gravados em retry
    await h.user.resume(id, 'tentar de novo após login');
    await waitState(h, id, 'review');
  });

  it('SESSION_NOT_FOUND no resume → session_expired; nova sessão só com consentimento; id antigo nunca reutilizado', async () => {
    const h = mk({ scenarios: [hang, failing({ errors: ['No conversation found with session ID'] })] });
    const id = h.user.create();
    await h.user.start(id);
    await vi.waitFor(() => expect(h.sdk.calls).toHaveLength(1));
    await h.user.interrupt(id);
    const oldSession = h.store.mustTask(id).currentSessionId!;
    await h.user.resume(id);
    await waitState(h, id, 'session_expired');
    expect(h.store.mustSession(oldSession).state).toBe('expired');
    await expect(h.user.resume(id)).rejects.toMatchObject({ code: 'NEW_SESSION_REQUIRED' });
    await h.user.resume(id, 'recomeçar', { newSession: true });
    await waitState(h, id, 'review');
    const now = h.store.mustTask(id).currentSessionId!;
    expect(now).not.toBe(oldSession);
    expect(h.store.mustSession(oldSession).state).toBe('archived');
    expect(h.sdk.calls[2]!.options.sessionId).toBe(now); // sessão nova = start com id novo
  });

  it('USAGE_LIMITED (rate_limit_event rejeitado) → usage_limited, sem retry nem retomada automática', async () => {
    const limited: Scenario = async function* (ctl) {
      yield init(ctl);
      yield { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' } };
      yield result({ subtype: 'error_during_execution', is_error: true });
      await ctl.promptClosed;
    };
    const h = mk({ scenarios: [limited] });
    const id = h.user.create();
    await h.user.start(id);
    await waitState(h, id, 'usage_limited');
    await new Promise((r) => setTimeout(r, 80));
    expect(h.sdk.calls).toHaveLength(1);
    expect(h.sleeps).toEqual([]);
  });

  it('processo morre sem result → needs_reconcile (RUNNER_DIED), efeitos incertos marcados', async () => {
    const dies: Scenario = async function* (ctl) {
      yield init(ctl);
      yield toolUse('w1', 'Write', { file_path: 'src/x.ts', content: 'abc' });
      await ctl.canUse('Write', { file_path: 'src/x.ts', content: 'abc' }, 'w1');
    };
    const h = mk({ scenarios: [dies] });
    const id = h.user.create();
    await h.user.start(id);
    await waitState(h, id, 'needs_reconcile');
    expect(h.store.effectsOf(id)[0]?.status).toBe('unconfirmed');
    expect(h.sdk.calls).toHaveLength(1); // nenhuma reexecução automática
  });

  it('falha não classificada → failed (terminal) e sessão arquivada', async () => {
    const h = mk({ scenarios: [failing({ errors: ['algo estranho'] })] });
    const id = h.user.create();
    await h.user.start(id);
    await waitState(h, id, 'failed');
    expect(h.store.sessionsOf(id).every((s) => s.state === 'archived')).toBe(true);
  });
});

describe('retry limitado (apenas transitórios, antes de qualquer ferramenta autorizada)', () => {
  const overloaded = failing({ errors: ['overloaded'] }, 'overloaded');

  it('2 falhas transitórias e depois sucesso: backoff exponencial, task segue running, 3 execuções', async () => {
    const h = mk({ scenarios: [overloaded, overloaded], retryBaseMs: 10 });
    const id = h.user.create();
    await h.user.start(id);
    await waitState(h, id, 'review');
    expect(h.sleeps).toEqual([10, 20]);
    expect(h.sdk.calls).toHaveLength(3);
    expect(h.store.runsOf(id)).toHaveLength(3);
    const trans = h.store.journalSince(0, id).filter((e) => e.kind === 'transition').map((e) => e.toState);
    expect(trans).toEqual(['queued', 'running', 'review']); // sem estados intermediários nem gesto extra
    // a segunda tentativa, já tendo visto o init, é um resume (sem repetir o prompt original)
    expect(h.sdk.calls[1]!.options.resume).toBeTruthy();
    expect(h.sdk.calls[1]!.prompt[0]).not.toMatchObject({ message: { content: 'faça algo' } });
  });

  it('esgota 3 retries (4 execuções) → failed; sem quarto retry', async () => {
    const h = mk({ scenarios: [overloaded, overloaded, overloaded, overloaded, overloaded], retryBaseMs: 1 });
    const id = h.user.create();
    await h.user.start(id);
    await waitState(h, id, 'failed');
    expect(h.sdk.calls).toHaveLength(4);
    expect(h.sleeps).toEqual([1, 2, 4]);
    expect(h.store.mustTask(id).lastErrorCode).toBe('TRANSIENT_OVERLOADED');
  });

  it('transitório DEPOIS de uma ferramenta autorizada → needs_reconcile, sem retry', async () => {
    const afterWrite: Scenario = async function* (ctl) {
      yield init(ctl);
      yield toolUse('w1', 'Write', { file_path: 'src/x.ts', content: 'abc' });
      await ctl.canUse('Write', { file_path: 'src/x.ts', content: 'abc' }, 'w1');
      yield toolResultMsg('w1');
      yield { type: 'assistant', error: 'overloaded', message: { content: [] } };
      yield result({ subtype: 'error_during_execution', is_error: true, errors: ['overloaded'] });
      await ctl.promptClosed;
    };
    const h = mk({ scenarios: [afterWrite] });
    const id = h.user.create();
    await h.user.start(id);
    await waitState(h, id, 'needs_reconcile');
    expect(h.sdk.calls).toHaveLength(1);
    expect(h.sleeps).toEqual([]);
  });

  it('interromper durante o backoff cancela o retry', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const h = mk({ scenarios: [overloaded], sleep: () => gate });
    const id = h.user.create();
    await h.user.start(id);
    await vi.waitFor(() => expect(h.store.mustTask(id).retryCount).toBe(1));
    expect(state(h, id)).toBe('running'); // "tentando de novo (1/3)"
    expect(await h.user.interrupt(id)).toBe('interrupted');
    expect(state(h, id)).toBe('interrupted');
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(h.sdk.calls).toHaveLength(1);
    expect(state(h, id)).toBe('interrupted');
  });
});

describe('review', () => {
  it('pedir ajuste a partir de review é uma retomada com gesto; aprovar só em review', async () => {
    const h = mk();
    const id = h.user.create();
    await expect(Promise.resolve().then(() => h.user.approveReview(id))).rejects.toThrow();
    await h.user.start(id);
    await waitState(h, id, 'review');
    await h.orch.idle();
    await h.user.resume(id, 'ajuste: renomeie a função');
    await waitState(h, id, 'review');
    h.user.approveReview(id);
    expect(state(h, id)).toBe('completed');
  });
});
