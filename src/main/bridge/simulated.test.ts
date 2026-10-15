import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeEvent, BridgeState } from '../../shared/bridge';
import { BridgeManager } from './manager';
import { createSimulatedProvider, SIM_PROVIDER_ID, SIM_REPLY } from './simulated';

const TICK = 150;

async function setup() {
  const bridge = new BridgeManager([createSimulatedProvider({ tickMs: TICK })], { log: () => {} });
  const events: BridgeEvent[] = [];
  bridge.onEvent((e) => events.push(e));
  const handle = await bridge.start(SIM_PROVIDER_ID, { cwd: '/tmp/teracota-sim-x' });
  const states = (): BridgeState[] => events.flatMap((e) => (e.type === 'state' ? [e.state] : []));
  const run = (ms: number) => vi.advanceTimersByTimeAsync(ms);
  return { bridge, events, handle, states, run, snap: () => bridge.snapshot()[0]! };
}

describe('provider simulado', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('descritor: simulado, sempre disponível, sem sessões anteriores', async () => {
    const bridge = new BridgeManager([createSimulatedProvider()], { log: () => {} });
    expect(await bridge.listProviders()).toEqual([
      { id: 'simulado', displayName: 'Simulação (sem agente)', available: true, simulated: true },
    ]);
    expect(await bridge.listSessions('simulado', '/x')).toEqual([]);
  });

  it('start emite a sessão simulada', async () => {
    const { events, handle } = await setup();
    expect(events.find((e) => e.type === 'session')).toMatchObject({
      type: 'session', cwdLabel: 'teracota-sim-x', model: 'simulado', handle,
    });
  });

  it('roteiro padrão: ferramenta fictícia, ~8 deltas, mensagem e done; texto do usuário não é ecoado', async () => {
    const { bridge, events, handle, states, run, snap } = await setup();
    bridge.send(handle, 'segredo-do-usuario');
    await run(TICK * 20);
    expect(states()).toEqual(['starting', 'idle', 'running', 'done']);
    const tool = events.find((e) => e.type === 'tool');
    expect(tool).toMatchObject({ name: 'Simulação', summary: '[simulado] etapa fictícia', activity: 'reading' });
    const deltas = events.filter((e) => e.type === 'text-delta');
    expect(deltas).toHaveLength(8);
    expect(deltas.map((d) => (d as { text: string }).text).join('')).toBe(SIM_REPLY);
    const assistant = snap().history.filter((h) => h.role === 'assistant');
    expect(assistant).toEqual([{ role: 'assistant', text: SIM_REPLY }]);
    // o texto do usuário só aparece como mensagem do próprio usuário
    const echoed = events.filter((e) => JSON.stringify(e).includes('segredo-do-usuario'));
    expect(echoed.every((e) => e.type === 'message' && e.role === 'user')).toBe(true);
  });

  it('/permissao: pede, Permitir conclui com texto fixo', async () => {
    const { bridge, events, handle, states, run, snap } = await setup();
    bridge.send(handle, ' /permissao ');
    await run(TICK);
    expect(snap().state).toBe('waiting-permission');
    const req = snap().permissions[0]!;
    expect(req).toMatchObject({ toolName: 'Simulação', detail: '[simulado] pedido fictício — nada será executado', outsideCwd: false });
    bridge.respondPermission(handle, req.id, true);
    await run(TICK * 5);
    expect(states()).toEqual(['starting', 'idle', 'running', 'waiting-permission', 'running', 'done']);
    expect(snap().history.at(-1)).toEqual({ role: 'assistant', text: '[simulado] permitido; nenhuma ação real executada' });
    expect(events.some((e) => e.type === 'permission-resolved' && e.allow)).toBe(true);
  });

  it('/permissao: Recusar conclui com texto de recusa', async () => {
    const { bridge, handle, run, snap } = await setup();
    bridge.send(handle, '/permissao');
    await run(TICK);
    bridge.respondPermission(handle, snap().permissions[0]!.id, false);
    await run(TICK * 5);
    expect(snap().state).toBe('done');
    expect(snap().history.at(-1)).toEqual({ role: 'assistant', text: '[simulado] recusado' });
  });

  it('/erro termina em error com mensagem fixa', async () => {
    const { bridge, handle, run, snap, states } = await setup();
    bridge.send(handle, '/erro');
    await run(TICK * 2);
    expect(states().at(-1)).toBe('error');
    expect(snap().history.at(-1)).toEqual({ role: 'system', text: '[simulado] erro sob comando' });
  });

  it('/lento emite ~60 deltas a cada 250ms e pode ser interrompido (cancelled)', async () => {
    const { bridge, events, handle, run, snap, states } = await setup();
    bridge.send(handle, '/lento');
    await run(250 * 10 + 10);
    const count = () => events.filter((e) => e.type === 'text-delta').length;
    expect(count()).toBeGreaterThanOrEqual(8);
    expect(count()).toBeLessThan(60);
    await bridge.interrupt(handle);
    const after = count();
    await run(250 * 100);
    expect(count()).toBe(after);
    expect(snap().state).toBe('cancelled');
    expect(states().at(-1)).toBe('cancelled');
    // o timer do roteiro foi limpo: nenhum evento tardio
    expect(events.filter((e) => e.type === 'turn-end')).toHaveLength(1);
  });

  it('/lento completo: 60 deltas e done', async () => {
    const { bridge, events, handle, run, snap } = await setup();
    bridge.send(handle, '/lento');
    await run(250 * 70);
    expect(events.filter((e) => e.type === 'text-delta')).toHaveLength(60);
    expect(snap().state).toBe('done');
  });

  it('interromper com permissão pendente nega e cancela', async () => {
    const { bridge, handle, run, snap } = await setup();
    bridge.send(handle, '/permissao');
    await run(TICK);
    await bridge.interrupt(handle);
    expect(snap().state).toBe('cancelled');
    expect(snap().permissions).toEqual([]);
    await run(TICK * 10);
    expect(snap().state).toBe('cancelled');
  });

  it('/desconectar: erro e envios seguintes também dão erro', async () => {
    const { bridge, handle, run, snap } = await setup();
    bridge.send(handle, '/desconectar');
    await run(TICK * 2);
    expect(snap().state).toBe('error');
    expect(snap().history.at(-1)).toEqual({ role: 'system', text: '[simulado] agente desconectado' });
    bridge.send(handle, 'oi');
    await run(0);
    expect(snap().state).toBe('error');
    expect(snap().history.at(-1)!.role).toBe('system');
    expect(snap().history.at(-1)!.text).toMatch(/\[simulado\]/);
  });

  it('close limpa os timers', async () => {
    const { bridge, handle } = await setup();
    bridge.send(handle, '/lento');
    bridge.close(handle);
    expect(vi.getTimerCount()).toBe(0);
  });
});
