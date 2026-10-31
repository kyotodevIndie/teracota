import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PANEL_IPC, type BridgeEvent } from '@tera/agent-bridge/contract';

type Handler = (e: { preventDefault(): void }) => void;
const created: FakeWindow[] = [];

class FakeWindow {
  handlers = new Map<string, Handler>();
  visible = false;
  destroyed = false;
  options: Record<string, unknown>;
  webContents = {
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    handlers: new Map<string, Handler>(),
    on(ev: string, h: Handler) { this.handlers.set(ev, h); },
  };
  hide = vi.fn(() => { this.visible = false; });
  show = vi.fn(() => { this.visible = true; });
  showInactive = vi.fn(() => { this.visible = true; });
  focus = vi.fn();
  restore = vi.fn();
  destroy = vi.fn(() => { this.destroyed = true; });
  setMenu = vi.fn();
  loadFile = vi.fn();
  constructor(options: Record<string, unknown>) { this.options = options; created.push(this); }
  on(ev: string, h: Handler) { this.handlers.set(ev, h); }
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  isMinimized() { return false; }
}

vi.mock('electron', () => ({ BrowserWindow: FakeWindow }));

const { PanelWindow } = await import('./window');

const ev = (e: object) => e as BridgeEvent;
const closeEvent = () => ({ preventDefault: vi.fn() });

beforeEach(() => { created.length = 0; });

describe('janela do painel', () => {
  it('cria com moldura, redimensionável, sem always-on-top e isolada', () => {
    new PanelWindow().show();
    const o = created[0]!.options;
    expect(o).toMatchObject({ frame: true, resizable: true, alwaysOnTop: false });
    expect(o.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false });
    expect(created[0]!.webContents.setWindowOpenHandler.mock.calls[0]![0]()).toEqual({ action: 'deny' });
    const nav = closeEvent();
    created[0]!.webContents.handlers.get('will-navigate')!(nav);
    expect(nav.preventDefault).toHaveBeenCalled();
  });

  it('fechar só esconde (sem destruir nem encerrar sessões)', () => {
    const panel = new PanelWindow();
    panel.show();
    const win = created[0]!;
    const e = closeEvent();
    win.handlers.get('close')!(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(win.hide).toHaveBeenCalled();
    expect(win.destroy).not.toHaveBeenCalled();
    expect(panel.visible).toBe(false);
    // reabrir reaproveita a mesma janela
    panel.show();
    expect(created).toHaveLength(1);
  });

  it('depois do markQuitting, fechar não é impedido', () => {
    const panel = new PanelWindow();
    panel.show();
    panel.markQuitting();
    const e = closeEvent();
    created[0]!.handlers.get('close')!(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('permissão com a janela escondida: mostra sem roubar o foco', () => {
    const panel = new PanelWindow();
    panel.show();
    panel.hide();
    panel.send(ev({ type: 'permission-request', handle: 'h', id: 'p', toolName: 'Bash', detail: 'ls', outsideCwd: false }));
    expect(created[0]!.showInactive).toHaveBeenCalled();
    expect(created[0]!.webContents.send).toHaveBeenCalledWith(PANEL_IPC.event, expect.objectContaining({ type: 'permission-request' }));
  });

  it('outros eventos com a janela escondida não a mostram', () => {
    const panel = new PanelWindow();
    panel.show();
    panel.hide();
    panel.send(ev({ type: 'text-delta', handle: 'h', text: 'x' }));
    expect(created[0]!.showInactive).not.toHaveBeenCalled();
  });

  it('só reconhece o próprio webContents como remetente', () => {
    const panel = new PanelWindow();
    expect(panel.isSender({})).toBe(false);
    panel.show();
    expect(panel.isSender(created[0]!.webContents)).toBe(true);
    expect(panel.isSender({})).toBe(false);
  });
});
