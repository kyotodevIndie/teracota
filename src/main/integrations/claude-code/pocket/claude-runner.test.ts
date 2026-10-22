import { afterEach, describe, expect, it, vi } from 'vitest';
import { PocketStore } from '../../../pocket/core/store';
import { clock, driveTo } from '../../../pocket/testing/helpers';
import { FakeSdk, happy, init, result, toolUse, type Scenario } from './fake-sdk';
import { ClaudeCodeRunner, type RunnerProcess } from './claude-runner';
import { classifyFailure, sanitizedMessage, summarizeToolUse } from './classify';
import type { PermissionHooks, ToolDecision } from '../../../pocket/runner/types';
import type { RunnerEvent } from '../../../../shared/pocket';

const stores: PocketStore[] = [];
afterEach(() => { while (stores.length) stores.pop()?.close(); });

const POLICY = { approvalTtlMs: 600_000 };
const PROMPT_SECRET = 'SEGREDO-NO-PROMPT-12345';

function setup(opts: { scenario?: Scenario; hooks?: Partial<PermissionHooks>; resume?: boolean; killTree?: (p: RunnerProcess) => Promise<void>; env?: NodeJS.ProcessEnv } = {}) {
  const c = clock();
  const store = PocketStore.open(':memory:', { now: c });
  stores.push(store);
  const task = driveTo(store, 'running');
  const sess = store.reserveSession(task.id);
  if (opts.resume) { store.setSessionState(sess.id, 'active', 't'); store.setSessionState(sess.id, 'idle', 't'); }
  const run = store.beginRun({ taskId: task.id, sessionId: sess.id, kind: opts.resume ? 'resume' : 'start' });
  const sdk = new FakeSdk(opts.scenario ?? happy());
  const hooks: PermissionHooks = {
    decide: async () => ({ kind: 'allow' }),
    finalize: async (_c, _r, d): Promise<ToolDecision> => (d.decision === 'allow' ? { kind: 'allow' } : { kind: 'deny', message: 'negado' }),
    toolResult: () => undefined,
    precheck: () => null,
    ...opts.hooks,
  };
  const events: RunnerEvent[] = [];
  const runner = new ClaudeCodeRunner({
    sdk, hooks, now: c, env: opts.env ?? { PATH: 'x' }, killTree: opts.killTree,
    sink: ((runId: string, type: never, payload: never) => store.appendEvent(runId, type, payload)) as never,
  });
  runner.onEvent((e) => events.push(e));
  const input = { taskId: task.id, runId: run.id, sessionId: sess.id, cwd: 'C:/ws', prompt: PROMPT_SECRET, policy: POLICY };
  const go = () => (opts.resume ? runner.resume({ ...input, userGestureId: 'g' }) : runner.start(input));
  return { store, runner, sdk, events, input, go, c, task };
}
const types = (ev: RunnerEvent[]) => ev.map((e) => e.type);

