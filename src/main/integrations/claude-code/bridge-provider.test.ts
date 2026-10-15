import path from 'node:path';
import type { Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { ProviderEventBody } from '../../../shared/bridge';
import { API_KEY_REASON, createClaudeCodeProvider, describePermission, MAX_TURNS, type QueryFn } from './bridge-provider';

/** Query roteirizada: o teste empurra as mensagens que o SDK emitiria */
class FakeQuery {
  private items: SDKMessage[] = [];
  private wake: (() => void) | null = null;
  private failure: Error | null = null;
  private finished = false;
  interrupt = vi.fn(async () => { this.onInterrupt(); });
  close = vi.fn(() => { this.finished = true; this.wake?.(); });
  onInterrupt: () => void = () => {};
  push(m: unknown) { this.items.push(m as SDKMessage); this.wake?.(); }
  endNow() { this.finished = true; this.wake?.(); }
  fail(e: Error) { this.failure = e; this.wake?.(); }
  async *[Symbol.asyncIterator](): AsyncGenerator<SDKMessage> {
    while (true) {
      if (this.failure) throw this.failure;
      const m = this.items.shift();
      if (m) { yield m; continue; }
      if (this.finished) return;
      await new Promise<void>((r) => { this.wake = r; });
    }
  }
}

const init = (...src: [] | [unknown]) => ({
  type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-x',
  ...(src.length ? { apiKeySource: src[0] } : { apiKeySource: 'ANTHROPIC_API_KEY' }),
});
const delta = (text: string) =>
  ({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
const assistant = (content: unknown[]) => ({ type: 'assistant', parent_tool_use_id: null, message: { content } });
const result = (over: Record<string, unknown> = {}) => ({ type: 'result', subtype: 'success', is_error: false, result: '', ...over });

const CWD = path.resolve('proj');

function setup(overrides: { env?: NodeJS.ProcessEnv; exe?: string | null } = {}) {
  const fq = new FakeQuery();
  let captured: { prompt: AsyncIterable<SDKUserMessage>; options: Options } | null = null;
  const queryFn: QueryFn = (params) => { captured = params; return fq as unknown as Query; };
  const loadQuery = vi.fn(async () => queryFn);
  const provider = createClaudeCodeProvider({
    loadQuery,
    findExecutable: async () => (overrides.exe === undefined ? '/bin/claude' : overrides.exe),
    listSessions: async () => [{ id: 'a', title: 't', lastModified: 1 }],
    env: overrides.env ?? { ANTHROPIC_API_KEY: 'sk-test-nao-real' },
  });
  const events: ProviderEventBody[] = [];
  const sink = (e: ProviderEventBody) => events.push(e);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { fq, provider, events, sink, tick, loadQuery, captured: () => captured! };
}

describe('provider: disponibilidade', () => {
  it('sem ANTHROPIC_API_KEY: indisponível com o motivo', async () => {
    const { provider } = setup({ env: {} });
    expect(await provider.checkAvailability()).toEqual({ available: false, reason: API_KEY_REASON });
    expect((await setup({ env: { ANTHROPIC_API_KEY: '  ' } }).provider.checkAvailability()).available).toBe(false);
  });

  it('sem executável no PATH: indisponível', async () => {
    const { provider } = setup({ exe: null });
    const a = await provider.checkAvailability();
    expect(a.available).toBe(false);
    expect(a.reason).toMatch(/PATH/);
  });

  it('com chave e executável: disponível', async () => {
    expect(await setup().provider.checkAvailability()).toEqual({ available: true });
  });

  it('start recusa sem chave ou sem executável (sem chamar o SDK)', async () => {
    const a = setup({ env: {} });
    await expect(a.provider.start({ cwd: CWD }, a.sink)).rejects.toThrow();
    expect(a.loadQuery).not.toHaveBeenCalled();
    const b = setup({ exe: null });
    await expect(b.provider.start({ cwd: CWD }, b.sink)).rejects.toThrow();
  });

  it('lista sessões', async () => {
    expect(await setup().provider.listSessions(CWD)).toEqual([{ id: 'a', title: 't', lastModified: 1 }]);
  });
});

describe('provider: sessão', () => {
  it('passa exatamente as opções fixas (sem bypass, sem updatedPermissions)', async () => {
    const t = setup();
    await t.provider.start({ cwd: CWD }, t.sink);
    expect(t.captured().options).toEqual({
      cwd: CWD,
      pathToClaudeCodeExecutable: '/bin/claude',
      permissionMode: 'default',
      settingSources: [],
      includePartialMessages: true,
      maxTurns: MAX_TURNS,
      canUseTool: expect.any(Function),
    });
    const r = setup();
    await r.provider.start({ cwd: CWD, resumeId: 'abc' }, r.sink);
    expect(r.captured().options.resume).toBe('abc');
  });

  it('envia o prompt como mensagem de usuário e mapeia a sequência de eventos', async () => {
    const t = setup();
    const s = await t.provider.start({ cwd: CWD }, t.sink);
    await s.send('olá');
    const it = t.captured().prompt[Symbol.asyncIterator]();
    expect((await it.next()).value).toEqual({
      type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'olá' }] }, parent_tool_use_id: null,
    });
    t.fq.push(init());
    t.fq.push(delta('Oi'));
    t.fq.push(delta(' você'));
    t.fq.push(assistant([{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }]));
    t.fq.push(assistant([{ type: 'text', text: 'Oi você' }]));
    t.fq.push(result({ result: 'Oi você' }));
    await t.tick();
    expect(t.events).toEqual([
      { type: 'session', sessionId: 'sess-1', cwdLabel: 'proj', model: 'claude-x' },
      { type: 'text-delta', text: 'Oi' },
      { type: 'text-delta', text: ' você' },
      { type: 'tool', name: 'Bash', summary: 'ls', activity: 'terminal' },
      { type: 'message', role: 'assistant', text: 'Oi você' },
      { type: 'turn-end', outcome: 'done' },
    ]);
  });

  it('resultado de sucesso sem texto de assistant usa result como mensagem', async () => {
    const t = setup();
    const s = await t.provider.start({ cwd: CWD }, t.sink);
    await s.send('x');
    t.fq.push(init());
    t.fq.push(result({ result: 'ok' }));
    await t.tick();
    expect(t.events.slice(-2)).toEqual([{ type: 'message', role: 'assistant', text: 'ok' }, { type: 'turn-end', outcome: 'done' }]);
  });

  it('result de erro vira turn-end error', async () => {
    const t = setup();
    const s = await t.provider.start({ cwd: CWD }, t.sink);
    await s.send('x');
    t.fq.push(init());
    t.fq.push(result({ subtype: 'error_max_turns', is_error: true }));
    await t.tick();
    expect(t.events.at(-1)).toEqual({ type: 'turn-end', outcome: 'error', message: expect.stringContaining('error_max_turns') });
  });

  it('iterador que lança vira turn-end error', async () => {
    const t = setup();
    const s = await t.provider.start({ cwd: CWD }, t.sink);
    await s.send('x');
    t.fq.fail(new Error('processo caiu'));
    await t.tick();
    expect(t.events.at(-1)).toMatchObject({ type: 'turn-end', outcome: 'error' });
    // sessão morta: novo send avisa em vez de ficar pendurado
    t.events.length = 0;
    await s.send('y');
    expect(t.events).toEqual([{ type: 'turn-end', outcome: 'error', message: expect.any(String) }]);
  });
});

