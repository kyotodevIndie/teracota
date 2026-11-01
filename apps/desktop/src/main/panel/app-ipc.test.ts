import { describe, expect, it, vi } from 'vitest';
import { APP_PANEL_IPC, type AgentConnection } from '../../shared/app-panel';
import type { UiPrefs } from '../../shared/live';
import { makeAppPanelHandlers, makeTerminalListeners } from './app-ipc';

const PREFS: UiPrefs = { theme: 'vidro', glass: 0.78, moveMode: 'roam', reducedMotion: false, entityMode: 'single', usageSources: [] };

const PANEL = { sender: 'janela-da-interface' };
const conn: AgentConnection = {
  id: 'claude-code', displayName: 'Claude Code', label: 'Conectar ao Claude Code', status: 'available',
  speech: false, openSessionsCommand: '/reload-plugins', manualCommand: 'claude plugin install teracota@teracota',
};

function setup() {
  const deps = {
    isPanelSender: (s: unknown) => s === PANEL.sender,
    connections: vi.fn(async () => [conn]),
    connect: vi.fn(async (id: string) => id === 'claude-code'),
    setSpeech: vi.fn(async (id: string) => id === 'claude-code'),
    copyOpenSessions: vi.fn((id: string) => id === 'claude-code'),
    minimize: vi.fn(),
    live: vi.fn(() => ({ active: [], ended: [] })),
    usage: vi.fn(() => []),
    prefs: vi.fn(async () => PREFS),
    setPrefs: vi.fn(async (patch: Partial<UiPrefs>) => ({ ...PREFS, ...patch })),
    expand: vi.fn(),
    layout: vi.fn(),
    terminal: {
      pickFolder: vi.fn(async () => 'projeto'),
      start: vi.fn((): { running: boolean; cwdLabel: string | null; scrollback: string } => ({ running: true, cwdLabel: 'projeto', scrollback: '' })),
      snapshot: vi.fn(() => ({ running: false, cwdLabel: null, scrollback: '' })),
      kill: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
    },
  };
  return { deps, h: makeAppPanelHandlers(deps) };
}

describe('IPC da interface (conexões)', () => {
  it('lista os agentes', async () => {
    const { h } = setup();
    expect(await h[APP_PANEL_IPC.connections]!(PANEL.sender, undefined)).toEqual({ ok: true, data: [conn] });
  });

  it('só a janela da interface pode chamar', async () => {
    const { h, deps } = setup();
    expect(await h[APP_PANEL_IPC.connect]!('outra-janela', { id: 'claude-code' })).toEqual({ ok: false, error: 'Requisição inválida.' });
    expect(deps.connect).not.toHaveBeenCalled();
  });

  it('payload inválido não chega a rodar nada', async () => {
    const { h, deps } = setup();
    for (const bad of [{}, { id: '' }, { id: 'x', extra: 1 }, { id: 'x'.repeat(65) }, 'claude-code']) {
      expect((await h[APP_PANEL_IPC.connect]!(PANEL.sender, bad)).ok).toBe(false);
    }
    expect((await h[APP_PANEL_IPC.setSpeech]!(PANEL.sender, { id: 'claude-code', on: 'sim' })).ok).toBe(false);
    expect(deps.connect).not.toHaveBeenCalled();
    expect(deps.setSpeech).not.toHaveBeenCalled();
  });

  it('conectar e ligar as falas devolvem a lista atualizada', async () => {
    const { h, deps } = setup();
    expect(await h[APP_PANEL_IPC.connect]!(PANEL.sender, { id: 'claude-code' })).toEqual({ ok: true, data: [conn] });
    expect(await h[APP_PANEL_IPC.setSpeech]!(PANEL.sender, { id: 'claude-code', on: true })).toEqual({ ok: true, data: [conn] });
    expect(deps.setSpeech).toHaveBeenCalledWith('claude-code', true);
    expect(await h[APP_PANEL_IPC.connect]!(PANEL.sender, { id: 'outro' })).toEqual({ ok: false, error: 'Agente desconhecido.' });
  });

  it('erro de dentro vira mensagem genérica', async () => {
    const { h, deps } = setup();
    deps.connections.mockRejectedValueOnce(new Error('caminho/secreto'));
    expect(await h[APP_PANEL_IPC.connections]!(PANEL.sender, undefined)).toEqual({ ok: false, error: 'Não foi possível concluir a operação.' });
  });
});

