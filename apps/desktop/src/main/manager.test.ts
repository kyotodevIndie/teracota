import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Identity } from '../shared/ipc';
import type { CompanionEvent } from '../shared/protocol';
import type { Config } from './config';
import type { AgentSignal } from './integrations/types';

// ---------- dublês: Electron, janelas e disco ----------

vi.mock('electron', () => ({
  app: { isPackaged: false, setLoginItemSettings: vi.fn() },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) },
}));

vi.mock('./config', () => ({ saveConfig: vi.fn() }));

/** Uma "Tera" sem janela: registra o que recebeu */
class FakeEntity {
  static all: FakeEntity[] = [];
  sessionId: string | null = null;
  identity: Identity;
  sent: CompanionEvent[] = [];
  left = false;
  alive = true;
  position = { x: 0, y: 0 };
  win = { on: vi.fn(), webContents: {}, reload: vi.fn() };
  constructor(opts: { identity: Identity }) {
    this.identity = opts.identity;
    FakeEntity.all.push(this);
  }
  send(e: CompanionEvent) { this.sent.push(e); }
  setIdentity(sessionId: string | null, identity: Identity) { this.sessionId = sessionId; this.identity = identity; }
  leave() { this.left = true; }
  destroy() { this.alive = false; }
  setVisible() {}
  setMoveMode() {}
  resetPosition() {}
  get last() { return this.sent.at(-1); }
}

vi.mock('./entity', () => ({
  Entity: FakeEntity,
  SIZE: { width: 320, height: 440 },
  cornerPosition: () => ({ x: 0, y: 0 }),
  isOnScreen: () => true,
}));

const { EntityManager, MAX_ENTITIES } = await import('./manager');

// ---------- ajudantes ----------

const config = (patch: Partial<Config> = {}): Config => ({ moveMode: 'stay', entityMode: 'single', onboarded: true, ...patch });

function signal(provider: string, sessionId: string, project: string, extra: Partial<AgentSignal> = {}): AgentSignal {
  return { source: { provider, sessionId, project }, event: { state: 'typing', working: true }, working: true, ...extra };
}

const claude = (session: string, project: string, extra: Partial<AgentSignal> = {}) => signal('claude-code', session, project, extra);
const say = (text: string): Partial<AgentSignal> => ({ event: { state: 'happy', say: text } });

beforeEach(() => {
  vi.useFakeTimers();
  FakeEntity.all = [];
});
afterEach(() => vi.useRealTimers());

function start(patch: Partial<Config> = {}) {
  const manager = new EntityManager(config(patch));
  manager.start();
  return manager;
}

// ---------- modo "uma Tera só" ----------

describe('modo uma só', () => {
  it('uma Tera recebe os eventos de todas as sessões', () => {
    const m = start();
    m.handleSignal(claude('a', 'api'));
    m.handleSignal(claude('b', 'front'));
    expect(FakeEntity.all).toHaveLength(1);
    expect(FakeEntity.all[0]!.sent).toHaveLength(2);
  });

  it('"trabalhando" é o agregado: só para quando todas as sessões param', () => {
    const m = start();
    m.handleSignal(claude('a', 'api'));
    m.handleSignal(claude('b', 'front'));
    m.handleSignal(claude('a', 'api', { working: false, event: { state: 'happy', working: false } }));
    expect(FakeEntity.all[0]!.last?.working).toBe(true); // a "b" ainda trabalha
    m.handleSignal(claude('b', 'front', { working: false, event: { state: 'happy', working: false } }));
    expect(FakeEntity.all[0]!.last?.working).toBe(false);
  });

  it('com uma sessão só, a fala não ganha etiqueta', () => {
    const m = start();
    m.handleSignal(claude('a', 'api', say('Pronto!')));
    expect(FakeEntity.all[0]!.last?.from).toBeUndefined();
  });

  it('com várias sessões, a fala diz o projeto', () => {
    const m = start();
    m.handleSignal(claude('a', 'api'));
    m.handleSignal(claude('b', 'front', say('Pronto!')));
    expect(FakeEntity.all[0]!.last).toMatchObject({ say: 'Pronto!', from: 'front' });
  });

  it('com agentes diferentes, a etiqueta é "Agente · projeto"', () => {
    const m = start();
    m.handleSignal(claude('a', 'api'));
    m.handleSignal(signal('meu-agente', 'x', 'hera', say('Build ok')));
    expect(FakeEntity.all[0]!.last?.from).toBe('meu-agente · hera');
  });

  it('uma sessão termina e outra continua: só se despede, sem dormir', () => {
    const m = start();
    m.handleSignal(claude('a', 'api'));
    m.handleSignal(claude('b', 'front'));
    m.handleSignal(claude('a', 'api', { lifecycle: 'end', working: false, event: { state: 'sleeping', working: false } }));
    expect(FakeEntity.all[0]!.last).toMatchObject({ say: 'Tchau! 👋', from: 'api', working: true });
    expect(FakeEntity.all[0]!.last?.state).toBeUndefined();
  });

  it('a última sessão termina: ela dorme', () => {
    const m = start();
    m.handleSignal(claude('a', 'api'));
    m.handleSignal(claude('a', 'api', { lifecycle: 'end', working: false, event: { state: 'sleeping', working: false } }));
    expect(FakeEntity.all[0]!.last).toMatchObject({ state: 'sleeping', working: false });
  });

  it('o evento original do adapter não é alterado (cópia antes de mexer)', () => {
    const m = start();
    const s = claude('a', 'api');
    m.handleSignal(claude('b', 'front'));
    m.handleSignal(s);
    expect(s.event).toEqual({ state: 'typing', working: true });
  });
});