describe('provider: autenticação', () => {
  it.each([['none'], [undefined], ['oauth'], ['/login managed key']])(
    'apiKeySource %s: fecha a query e emite erro, sem seguir',
    async (src) => {
      const t = setup();
      const s = await t.provider.start({ cwd: CWD }, t.sink);
      await s.send('x');
      t.fq.push(init(src));
      t.fq.push(delta('vazou'));
      await t.tick();
      expect(t.fq.close).toHaveBeenCalled();
      expect(t.events).toEqual([{ type: 'turn-end', outcome: 'error', message: expect.stringContaining('ANTHROPIC_API_KEY') }]);
    },
  );
});

describe('provider: permissões', () => {
  async function pending() {
    const t = setup();
    const s = await t.provider.start({ cwd: CWD }, t.sink);
    await s.send('x');
    const canUseTool = t.captured().options.canUseTool!;
    const ac = new AbortController();
    const res = canUseTool('Bash', { command: 'rm -rf build && echo muito longo' }, { signal: ac.signal, toolUseID: 'tu1' } as never);
    const req = t.events.find((e) => e.type === 'permission-request') as Extract<ProviderEventBody, { type: 'permission-request' }>;
    return { t, s, res, req, ac, canUseTool };
  }

  it('pedido mostra o comando completo e permite', async () => {
    const { s, res, req } = await pending();
    expect(req).toMatchObject({ toolName: 'Bash', detail: 'rm -rf build && echo muito longo', outsideCwd: false });
    s.respondPermission(req.id, true);
    // sem updatedPermissions ("sempre permitir")
    expect(await res).toEqual({ behavior: 'allow' });
    s.respondPermission(req.id, false); // já respondido: ignorado
  });

  it('recusar nega', async () => {
    const { s, res, req } = await pending();
    s.respondPermission(req.id, false);
    expect(await res).toMatchObject({ behavior: 'deny' });
  });

  it('abort do signal nega e avisa', async () => {
    const { t, res, ac, req } = await pending();
    ac.abort();
    expect(await res).toMatchObject({ behavior: 'deny' });
    expect(t.events.at(-1)).toEqual({ type: 'permission-resolved', id: req.id, allow: false });
  });

  it('signal já abortado nega sem pedir', async () => {
    const { t, canUseTool } = await pending();
    const ac = new AbortController();
    ac.abort();
    const before = t.events.length;
    expect(await canUseTool('Bash', { command: 'x' }, { signal: ac.signal } as never)).toMatchObject({ behavior: 'deny' });
    expect(t.events.length).toBe(before);
  });

  it('describePermission: arquivo absoluto, fora do projeto, JSON truncado', () => {
    const inside = describePermission('Write', { file_path: 'a/b.ts' }, CWD);
    expect(inside).toEqual({ detail: path.join(CWD, 'a', 'b.ts'), outsideCwd: false });
    expect(describePermission('Edit', { file_path: path.resolve(CWD, '..', 'x.ts') }, CWD).outsideCwd).toBe(true);
    expect(describePermission('Read', { file_path: path.join(CWD, '..x') }, CWD).outsideCwd).toBe(false);
    expect(describePermission('NotebookEdit', { notebook_path: path.resolve(CWD, '..', 'n.ipynb') }, CWD).outsideCwd).toBe(true);
    const big = describePermission('WebFetch', { url: 'x'.repeat(5000) }, CWD);
    expect(big.detail.length).toBeLessThanOrEqual(2001);
    expect(big.detail.startsWith('{"url":"xxx')).toBe(true);
  });
});