describe('eventos normalizados', () => {
  it('start: started → atividade → completed, com envelope v1 e seq contíguo, sem prompt nem conteúdo', async () => {
    const { runner, events, go, input, task } = setup({ scenario: happy([{ id: 'tu1', name: 'Write', input: { file_path: 'C:/ws/a.txt', content: 'CONTEUDO-SECRETO-DO-ARQUIVO' } }]) });
    await go();
    await runner.idle();
    expect(types(events)).toEqual(['started', 'activity', 'activity', 'activity', 'completed']);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    for (const e of events) {
      expect(e.v).toBe(1);
      expect(e.taskId).toBe(task.id);
      expect(e.runId).toBe(input.runId);
      expect(e.sessionId).toBe(input.sessionId);
      expect(e.eventId).toMatch(/^ev_/);
    }
    const all = JSON.stringify(events);
    expect(all).not.toContain(PROMPT_SECRET);
    expect(all).not.toContain('CONTEUDO-SECRETO');
    expect(all).toContain('Write a.txt'); // só nome do alvo
    // persistido no journal do Core
    expect(events.length).toBe(5);
  });

  it('start usa sessionId e permissionMode default, sem settingSources herdados; resume usa resume', async () => {
    const a = setup();
    await a.go(); await a.runner.idle();
    const o = a.sdk.calls[0]!.options;
    expect(o.sessionId).toBe(a.input.sessionId);
    expect(o.resume).toBeUndefined();
    expect(o.permissionMode).toBe('default');
    expect(o.settingSources).toEqual([]);
    const b = setup({ resume: true, env: { PATH: 'x', CLAUDE_CODE_RESUME_INTERRUPTED_TURN: '1' } });
    await b.go(); await b.runner.idle();
    const ob = b.sdk.calls[0]!.options;
    expect(ob.resume).toBe(b.input.sessionId);
    expect(ob.sessionId).toBeUndefined();
    expect(ob.env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN).toBeUndefined();
    expect((b.events[0] as { payload: { resumed: boolean } }).payload.resumed).toBe(true);
    expect(types(b.events)[0]).toBe('started');
  });

  it('envia o prompt como entrada em streaming e fecha a entrada ao fim do turno', async () => {
    const { runner, sdk, go } = setup();
    await go(); await runner.idle();
    expect(sdk.calls[0]!.prompt).toHaveLength(1);
    await sdk.calls[0]!.promptClosed;
  });

  it('tool_result chega ao gancho do ledger', async () => {
    const toolResult = vi.fn();
    const { runner, go } = setup({ scenario: happy([{ id: 'tu9', name: 'Read', input: { file_path: 'C:/ws/x' } }]), hooks: { toolResult } });
    await go(); await runner.idle();
    expect(toolResult).toHaveBeenCalledWith(expect.objectContaining({ runId: expect.any(String) }), 'tu9');
  });

  it('usage_updated oficial a partir de rate_limit_event; não vira falha se permitido', async () => {
    const sc: Scenario = async function* (ctl) {
      yield init(ctl);
      yield { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 0.8 } };
      yield result();
      await ctl.promptClosed;
    };
    const { runner, events, go } = setup({ scenario: sc });
    await go(); await runner.idle();
    expect(types(events)).toEqual(['started', 'usage_updated', 'completed']);
  });
});

