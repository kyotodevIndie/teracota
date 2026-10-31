import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanionEvent } from '../shared/protocol';
import type { AgentAdapter, ConnectResult, ConnectStatus } from './integrations/types';

const clipboard = { text: '', writeText: (t: string) => { clipboard.text = t; } };
vi.mock('electron', () => ({ clipboard }));

/** Adapter de mentira, com conexão controlável pelo teste */
const fake = {
  status: 'available' as ConnectStatus,
  runResult: { ok: true } as ConnectResult,
  speechOn: false,
  runs: 0,
};

const adapter: AgentAdapter = {
  id: 'agente-x',
  displayName: 'Agente X',
  capabilities: {
    sessions: true, toolEvents: true, fileEvents: false, permissions: true,
    errors: true, completion: true, messages: false, mcp: true,
  },
  routes: ['/integrations/agente-x'],
  toSignal: () => null,
  connect: {
    label: 'Conectar ao Agente X',
    manualCommand: 'agente-x connect',
    run: async () => { fake.runs++; return fake.runResult; },
    status: async () => fake.status,
    openSessions: { command: '/recarregar' },
    speech: {
      enable: async () => { fake.speechOn = true; return { ok: true }; },
      disable: async () => { fake.speechOn = false; return { ok: true }; },
      enabled: async () => fake.speechOn,
    },
  },
};

vi.mock('./integrations', () => ({ ADAPTERS: [adapter] }));

const flow = await import('./connect-flow');

/** EntityManager de mentira: só o que o fluxo usa */
function fakeManager(connectOffered = false) {
  const said: CompanionEvent[] = [];
  return {
    said,
    connectOffered,
    markConnectOffered() { this.connectOffered = true; },
    setVisible: vi.fn(),
    broadcast: (e: CompanionEvent) => said.push(e),
  };
}
type FakeManager = ReturnType<typeof fakeManager>;
const asManager = (m: FakeManager) => m as unknown as Parameters<typeof flow.connectAgent>[0];

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(fake, { status: 'available', runResult: { ok: true }, speechOn: false, runs: 0 });
  clipboard.text = '';
});

describe('oferta de conexão', () => {
  it('agente instalado e não conectado: a Tera oferece e marca que ofereceu', async () => {
    const m = fakeManager();
    await flow.offerConnection(asManager(m));
    expect(m.said.at(-1)?.say).toContain('Achei o Agente X');
    expect(m.connectOffered).toBe(true);
  });

  it('o clique dentro do prazo aceita a oferta e conecta', async () => {
    const m = fakeManager();
    await flow.offerConnection(asManager(m));
    flow.onTeraClicked(asManager(m));
    await vi.runAllTimersAsync();
    expect(fake.runs).toBe(1);
  });

  it('clique depois do prazo não instala nada', async () => {
    const m = fakeManager();
    await flow.offerConnection(asManager(m));
    vi.advanceTimersByTime(3 * 60 * 1000);
    flow.onTeraClicked(asManager(m));
    await vi.runAllTimersAsync();
    expect(fake.runs).toBe(0);
  });

  it('clique sem oferta pendente não faz nada', async () => {
    flow.onTeraClicked(asManager(fakeManager()));
    await vi.runAllTimersAsync();
    expect(fake.runs).toBe(0);
  });

  it('já conectado: não oferece, mas marca pra não checar de novo', async () => {
    fake.status = 'connected';
    const m = fakeManager();
    await flow.offerConnection(asManager(m));
    expect(m.said).toHaveLength(0);
    expect(m.connectOffered).toBe(true);
  });

  it('agente não instalado: não oferece nem marca (pode instalar depois)', async () => {
    fake.status = 'unavailable';
    const m = fakeManager();
    await flow.offerConnection(asManager(m));
    expect(m.said).toHaveLength(0);
    expect(m.connectOffered).toBe(false);
  });

  it('só oferece uma vez por instalação', async () => {
    const m = fakeManager(true);
    await flow.offerConnection(asManager(m));
    expect(m.said).toHaveLength(0);
  });
});

describe('conectar', () => {
  it('sucesso: já copia o comando pras sessões abertas', async () => {
    const m = fakeManager();
    await flow.connectAgent(asManager(m), adapter);
    expect(clipboard.text).toBe('/recarregar');
    expect(m.said.at(-1)).toMatchObject({ state: 'happy' });
    expect(m.said.at(-1)?.say).toContain('/recarregar');
  });

  it('agente não encontrado: copia o comando manual', async () => {
    fake.runResult = { ok: false, reason: 'not-found', output: '' };
    const m = fakeManager();
    await flow.connectAgent(asManager(m), adapter);
    expect(clipboard.text).toBe('agente-x connect');
    expect(m.said.at(-1)).toMatchObject({ state: 'attention' });
  });

  it('"conectar sessões já abertas" copia o comando do adapter', () => {
    const m = fakeManager();
    flow.connectOpenSessions(asManager(m), adapter);
    expect(clipboard.text).toBe('/recarregar');
  });
});

describe('falas do agente (opcional)', () => {
  it('liga e desliga, e o menu lê o estado do cache', async () => {
    const m = fakeManager();
    await flow.refreshSpeech();
    expect(flow.speechEnabled(adapter)).toBe(false);
    await flow.toggleSpeech(asManager(m), adapter);
    expect(fake.speechOn).toBe(true);
    expect(flow.speechEnabled(adapter)).toBe(true);
    await flow.toggleSpeech(asManager(m), adapter);
    expect(flow.speechEnabled(adapter)).toBe(false);
  });
});