// ---------- modo "uma por sessão" ----------

describe('modo uma por sessão', () => {
  it('a primeira sessão usa a Tera "de casa"; as seguintes criam novas', () => {
    const m = start({ entityMode: 'multi' });
    m.handleSignal(claude('a', 'api'));
    m.handleSignal(claude('b', 'front'));
    const [home, second] = FakeEntity.all;
    expect(FakeEntity.all).toHaveLength(2);
    expect(home!.identity.label).toBe('api');
    expect(second!.identity.label).toBe('front');
    expect(home!.identity.color).not.toBe(second!.identity.color);
  });

  it('cada sessão recebe só os próprios eventos', () => {
    const m = start({ entityMode: 'multi' });
    m.handleSignal(claude('a', 'api', say('A')));
    m.handleSignal(claude('b', 'front', say('B')));
    expect(FakeEntity.all[0]!.sent.map((e) => e.say)).toEqual(['A']);
    expect(FakeEntity.all[1]!.sent.map((e) => e.say)).toEqual(['B']);
  });

  it('sessões de agentes diferentes com o mesmo id não se misturam', () => {
    const m = start({ entityMode: 'multi' });
    m.handleSignal(claude('1', 'api'));
    m.handleSignal(signal('meu-agente', '1', 'hera'));
    expect(FakeEntity.all).toHaveLength(2);
  });

  it('plaquinhas ganham o nome do agente quando entra um agente diferente', () => {
    const m = start({ entityMode: 'multi' });
    m.handleSignal(claude('a', 'api'));
    expect(FakeEntity.all[0]!.identity.label).toBe('api');
    m.handleSignal(signal('meu-agente', 'x', 'hera'));
    expect(FakeEntity.all[0]!.identity.label).toBe('Claude Code · api');
    expect(FakeEntity.all[1]!.identity.label).toBe('meu-agente · hera');
  });

  it('sessão encerrada: a Tera extra vai embora; a de casa fica e volta a ser "de casa"', () => {
    const m = start({ entityMode: 'multi' });
    m.handleSignal(claude('a', 'api'));
    m.handleSignal(claude('b', 'front'));
    m.handleSignal(claude('b', 'front', { lifecycle: 'end' }));
    expect(FakeEntity.all[1]!.left).toBe(true);
    m.handleSignal(claude('a', 'api', { lifecycle: 'end' }));
    expect(FakeEntity.all[0]!.left).toBe(false);
    expect(FakeEntity.all[0]!.identity.label).toBeNull();
    expect(FakeEntity.all[0]!.sessionId).toBeNull();
  });

  it('a sessão da Tera de casa termina antes: ela fica (livre) e a outra continua', () => {
    const m = start({ entityMode: 'multi' });
    m.handleSignal(claude('a', 'api'));
    m.handleSignal(claude('b', 'front'));
    m.handleSignal(claude('a', 'api', { lifecycle: 'end' }));
    const [home, second] = FakeEntity.all;
    expect(home!.left).toBe(false);
    expect(home!.sessionId).toBeNull();
    expect(second!.left).toBe(false);
    // a próxima sessão reaproveita a de casa em vez de criar outra janela
    m.handleSignal(claude('c', 'docs'));
    expect(FakeEntity.all).toHaveLength(2);
    expect(home!.identity.label).toBe('docs');
  });

  it(`no máximo ${MAX_ENTITIES} Teras`, () => {
    const m = start({ entityMode: 'multi' });
    for (let i = 0; i < MAX_ENTITIES + 3; i++) m.handleSignal(claude(`s${i}`, `p${i}`));
    expect(FakeEntity.all).toHaveLength(MAX_ENTITIES);
  });

  it('sessão fantasma (sem eventos por 45 min) é encerrada sozinha', () => {
    const m = start({ entityMode: 'multi' });
    m.handleSignal(claude('a', 'api'));
    m.handleSignal(claude('b', 'front'));
    vi.advanceTimersByTime(46 * 60 * 1000);
    expect(FakeEntity.all[1]!.left).toBe(true);
  });
});

