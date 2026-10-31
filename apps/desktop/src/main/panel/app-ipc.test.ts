import { describe, expect, it, vi } from 'vitest';
import { APP_PANEL_IPC, type AgentConnection } from '../../shared/app-panel';
import { makeAppPanelHandlers } from './app-ipc';

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
