import { describe, expect, it } from 'vitest';
import type { BridgeEvent, ProviderEventBody } from './contract';
import { BridgeError, BridgeManager, MAX_HISTORY } from './manager';
import type { AgentProvider, ProviderSession, ProviderSink } from './types';

class FakeSession implements ProviderSession {
  sent: string[] = [];
  permissionAnswers: [string, boolean][] = [];
  closed = false;
  interrupted = 0;
  onSend: (text: string) => void = () => {};
  /** O que o interrupt() do provider emite (o real emite o cancelamento) */
  onInterrupt: () => void = () => {};
  constructor(readonly sink: ProviderSink) {}
  send(text: string) { this.sent.push(text); this.onSend(text); }
  respondPermission(id: string, allow: boolean) { this.permissionAnswers.push([id, allow]); }
  async interrupt() { this.interrupted++; this.onInterrupt(); }
  close() { this.closed = true; }
}

class FakeProvider implements AgentProvider {
  readonly id = 'fake';
  readonly displayName = 'Fake';
  available = true;
  session!: FakeSession;
  async checkAvailability() { return this.available ? { available: true } : { available: false, reason: 'indisponível' }; }
  async listSessions() { return [{ id: 's1', title: 'antiga', lastModified: 1 }]; }
  async start(_o: { cwd: string; resumeId?: string }, sink: ProviderSink) {
    this.session = new FakeSession(sink);
    return this.session;
  }
}

function setup() {
  const provider = new FakeProvider();
  const bridge = new BridgeManager([provider], { log: () => {} });
  const events: BridgeEvent[] = [];
  bridge.onEvent((e) => events.push(e));
  const states = () => events.filter((e) => e.type === 'state').map((e) => (e as { state: string }).state);
  const emit = (e: ProviderEventBody) => provider.session.sink(e);
  return { provider, bridge, events, states, emit };
}