describe('provider: interrupt e close', () => {
  it('interrupt que estoura o tempo inutiliza a sessão e fecha a query', async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const s = await t.provider.start({ cwd: CWD }, t.sink);
      await s.send('x');
      const p = s.interrupt();
      await vi.advanceTimersByTimeAsync(6000);
      await p;
      expect(t.fq.close).toHaveBeenCalled();
      t.events.length = 0;
      await s.send('y');
      expect(t.events).toEqual([{ type: 'turn-end', outcome: 'error', message: 'A sessão do agente foi encerrada.' }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('iterador que termina com a sessão ociosa mata a sessão', async () => {
    const t = setup();
    const s = await t.provider.start({ cwd: CWD }, t.sink);
    t.fq.close.mockImplementation(() => {});
    t.fq.endNow();
    await t.tick();
    expect(t.events).toEqual([]);
    await s.send('y');
    expect(t.events).toEqual([{ type: 'turn-end', outcome: 'error', message: 'A sessão do agente foi encerrada.' }]);
  });

  it('interrupt nega permissões, chama q.interrupt e termina em cancelled', async () => {
    const t = setup();
    const s = await t.provider.start({ cwd: CWD }, t.sink);
    await s.send('x');
    t.fq.push(init());
    await t.tick();
    const res = t.captured().options.canUseTool!('Write', { file_path: 'a.txt' }, { signal: new AbortController().signal } as never);
    // o SDK encerra o turno com um result depois do interrupt
    t.fq.onInterrupt = () => t.fq.push(result({ subtype: 'error_during_execution', is_error: true }));
    await s.interrupt();
    expect(t.fq.interrupt).toHaveBeenCalledTimes(1);
    expect(await res).toMatchObject({ behavior: 'deny' });
    expect(t.events.filter((e) => e.type === 'turn-end')).toEqual([{ type: 'turn-end', outcome: 'cancelled' }]);
    // o turno seguinte funciona normalmente
    await s.send('de novo');
    t.fq.push(result({ result: 'feito' }));
    await t.tick();
    expect(t.events.at(-1)).toEqual({ type: 'turn-end', outcome: 'done' });
  });

  it('interrupt cancela mesmo se o SDK não mandar result', async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const s = await t.provider.start({ cwd: CWD }, t.sink);
      await s.send('x');
      const p = s.interrupt();
      await vi.advanceTimersByTimeAsync(6000);
      await p;
      expect(t.events.at(-1)).toEqual({ type: 'turn-end', outcome: 'cancelled' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('interrupt que nunca resolve e turno que não termina: resolve no timeout, cancela e a sessão fica morta', async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const s = await t.provider.start({ cwd: CWD }, t.sink);
      await s.send('x');
      t.fq.interrupt.mockImplementation(() => new Promise<void>(() => {}));
      let done = false;
      const p = s.interrupt().then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(4900);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      await p;
      expect(t.events.at(-1)).toEqual({ type: 'turn-end', outcome: 'cancelled' });
      expect(t.fq.close).toHaveBeenCalled();
      await s.send('y');
      expect(t.events.at(-1)).toEqual({ type: 'turn-end', outcome: 'error', message: 'A sessão do agente foi encerrada.' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('interrupt que nunca resolve mas o result chega: resolve antes do timeout e a sessão segue viva', async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const s = await t.provider.start({ cwd: CWD }, t.sink);
      await s.send('x');
      t.fq.interrupt.mockImplementation(() => new Promise<void>(() => {}));
      let done = false;
      const p = s.interrupt().then(() => { done = true; });
      t.fq.push(result({ subtype: 'error_during_execution', is_error: true }));
      await vi.advanceTimersByTimeAsync(100);
      await p;
      expect(done).toBe(true);
      expect(t.events.at(-1)).toEqual({ type: 'turn-end', outcome: 'cancelled' });
      expect(t.fq.close).not.toHaveBeenCalled();
      await s.send('y');
      expect(t.events.at(-1)).toEqual({ type: 'turn-end', outcome: 'cancelled' });
      t.fq.push(result({ result: 'ok' }));
      await vi.advanceTimersByTimeAsync(10);
      expect(t.events.at(-1)).toEqual({ type: 'turn-end', outcome: 'done' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('interrupt que rejeita: resolve sem esperar o timeout e a sessão fica morta', async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const s = await t.provider.start({ cwd: CWD }, t.sink);
      await s.send('x');
      t.fq.interrupt.mockImplementation(async () => { throw new Error('falhou'); });
      const p = s.interrupt();
      await vi.advanceTimersByTimeAsync(10);
      await p;
      expect(t.events.at(-1)).toEqual({ type: 'turn-end', outcome: 'cancelled' });
      expect(t.fq.close).toHaveBeenCalled();
      await s.send('y');
      expect(t.events.at(-1)).toEqual({ type: 'turn-end', outcome: 'error', message: 'A sessão do agente foi encerrada.' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('close encerra a query, nega pendências e não emite erro', async () => {
    const t = setup();
    const s = await t.provider.start({ cwd: CWD }, t.sink);
    await s.send('x');
    const res = t.captured().options.canUseTool!('Bash', { command: 'ls' }, { signal: new AbortController().signal } as never);
    s.close();
    expect(await res).toMatchObject({ behavior: 'deny' });
    expect(t.fq.close).toHaveBeenCalled();
    await t.tick();
    expect(t.events.some((e) => e.type === 'turn-end')).toBe(false);
  });
});
