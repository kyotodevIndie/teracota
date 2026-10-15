import { describe, expect, it, vi } from 'vitest';
import { PANEL_IPC } from '../../shared/bridge';
import { BridgeError } from '../bridge/manager';
import { makePanelHandlers, type PanelBridge } from './ipc';

const H = '123e4567-e89b-42d3-a456-426614174000';
const PANEL = { id: 'panel' };
const OTHER = { id: 'other' };

function setup(pick: string | null = '/work/proj') {
  const bridge = {
    listProviders: vi.fn(async () => [{ id: 'p', displayName: 'P', available: true }]),
    listSessions: vi.fn(async () => [{ id: 'sess-1', title: 't', lastModified: 1 }]),
    start: vi.fn(async () => H),
    send: vi.fn(),
    respondPermission: vi.fn(),
    interrupt: vi.fn(async () => {}),
    close: vi.fn(),
    snapshot: vi.fn(() => []),
  } satisfies PanelBridge;
  const hide = vi.fn();
  const pickFolder = vi.fn(async () => pick);
  const handlers = makePanelHandlers({ bridge, pickFolder, hide, isPanelSender: (s) => s === PANEL });
  const call = (ch: string, payload?: unknown, sender: unknown = PANEL) => handlers[ch]!(sender, payload);
  return { bridge, hide, pickFolder, call };
}