describe('aprovações', () => {
  const ask = (id = 'ar1'): Extract<ToolDecision, { kind: 'ask' }> => ({ kind: 'ask', approvalRequestId: id, actionKey: 'k', classification: 'destructive', summary: 'Bash rm', expiresAt: 600_000 + 1_000_000 });
  const tool = [{ id: 'tu1', name: 'Bash', input: { command: 'rm -rf x' } }];

  it('ask → approval_requested; allow assinado libera a ferramenta; deny nega', async () => {
    for (const decision of ['allow', 'deny'] as const) {
      const { runner, events, go, input } = setup({ scenario: happy(tool), hooks: { decide: async () => ask() } });
      await go();
      await vi.waitFor(() => expect(types(events)).toContain('approval_requested'));
      const req = events.find((e) => e.type === 'approval_requested') as Extract<RunnerEvent, { type: 'approval_requested' }>;
      expect(req.payload.toolName).toBe('Bash');
      await runner.resolveApproval(input.runId, req.payload.approvalRequestId, { approvalRequestId: 'ar1', decision, hmac: 'h' });
      await runner.idle();
      const toolResults = events.filter((e) => e.type === 'activity' && e.payload.kind === 'tool_result');
      expect(toolResults).toHaveLength(decision === 'allow' ? 1 : 0);
      expect(events.at(-1)?.type).toBe(decision === 'allow' ? 'completed' : 'completed');
    }
  });

  it('aprovação inexistente ou já resolvida é recusada', async () => {
    const { runner, go, input, events } = setup({ scenario: happy(tool), hooks: { decide: async () => ask() } });
    await go();
    await vi.waitFor(() => expect(types(events)).toContain('approval_requested'));
    await expect(runner.resolveApproval(input.runId, 'nao-existe', { approvalRequestId: 'x', decision: 'allow', hmac: 'h' })).rejects.toThrow();
    await runner.resolveApproval(input.runId, 'ar1', { approvalRequestId: 'ar1', decision: 'allow', hmac: 'h' });
    await expect(runner.resolveApproval(input.runId, 'ar1', { approvalRequestId: 'ar1', decision: 'allow', hmac: 'h' })).rejects.toThrow();
    await runner.idle();
  });

  it('finalize pode negar mesmo com allow do usuário (fence perdido, expirada, HMAC inválido)', async () => {
    const finalize = vi.fn(async (): Promise<ToolDecision> => ({ kind: 'deny', message: 'fence perdido', interrupt: true }));
    const { runner, go, input, events } = setup({ scenario: happy(tool), hooks: { decide: async () => ask(), finalize } });
    await go();
    await vi.waitFor(() => expect(types(events)).toContain('approval_requested'));
    await runner.resolveApproval(input.runId, 'ar1', { approvalRequestId: 'ar1', decision: 'allow', hmac: 'h' });
    await runner.idle();
    expect(finalize).toHaveBeenCalled();
    expect(events.some((e) => e.type === 'activity' && e.payload.kind === 'tool_result')).toBe(false);
  });

  it('TTL: aprovação não respondida expira → deny com interrupt e evento interrupted (sistema)', async () => {
    const short = (): ToolDecision => ({ ...ask(), expiresAt: Date.now() + 80 });
    const sc: Scenario = async function* (ctl) {
      yield init(ctl);
      yield toolUse('tu1', 'Bash', { command: 'rm x' });
      const r = await ctl.canUse('Bash', { command: 'rm x' }, 'tu1');
      expect(r.behavior).toBe('deny');
      expect(r.interrupt).toBe(true);
      yield result({ subtype: 'error_during_execution', is_error: true });
      await ctl.promptClosed;
    };
    const { runner, events, go } = setup({ scenario: sc, hooks: { decide: async () => short() } });
    // o runner compara expiresAt com o relógio injetado; usa relógio real aqui
    (runner as unknown as { now: () => number }).now = Date.now;
    await go(); await runner.idle();
    const last = events.at(-1) as Extract<RunnerEvent, { type: 'interrupted' }>;
    expect(last.type).toBe('interrupted');
    expect(last.payload).toMatchObject({ requestedBy: 'system', forced: false, reason: 'approval_expired' });
  });

  it('política que lança erro nega a ação (nunca libera por falha)', async () => {
    const sc: Scenario = async function* (ctl) {
      yield init(ctl);
      const r = await ctl.canUse('Write', { file_path: 'C:/ws/a' }, 'tu1');
      expect(r).toMatchObject({ behavior: 'deny' });
      yield result();
      await ctl.promptClosed;
    };
    const { runner, go } = setup({ scenario: sc, hooks: { decide: async () => { throw new Error('boom'); } } });
    await go(); await runner.idle();
  });
});