// ---------- MCP e API local ----------

describe('roteamento do MCP', () => {
  it('a fala vai pra Tera da sessão que chamou a ferramenta', () => {
    const m = start({ entityMode: 'multi' });
    m.handleSignal(claude('a', 'api'));
    m.handleSignal(claude('b', 'front'));
    m.handleSignal(claude('a', 'api', { mcpCall: true, event: null }));
    m.handleMcp({ say: 'Achei o bug!' });
    expect(FakeEntity.all[0]!.last?.say).toBe('Achei o bug!');
    expect(FakeEntity.all[1]!.sent.some((e) => e.say === 'Achei o bug!')).toBe(false);
  });

  it('sem chamada recente marcada, vai pra sessão mais recente', () => {
    const m = start({ entityMode: 'multi' });
    m.handleSignal(claude('a', 'api'));
    vi.advanceTimersByTime(1000);
    m.handleSignal(claude('b', 'front'));
    m.handleMcp({ say: 'oi' });
    expect(FakeEntity.all[1]!.last?.say).toBe('oi');
  });
});

describe('API local', () => {
  it('evento sem source vai pra todas as Teras', () => {
    const m = start({ entityMode: 'multi' });
    m.handleSignal(claude('a', 'api'));
    m.handleSignal(claude('b', 'front'));
    m.handleEvent({ event: { say: 'todo mundo' } });
    expect(FakeEntity.all.every((e) => e.last?.say === 'todo mundo')).toBe(true);
  });

  it('evento com source entra no fluxo de sessões', () => {
    const m = start({ entityMode: 'multi' });
    m.handleEvent({ event: { state: 'terminal', working: true }, source: { provider: 'meu-agente', sessionId: 'z', project: 'hera' } });
    expect(FakeEntity.all[0]!.identity.label).toBe('hera');
    m.handleEvent({ event: null, source: { provider: 'meu-agente', sessionId: 'z' }, lifecycle: 'end' });
    expect(FakeEntity.all[0]!.sessionId).toBeNull();
  });
});

describe('sessões do painel (Agent Bridge) e sessões externas', () => {
  // o painel usa o id do provider real e o handle como sessionId; hooks externos usam o session_id do agente
  const panel = (handle: string, extra: Partial<AgentSignal> = {}) => claude(handle, 'proj', extra);
  const panelEnd: Partial<AgentSignal> = { lifecycle: 'end', working: false, event: { state: 'sleeping', working: false } };

  it('coexistem como duas sessões e o fim da sessão do painel não encerra a externa', () => {
    const m = start();
    m.handleSignal(claude('hook-ext', 'api', { lifecycle: 'start' }));
    m.handleSignal(panel('handle-1', { lifecycle: 'start' }));
    m.handleSignal(panel('handle-1', panelEnd));
    // a externa continua: a Tera só se despede da sessão do painel, sem dormir
    expect(FakeEntity.all[0]!.last).toMatchObject({ say: 'Tchau! 👋', from: 'proj', working: true });
    expect(FakeEntity.all[0]!.last?.state).toBeUndefined();
    m.handleSignal(claude('hook-ext', 'api', { event: { state: 'reading', working: true } }));
    expect(FakeEntity.all[0]!.last).toMatchObject({ state: 'reading', working: true });
  });

  it('modo multi: a sessão do painel ganha a sua Tera e a libera ao encerrar; a externa fica', () => {
    const m = start({ entityMode: 'multi' });
    m.handleSignal(claude('hook-ext', 'api', { lifecycle: 'start' }));
    m.handleSignal(panel('handle-1', { lifecycle: 'start' }));
    expect(FakeEntity.all).toHaveLength(2);
    expect(FakeEntity.all[1]!.identity.label).toBe('proj');
    m.handleSignal(panel('handle-1', panelEnd));
    expect(FakeEntity.all[1]!.left).toBe(true);
    expect(FakeEntity.all[0]!.left).toBe(false);
    expect(FakeEntity.all[0]!.sessionId).not.toBeNull();
  });
});