describe('IPC do painel', () => {
  it('rejeita remetente que não é o painel, em todos os canais', async () => {
    const { bridge, call } = setup();
    for (const ch of Object.values(PANEL_IPC).filter((c) => c !== PANEL_IPC.event)) {
      expect(await call(ch, { handle: H, text: 'x', providerId: 'p', requestId: 'r', allow: true }, OTHER)).toEqual({
        ok: false, error: expect.any(String),
      });
    }
    expect(bridge.send).not.toHaveBeenCalled();
    expect(bridge.start).not.toHaveBeenCalled();
    expect(bridge.listProviders).not.toHaveBeenCalled();
  });

  it('payload inválido: erro genérico que não ecoa o conteúdo', async () => {
    const { bridge, call } = setup();
    const SECRET = 'SEGREDO-no-payload';
    const bad: [string, unknown][] = [
      [PANEL_IPC.send, { handle: 'nao-uuid', text: SECRET }],
      [PANEL_IPC.send, { handle: H, text: '' }],
      [PANEL_IPC.send, { handle: H, text: 'x'.repeat(20001) }],
      [PANEL_IPC.send, { handle: H, text: SECRET, extra: 1 }],
      [PANEL_IPC.send, SECRET],
      [PANEL_IPC.send, null],
      [PANEL_IPC.respondPermission, { handle: H, requestId: 'r', allow: 'sim' }],
      [PANEL_IPC.respondPermission, { handle: H, requestId: 'r'.repeat(65), allow: true }],
      [PANEL_IPC.interrupt, { handle: SECRET }],
      [PANEL_IPC.closeSession, {}],
      [PANEL_IPC.startSession, { providerId: '' }],
      [PANEL_IPC.startSession, { providerId: 'p'.repeat(65) }],
      [PANEL_IPC.startSession, { providerId: 'p', cwd: '/etc' }],
      [PANEL_IPC.pickFolder, { providerId: 'p', cwd: SECRET }],
      [PANEL_IPC.listProviders, SECRET],
      [PANEL_IPC.snapshot, { a: 1 }],
      [PANEL_IPC.hide, SECRET],
    ];
    for (const [ch, payload] of bad) {
      const r = await call(ch, payload);
      expect(r.ok, `${ch} ${JSON.stringify(payload)?.slice(0, 40)}`).toBe(false);
      expect(JSON.stringify(r)).not.toContain('SEGREDO');
    }
    expect(bridge.send).not.toHaveBeenCalled();
    expect(bridge.respondPermission).not.toHaveBeenCalled();
    expect(bridge.interrupt).not.toHaveBeenCalled();
    expect(bridge.close).not.toHaveBeenCalled();
    expect(bridge.start).not.toHaveBeenCalled();
  });

  it('startSession exige pasta escolhida antes', async () => {
    const { bridge, call } = setup();
    expect(await call(PANEL_IPC.startSession, { providerId: 'p' })).toEqual({ ok: false, error: 'Escolha uma pasta primeiro.' });
    expect(bridge.start).not.toHaveBeenCalled();
  });

  it('pickFolder: o main escolhe, devolve só rótulo e sessões; cancelar devolve null', async () => {
    const t = setup();
    const r = await t.call(PANEL_IPC.pickFolder, { providerId: 'p' });
    expect(r).toEqual({ ok: true, data: { cwdLabel: 'proj', sessions: [{ id: 'sess-1', title: 't', lastModified: 1 }] } });
    expect(JSON.stringify(r)).not.toContain('work');
    expect(t.bridge.listSessions).toHaveBeenCalledWith('p', '/work/proj');
    expect(t.pickFolder).toHaveBeenCalledWith('p');
    const c = setup(null);
    expect(await c.call(PANEL_IPC.pickFolder, { providerId: 'p' })).toEqual({ ok: true, data: null });
  });

  it('startSession usa a pasta escolhida; resumeId só se estava na última lista', async () => {
    const t = setup();
    await t.call(PANEL_IPC.pickFolder, { providerId: 'p' });
    expect(await t.call(PANEL_IPC.startSession, { providerId: 'p', resumeId: 'outra' })).toEqual({ ok: false, error: 'Sessão desconhecida.' });
    expect(t.bridge.start).not.toHaveBeenCalled();
    expect(await t.call(PANEL_IPC.startSession, { providerId: 'p', resumeId: 'sess-1' })).toEqual({ ok: true, data: { handle: H } });
    expect(t.bridge.start).toHaveBeenCalledWith('p', { cwd: '/work/proj', resumeId: 'sess-1' });
    await t.call(PANEL_IPC.startSession, { providerId: 'p' });
    expect(t.bridge.start).toHaveBeenLastCalledWith('p', { cwd: '/work/proj', resumeId: undefined });
  });

  it('encaminha chamadas válidas', async () => {
    const t = setup();
    expect((await t.call(PANEL_IPC.send, { handle: H, text: 'oi' })).ok).toBe(true);
    expect(t.bridge.send).toHaveBeenCalledWith(H, 'oi');
    await t.call(PANEL_IPC.respondPermission, { handle: H, requestId: 'r1', allow: false });
    expect(t.bridge.respondPermission).toHaveBeenCalledWith(H, 'r1', false);
    await t.call(PANEL_IPC.interrupt, { handle: H });
    expect(t.bridge.interrupt).toHaveBeenCalledWith(H);
    await t.call(PANEL_IPC.closeSession, { handle: H });
    expect(t.bridge.close).toHaveBeenCalledWith(H);
    expect((await t.call(PANEL_IPC.snapshot)).ok).toBe(true);
    expect((await t.call(PANEL_IPC.listProviders)).ok).toBe(true);
    await t.call(PANEL_IPC.hide);
    expect(t.hide).toHaveBeenCalled();
  });

  it('erros do bridge: mensagem segura do BridgeError; outros viram genérico', async () => {
    const t = setup();
    t.bridge.send.mockImplementationOnce(() => { throw new BridgeError('A sessão não pode receber mensagens agora.'); });
    expect(await t.call(PANEL_IPC.send, { handle: H, text: 'x' })).toEqual({ ok: false, error: 'A sessão não pode receber mensagens agora.' });
    t.bridge.send.mockImplementationOnce(() => { throw new Error('C:\\Users\\segredo\\x'); });
    const r = await t.call(PANEL_IPC.send, { handle: H, text: 'x' });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('segredo');
  });
});