describe('BridgeManager', () => {
  it('fluxo feliz: starting -> idle -> running -> done, com histórico', async () => {
    const { bridge, events, states, emit } = setup();
    const h = await bridge.start('fake', { cwd: '/tmp/proj' });
    emit({ type: 'session', sessionId: 'x', cwdLabel: 'proj', model: 'm' });
    bridge.send(h, 'oi');
    emit({ type: 'text-delta', text: 'ol' });
    emit({ type: 'tool', name: 'Read', summary: 'a.ts' });
    emit({ type: 'message', role: 'assistant', text: 'olá' });
    emit({ type: 'turn-end', outcome: 'done' });

    expect(states()).toEqual(['starting', 'idle', 'running', 'done']);
    expect(events.every((e) => e.handle === h)).toBe(true);
    const snap = bridge.snapshot()[0]!;
    expect(snap.state).toBe('done');
    expect(snap.model).toBe('m');
    expect(snap.cwdLabel).toBe('proj');
    expect(snap.partial).toBe('');
    expect(snap.history).toEqual([
      { role: 'user', text: 'oi' }, { role: 'tool', text: 'Read: a.ts' }, { role: 'assistant', text: 'olá' },
    ]);
    // pode mandar outra mensagem depois de concluir
    bridge.send(h, 'de novo');
    expect(bridge.snapshot()[0]!.state).toBe('running');
  });

  it('start que falha emite starting e closed', async () => {
    const { bridge, provider, states } = setup();
    provider.start = async () => { throw new Error('x'); };
    await expect(bridge.start('fake', { cwd: '/x' })).rejects.toThrow(BridgeError);
    expect(states()).toEqual(['starting', 'closed']);
    expect(bridge.snapshot()).toEqual([]);
  });

  it('send durante running é rejeitado', async () => {
    const { bridge, provider } = setup();
    const h = await bridge.start('fake', { cwd: '/x' });
    bridge.send(h, 'a');
    expect(() => bridge.send(h, 'b')).toThrow(BridgeError);
    expect(provider.session.sent).toEqual(['a']);
  });

  it('provider indisponível não inicia sessão', async () => {
    const { bridge, provider } = setup();
    provider.available = false;
    await expect(bridge.start('fake', { cwd: '/x' })).rejects.toThrow('indisponível');
    expect(bridge.snapshot()).toEqual([]);
    await expect(bridge.start('nope', { cwd: '/x' })).rejects.toThrow(BridgeError);
  });

  it('erro permite reenvio', async () => {
    const { bridge, emit, states } = setup();
    const h = await bridge.start('fake', { cwd: '/x' });
    bridge.send(h, 'a');
    emit({ type: 'turn-end', outcome: 'error', message: 'falhou' });
    expect(bridge.snapshot()[0]!.state).toBe('error');
    expect(bridge.snapshot()[0]!.history.at(-1)).toEqual({ role: 'system', text: 'falhou' });
    bridge.send(h, 'b');
    emit({ type: 'turn-end', outcome: 'done' });
    expect(states().slice(-3)).toEqual(['error', 'running', 'done']);
  });

  it('falha síncrona do provider no send vira erro', async () => {
    const { bridge, provider } = setup();
    const h = await bridge.start('fake', { cwd: '/x' });
    provider.session.onSend = () => { throw new Error('boom'); };
    bridge.send(h, 'a');
    expect(bridge.snapshot()[0]!.state).toBe('error');
  });

  it('permissão: pede, responde e volta a running', async () => {
    const { bridge, provider, emit, events } = setup();
    const h = await bridge.start('fake', { cwd: '/x' });
    bridge.send(h, 'a');
    emit({ type: 'permission-request', id: 'p1', toolName: 'Bash', detail: 'ls', outsideCwd: false });
    expect(bridge.snapshot()[0]!.state).toBe('waiting-permission');
    expect(bridge.snapshot()[0]!.permissions).toHaveLength(1);
    expect(() => bridge.respondPermission(h, 'zzz', true)).toThrow(BridgeError);
    bridge.respondPermission(h, 'p1', true);
    expect(provider.session.permissionAnswers).toEqual([['p1', true]]);
    expect(bridge.snapshot()[0]!.state).toBe('running');
    expect(events.some((e) => e.type === 'permission-resolved' && e.allow)).toBe(true);
    // segunda resposta ao mesmo pedido é rejeitada
    expect(() => bridge.respondPermission(h, 'p1', true)).toThrow(BridgeError);
  });

  it('cancelamento: nega permissões pendentes, interrompe e termina em cancelled', async () => {
    const { bridge, provider, emit, events, states } = setup();
    const h = await bridge.start('fake', { cwd: '/x' });
    bridge.send(h, 'a');
    emit({ type: 'permission-request', id: 'p1', toolName: 'Write', detail: '/x/a', outsideCwd: false });
    await bridge.interrupt(h);
    expect(provider.session.permissionAnswers).toEqual([['p1', false]]);
    expect(provider.session.interrupted).toBe(1);
    expect(bridge.snapshot()[0]!.state).toBe('cancelled');
    expect(bridge.snapshot()[0]!.permissions).toEqual([]);
    expect(states().at(-1)).toBe('cancelled');
    expect(events.filter((e) => e.type === 'turn-end')).toEqual([{ type: 'turn-end', outcome: 'cancelled', handle: h }]);
    // eventos tardios do turno cancelado são descartados
    emit({ type: 'message', role: 'assistant', text: 'tarde' });
    emit({ type: 'turn-end', outcome: 'done' });
    expect(bridge.snapshot()[0]!.state).toBe('cancelled');
    expect(bridge.snapshot()[0]!.history.some((x) => x.text === 'tarde')).toBe(false);
    bridge.send(h, 'depois');
    expect(bridge.snapshot()[0]!.state).toBe('running');
  });

  it('cancelamento quando o provider já emite o turn-end cancelled', async () => {
    const { bridge, provider, emit, events } = setup();
    const h = await bridge.start('fake', { cwd: '/x' });
    bridge.send(h, 'a');
    provider.session.onInterrupt = () => emit({ type: 'turn-end', outcome: 'cancelled' });
    await bridge.interrupt(h);
    expect(events.filter((e) => e.type === 'turn-end')).toHaveLength(1);
    expect(bridge.snapshot()[0]!.state).toBe('cancelled');
  });

  it('interrupt que só retorna após o timeout do provider: interrupting volta a false e send funciona', async () => {
    const { bridge, provider } = setup();
    const h = await bridge.start('fake', { cwd: '/x' });
    bridge.send(h, 'a');
    provider.session.interrupt = () => new Promise<void>((r) => setTimeout(r, 20));
    await bridge.interrupt(h);
    expect(bridge.snapshot()[0]!.state).toBe('cancelled');
    expect(() => bridge.send(h, 'b')).not.toThrow();
    expect(bridge.snapshot()[0]!.state).toBe('running');
  });

  it('describe devolve só provider e rótulo da pasta', async () => {
    const { bridge } = setup();
    const h = await bridge.start('fake', { cwd: '/tmp/proj' });
    expect(bridge.describe(h)).toEqual({ providerId: 'fake', cwdLabel: 'proj' });
    expect(bridge.describe('nao-existe')).toBeUndefined();
  });

  it('interrupt fora de turno é rejeitado', async () => {
    const { bridge } = setup();
    const h = await bridge.start('fake', { cwd: '/x' });
    await expect(bridge.interrupt(h)).rejects.toThrow(BridgeError);
  });

  it('close encerra a sessão do provider e remove do snapshot', async () => {
    const { bridge, provider, states } = setup();
    const h = await bridge.start('fake', { cwd: '/x' });
    bridge.close(h);
    expect(provider.session.closed).toBe(true);
    expect(bridge.snapshot()).toEqual([]);
    expect(states().at(-1)).toBe('closed');
    expect(() => bridge.send(h, 'a')).toThrow(BridgeError);
    bridge.close(h); // idempotente
  });

  it('closeAll fecha todas', async () => {
    const { bridge } = setup();
    await bridge.start('fake', { cwd: '/a' });
    await bridge.start('fake', { cwd: '/b' });
    bridge.closeAll();
    expect(bridge.snapshot()).toEqual([]);
  });

  it('histórico limitado', async () => {
    const { bridge, emit } = setup();
    const h = await bridge.start('fake', { cwd: '/x' });
    bridge.send(h, 'a');
    for (let i = 0; i < MAX_HISTORY + 50; i++) emit({ type: 'tool', name: 'T', summary: String(i) });
    const hist = bridge.snapshot()[0]!.history;
    expect(hist).toHaveLength(MAX_HISTORY);
    expect(hist.at(-1)!.text).toBe(`T: ${MAX_HISTORY + 49}`);
  });

  it('logs não contêm o texto das conversas', async () => {
    const lines: string[] = [];
    const provider = new FakeProvider();
    const bridge = new BridgeManager([provider], { log: (l) => lines.push(l) });
    const h = await bridge.start('fake', { cwd: '/x' });
    bridge.send(h, 'SEGREDO-do-prompt');
    provider.session.sink({ type: 'message', role: 'assistant', text: 'SEGREDO-resposta' });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toMatch(/SEGREDO/);
  });

  it('lista providers e sessões', async () => {
    const { bridge, provider } = setup();
    expect(await bridge.listProviders()).toEqual([{ id: 'fake', displayName: 'Fake', available: true }]);
    provider.available = false;
    expect(await bridge.listProviders()).toEqual([{ id: 'fake', displayName: 'Fake', available: false, reason: 'indisponível' }]);
    expect(await bridge.listSessions('fake', '/x')).toHaveLength(1);
  });
});