describe('interrupção', () => {
  const hang: Scenario = async function* (ctl) {
    yield init(ctl);
    await ctl.interrupted;
    yield result({ subtype: 'error_during_execution', is_error: true });
    await ctl.promptClosed;
  };

  it('limpa: interrupted(forced=false), desfecho "interrupted"', async () => {
    const { runner, events, go, input } = setup({ scenario: hang });
    await go();
    await vi.waitFor(() => expect(types(events)).toContain('started'));
    const out = await runner.interrupt(input.runId, { reason: 'user', forceAfterMs: 2000 });
    expect(out).toEqual({ accepted: true, outcome: 'interrupted' });
    expect(events.at(-1)).toMatchObject({ type: 'interrupted', payload: { requestedBy: 'user', forced: false } });
    expect(await runner.interrupt(input.runId, { reason: 'user', forceAfterMs: 100 })).toEqual({ accepted: false, outcome: 'not_running' });
  });

  it('segundo pedido enquanto o primeiro está pendente → already_pending', async () => {
    const slow: Scenario = async function* (ctl) {
      yield init(ctl);
      await ctl.interrupted;
      await new Promise((r) => setTimeout(r, 300));
      yield result({ subtype: 'error_during_execution', is_error: true });
      await ctl.promptClosed;
    };
    const { runner, events, go, input } = setup({ scenario: slow });
    await go();
    await vi.waitFor(() => expect(types(events)).toContain('started'));
    const first = runner.interrupt(input.runId, { reason: 'user', forceAfterMs: 3000 });
    expect(await runner.interrupt(input.runId, { reason: 'user', forceAfterMs: 3000 })).toEqual({ accepted: false, outcome: 'already_pending' });
    expect((await first).outcome).toBe('interrupted');
  });

  it('não responde dentro do prazo → forced_kill, killTree e interrupted(forced=true)', async () => {
    const stuck: Scenario = async function* (ctl) {
      yield init(ctl);
      await new Promise<never>(() => undefined); // ignora tudo
    };
    const killTree = vi.fn(async () => undefined);
    const { runner, events, go, input } = setup({ scenario: stuck, killTree });
    await go();
    await vi.waitFor(() => expect(types(events)).toContain('started'));
    const out = await runner.interrupt(input.runId, { reason: 'user', forceAfterMs: 100 });
    expect(out).toEqual({ accepted: true, outcome: 'forced_kill' });
    expect(events.at(-1)).toMatchObject({ type: 'interrupted', payload: { forced: true } });
    expect(runner.isRunning(input.runId)).toBe(false);
  });

  it('interromper com aprovação pendente nega a ferramenta com interrupt', async () => {
    const sc: Scenario = async function* (ctl) {
      yield init(ctl);
      const r = await ctl.canUse('Bash', { command: 'rm x' }, 'tu1');
      expect(r).toMatchObject({ behavior: 'deny', interrupt: true });
      yield result({ subtype: 'error_during_execution', is_error: true });
      await ctl.promptClosed;
    };
    const ask: ToolDecision = { kind: 'ask', approvalRequestId: 'ar1', actionKey: 'k', classification: 'destructive', summary: 's', expiresAt: Date.now() + 60_000 };
    const { runner, events, go, input } = setup({ scenario: sc, hooks: { decide: async () => ask } });
    (runner as unknown as { now: () => number }).now = Date.now;
    await go();
    await vi.waitFor(() => expect(types(events)).toContain('approval_requested'));
    const out = await runner.interrupt(input.runId, { reason: 'cancel', forceAfterMs: 2000 });
    expect(out.outcome).toBe('interrupted');
    expect(events.at(-1)?.type).toBe('interrupted');
  });
});