describe('IPC do terminal embutido', () => {
  it('abrir valida o tamanho e devolve o estado', async () => {
    const { h, deps } = setup();
    expect(await h[APP_PANEL_IPC.terminalStart]!(PANEL.sender, { cols: 80, rows: 24, claude: true })).toMatchObject({ ok: true, data: { running: true } });
    expect(deps.terminal.start).toHaveBeenCalledWith(80, 24, true);
    for (const bad of [{ cols: 0, rows: 24, claude: true }, { cols: 80.5, rows: 24, claude: true }, { cols: 80, rows: 24 }, { cols: 80, rows: 24, claude: true, cmd: 'rm' }]) {
      expect((await h[APP_PANEL_IPC.terminalStart]!(PANEL.sender, bad)).ok).toBe(false);
    }
    expect(deps.terminal.start).toHaveBeenCalledTimes(1);
  });

  it('o renderer não informa caminho: a pasta vem do seletor do sistema', async () => {
    const { h, deps } = setup();
    expect(await h[APP_PANEL_IPC.terminalPickFolder]!(PANEL.sender, undefined)).toEqual({ ok: true, data: 'projeto' });
    expect((await h[APP_PANEL_IPC.terminalPickFolder]!(PANEL.sender, { path: '/etc' })).ok).toBe(false);
    expect(deps.terminal.pickFolder).toHaveBeenCalledTimes(1);
  });

  it('entrada e tamanho: só da janela da interface e só com payload válido', () => {
    const { deps } = setup();
    const l = makeTerminalListeners(deps);
    l[APP_PANEL_IPC.terminalInput]!(PANEL.sender, 'ls\r');
    l[APP_PANEL_IPC.terminalInput]!('outra-janela', 'rm -rf ~\r');
    l[APP_PANEL_IPC.terminalInput]!(PANEL.sender, 'x'.repeat(64 * 1024 + 1));
    l[APP_PANEL_IPC.terminalInput]!(PANEL.sender, { data: 'ls' });
    expect(deps.terminal.write).toHaveBeenCalledTimes(1);
    expect(deps.terminal.write).toHaveBeenCalledWith('ls\r');
    l[APP_PANEL_IPC.terminalResize]!(PANEL.sender, { cols: 100, rows: 30 });
    l[APP_PANEL_IPC.terminalResize]!(PANEL.sender, { cols: -1, rows: 30 });
    expect(deps.terminal.resize).toHaveBeenCalledTimes(1);
  });
});

describe('IPC da interface (agora, temas e layout)', () => {
  it('entrega as sessões ao vivo e os limites', async () => {
    const { h } = setup();
    expect(await h[APP_PANEL_IPC.live]!(PANEL.sender, undefined)).toEqual({ ok: true, data: { active: [], ended: [] } });
    expect(await h[APP_PANEL_IPC.usage]!(PANEL.sender, undefined)).toEqual({ ok: true, data: [] });
  });

  it('ajustes: aceita tema, vidro e modos válidos', async () => {
    const { h, deps } = setup();
    const r = await h[APP_PANEL_IPC.setPrefs]!(PANEL.sender, { theme: 'claro', glass: 0.6, moveMode: 'stay' });
    expect(r).toEqual({ ok: true, data: { ...PREFS, theme: 'claro', glass: 0.6, moveMode: 'stay' } });
    expect(deps.setPrefs).toHaveBeenCalledWith({ theme: 'claro', glass: 0.6, moveMode: 'stay' });
  });

  it('ajustes: rejeita tema desconhecido, vidro fora da faixa e campos extras', async () => {
    const { h, deps } = setup();
    for (const bad of [{ theme: 'neon' }, { glass: 0.1 }, { glass: 1 }, { theme: 'vidro', extra: 1 }, null, 'claro']) {
      expect(await h[APP_PANEL_IPC.setPrefs]!(PANEL.sender, bad)).toEqual({ ok: false, error: 'Requisição inválida.' });
    }
    expect(deps.setPrefs).not.toHaveBeenCalled();
  });

  it('ajustes de outra janela não passam', async () => {
    const { h, deps } = setup();
    expect(await h[APP_PANEL_IPC.setPrefs]!('outra-janela', { theme: 'claro' })).toEqual({ ok: false, error: 'Requisição inválida.' });
    expect(deps.setPrefs).not.toHaveBeenCalled();
  });

  it('layout: só da interface e com altura válida', () => {
    const { deps } = setup();
    const l = makeTerminalListeners(deps);
    l[APP_PANEL_IPC.layout]!(PANEL.sender, { height: 300, rects: [] });
    l[APP_PANEL_IPC.layout]!('outra-janela', { height: 300, rects: [] });
    l[APP_PANEL_IPC.layout]!(PANEL.sender, { height: -1, rects: [] });
    l[APP_PANEL_IPC.layout]!(PANEL.sender, { height: 300, rects: Array.from({ length: 65 }, () => ({})) });
    expect(deps.layout).toHaveBeenCalledTimes(1);
    expect(deps.layout).toHaveBeenCalledWith(300, []);
  });
});
