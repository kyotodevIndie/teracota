import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PANEL_IPC, type BridgeEvent } from '@tera/agent-bridge/contract';
import { APP_PANEL_IPC } from '../../shared/app-panel';

type Handler = (e: { preventDefault(): void }) => void;
const created: FakeWindow[] = [];

class FakeWindow {
  handlers = new Map<string, Handler>();
  visible = false;
  destroyed = false;
  bounds = { x: 0, y: 0, width: 420, height: 480 };
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
  destroy = vi.fn(() => { this.destroyed = true; });
  setMenu = vi.fn();
  setAlwaysOnTop = vi.fn();
  setShape = vi.fn();
  loadFile = vi.fn();
  setBounds = vi.fn((b: { x: number; y: number; width: number; height: number }) => { this.bounds = b; });
  getBounds() { return this.bounds; }
  constructor(options: Record<string, unknown>) { this.options = options; created.push(this); }
  on(ev: string, h: Handler) { this.handlers.set(ev, h); }
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
}

const AREA = { x: 0, y: 0, width: 1920, height: 1080 };
vi.mock('electron', () => ({
  BrowserWindow: FakeWindow,
  screen: { getDisplayMatching: () => ({ workArea: AREA }), getPrimaryDisplay: () => ({ workArea: AREA }) },
}));

const { PanelWindow, parsePanelShape } = await import('./window');

const ev = (e: object) => e as BridgeEvent;
const closeEvent = () => ({ preventDefault: vi.fn() });
let tera = { x: 800, y: 600, width: 320, height: 440 };
const make = (onVisibility = vi.fn()) => new PanelWindow({ anchor: () => tera, onVisibility });

beforeEach(() => {
  created.length = 0;
  tera = { x: 800, y: 600, width: 320, height: 440 };
});

describe('janela da interface (presa na Tera)', () => {
  it('cria transparente, sem moldura, sem sombra, fora da barra de tarefas, e isolada', () => {
    make().show();
    const o = created[0]!.options;
    expect(o).toMatchObject({ frame: false, transparent: true, hasShadow: false, resizable: false, skipTaskbar: true });
    expect(o).not.toHaveProperty('backgroundMaterial');
    expect(o).not.toHaveProperty('vibrancy');
    expect(o.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false });
    expect(created[0]!.webContents.setWindowOpenHandler.mock.calls[0]![0]()).toEqual({ action: 'deny' });
    const nav = closeEvent();
    created[0]!.webContents.handlers.get('will-navigate')!(nav);
    expect(nav.preventDefault).toHaveBeenCalled();
  });

  it('abre em cima da Tera, do tamanho do conteúdo, e conta pra interface onde ficou', () => {
    const panel = make();
    panel.show();
    panel.layout(300, [{ x: 0, y: 0, width: 420, height: 300 }]);
    const b = created[0]!.bounds;
    expect(b.height).toBe(300);
    expect(b.y + b.height).toBeLessThanOrEqual(tera.y + 190);
    expect(created[0]!.webContents.send).toHaveBeenCalledWith(APP_PANEL_IPC.placement, expect.objectContaining({ side: 'above', mode: 'full' }));
  });

  it('a Tera mexeu: a interface vai junto', () => {
    const panel = make();
    panel.show();
    panel.layout(300, null);
    tera = { ...tera, x: 200 };
    panel.reposition();
    expect(created[0]!.bounds.x).toBe(200 + 160 - 210);
  });

  it('Linux: recorta a janela nos cartões (os vãos deixam o clique passar)', () => {
    const panel = make();
    panel.show();
    panel.layout(200, [{ x: 10, y: 0, width: 400, height: 44 }, { x: 10, y: 52, width: 400, height: 80 }]);
    if (process.platform === 'linux') {
      expect(created[0]!.setShape).toHaveBeenLastCalledWith([{ x: 10, y: 0, width: 400, height: 44 }, { x: 10, y: 52, width: 400, height: 80 }]);
    }
  });

  it('fechar só esconde, avisa (a Tera volta a passear) e reabre a mesma janela', () => {
    const onVisibility = vi.fn();
    const panel = make(onVisibility);
    panel.show();
    expect(onVisibility).toHaveBeenLastCalledWith(true);
    const win = created[0]!;
    const e = closeEvent();
    win.handlers.get('close')!(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(win.destroy).not.toHaveBeenCalled();
    expect(panel.visible).toBe(false);
    expect(onVisibility).toHaveBeenLastCalledWith(false);
    panel.show();
    expect(created).toHaveLength(1);
  });

  it('clique na Tera alterna: abre, e fecha se já está aberta', () => {
    const panel = make();
    panel.toggle();
    expect(panel.visible).toBe(true);
    panel.toggle();
    expect(panel.visible).toBe(false);
  });

  it('pedido com a janela fechada: mostra só o pedido, sem roubar o foco', () => {
    const panel = make();
    panel.peek();
    expect(created[0]!.showInactive).toHaveBeenCalled();
    expect(created[0]!.show).not.toHaveBeenCalled();
    expect(panel.currentMode).toBe('peek');
  });

  it('pedido com a interface aberta não muda nada', () => {
    const panel = make();
    panel.show();
    panel.peek();
    expect(panel.currentMode).toBe('full');
    expect(created[0]!.showInactive).not.toHaveBeenCalled();
  });

  it('permissão da conversa pela API com a janela escondida: mostra sem roubar o foco', () => {
    const panel = make();
    panel.show();
    panel.hide();
    panel.send(ev({ type: 'permission-request', handle: 'h', id: 'p', toolName: 'Bash', detail: 'ls', outsideCwd: false }));
    expect(created[0]!.showInactive).toHaveBeenCalled();
    expect(created[0]!.webContents.send).toHaveBeenCalledWith(PANEL_IPC.event, expect.objectContaining({ type: 'permission-request' }));
  });

  it('depois do markQuitting, fechar não é impedido', () => {
    const panel = make();
    panel.show();
    panel.markQuitting();
    const e = closeEvent();
    created[0]!.handlers.get('close')!(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('só reconhece o próprio webContents como remetente', () => {
    const panel = make();
    expect(panel.isSender({})).toBe(false);
    panel.show();
    expect(panel.isSender(created[0]!.webContents)).toBe(true);
    expect(panel.isSender({})).toBe(false);
  });

  it('altura inválida é ignorada', () => {
    const panel = make();
    panel.show();
    const before = created[0]!.setBounds.mock.calls.length;
    panel.layout(Number.NaN, null);
    panel.layout(-5, null);
    panel.layout('300', null);
    expect(created[0]!.setBounds.mock.calls.length).toBe(before);
  });
});

describe('recorte vindo da interface', () => {
  it('arredonda, prende na janela e descarta o vazio', () => {
    expect(parsePanelShape([{ x: -5, y: 2.4, width: 500, height: 10 }, { x: 0, y: 0, width: 0, height: 5 }], 420, 300))
      .toEqual([{ x: 0, y: 2, width: 420, height: 10 }]);
  });

  it('rejeita o que não é uma lista de retângulos', () => {
    expect(parsePanelShape('x', 420, 300)).toBeNull();
    expect(parsePanelShape([], 420, 300)).toBeNull();
    expect(parsePanelShape([{ x: 'a', y: 0, width: 1, height: 1 }], 420, 300)).toBeNull();
    expect(parsePanelShape(Array.from({ length: 65 }, () => ({ x: 0, y: 0, width: 1, height: 1 })), 420, 300)).toBeNull();
  });
});