describe('falhas', () => {
  it('iteração termina sem result → failed RUNNER_DIED', async () => {
    const dies: Scenario = async function* (ctl) { yield init(ctl); };
    const { runner, events, go } = setup({ scenario: dies });
    await go(); await runner.idle();
    expect(events.at(-1)).toMatchObject({ type: 'failed', payload: { code: 'RUNNER_DIED', retryable: false } });
  });

  it('SDK lança no meio do stream → RUNNER_DIED', async () => {
    const boom: Scenario = async function* (ctl) { yield init(ctl); throw new Error('pipe quebrado'); };
    const { runner, events, go } = setup({ scenario: boom });
    await go(); await runner.idle();
    expect(events.at(-1)).toMatchObject({ type: 'failed', payload: { code: 'RUNNER_DIED' } });
  });

  it('id de sessão diferente no init → error SESSION_ID_MISMATCH e execução abortada', async () => {
    const wrong: Scenario = async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'outro-id', model: 'm' };
      await new Promise<never>(() => undefined);
    };
    const killTree = vi.fn(async () => undefined);
    const { runner, events, go } = setup({ scenario: wrong, killTree });
    await go();
    await vi.waitFor(() => expect(events.some((e) => e.type === 'error')).toBe(true));
    expect(events.at(-1)).toMatchObject({ type: 'error', payload: { code: 'SESSION_ID_MISMATCH', fatal: true } });
    await runner.idle();
  });

  it('mesmo runId duas vezes é recusado', async () => {
    const hang: Scenario = async function* (ctl) { yield init(ctl); await ctl.promptClosed; await new Promise<never>(() => undefined); };
    const { runner, go, input } = setup({ scenario: hang });
    await go();
    await expect(runner.start(input)).rejects.toThrow(/já ativa/);
    await runner.interrupt(input.runId, { reason: 'user', forceAfterMs: 50 });
  });

  it('o Core recusa o evento (fence perdido): a execução é abortada', async () => {
    const killTree = vi.fn(async () => undefined);
    const { runner, store, go, events } = setup({ scenario: happy([{ id: 'tu1', name: 'Read', input: { file_path: 'C:/ws/a' } }]), killTree });
    store.db.prepare('UPDATE core_owner SET fence = fence + 1').run(); // outro dono assumiu
    await go(); await runner.idle();
    expect(events).toHaveLength(0);
  });

  it('classificação (mapeamento defensivo; formatos reais NÃO verificados)', () => {
    const base = { subtype: 'error_during_execution', errors: [] as string[], rateLimitRejected: false, creditsRequired: false, stderrTail: '', resumed: false };
    const c = (o: Partial<Parameters<typeof classifyFailure>[0]>) => classifyFailure({ ...base, ...o });
    expect(c({ rateLimitRejected: true })).toEqual({ code: 'USAGE_LIMITED', retryable: false });
    expect(c({ creditsRequired: true }).code).toBe('CREDITS_REQUIRED');
    expect(c({ assistantError: 'authentication_failed' })).toEqual({ code: 'AUTH_REQUIRED', retryable: false });
    expect(c({ errors: ['Not logged in · Please run /login'] }).code).toBe('AUTH_REQUIRED');
    expect(c({ resumed: true, errors: ['No conversation found with session ID: x'] }).code).toBe('SESSION_NOT_FOUND');
    expect(c({ resumed: false, errors: ['No conversation found with session ID: x'] }).code).toBe('UNKNOWN');
    expect(c({ assistantError: 'overloaded' })).toEqual({ code: 'TRANSIENT_OVERLOADED', retryable: true });
    expect(c({ stderrTail: 'fetch failed ECONNRESET' })).toEqual({ code: 'TRANSIENT_NETWORK', retryable: true });
    expect(c({ subtype: 'error_max_turns' }).code).toBe('MAX_TURNS');
    expect(c({ errors: ['algo estranho'] })).toEqual({ code: 'UNKNOWN', retryable: false });
    expect(sanitizedMessage('AUTH_REQUIRED')).not.toMatch(/token|key/i);
  });

  it('result de erro vira failed com código classificado e mensagem sem conteúdo', async () => {
    const sc: Scenario = async function* (ctl) {
      yield init(ctl);
      yield { type: 'assistant', error: 'authentication_failed', message: { content: [] } };
      yield result({ subtype: 'error_during_execution', is_error: true, errors: ['detalhe com sk-ant-api03-ABCDEFGHIJKL'] });
      await ctl.promptClosed;
    };
    const { runner, events, go } = setup({ scenario: sc });
    await go(); await runner.idle();
    expect(events.at(-1)).toMatchObject({ type: 'failed', payload: { code: 'AUTH_REQUIRED', retryable: false } });
    expect(JSON.stringify(events)).not.toContain('ABCDEFGHIJKL');
  });
});

describe('resumo seguro de ferramentas', () => {
  it('só alvo/primeiro token; nunca conteúdo, edição ou argumentos', () => {
    expect(summarizeToolUse('Write', { file_path: 'C:/ws/sub/a.txt', content: 'SEGREDO' })).toBe('Write a.txt');
    expect(summarizeToolUse('Edit', { file_path: '/x/y.ts', old_string: 'A', new_string: 'B' })).toBe('Edit y.ts');
    expect(summarizeToolUse('Bash', { command: 'curl -H "Authorization: Bearer abc" https://x' })).toBe('Bash curl');
    expect(summarizeToolUse('Grep', { pattern: 'senha' })).toBe('Grep');
  });
});
