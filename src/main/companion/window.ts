// Janela do Mini Companion.
//
// A janela tem tamanho fixo (o da barra expandida) e é transparente; quem cresce e
// encolhe é o cartão desenhado dentro dela, com transição CSS. Redimensionar a janela
// a cada quadro no Windows dá tremedeira e erro de escala entre monitores, então não.
// Fora do cartão os cliques atravessam (setIgnoreMouseEvents), como na Tera completa:
// a janela não bloqueia a área vazia ao redor.
//
// A posição salva é a do quadrado (a Tera). A barra cresce pro lado com mais espaço
// na tela ("anchor"): perto da borda direita ela abre pra esquerda.
import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import type { Anchor, CompanionView } from '../../shared/companion';
import { COMPANION_IPC } from '../../shared/companion';
import type { Point } from '../../shared/ipc';
import type { CompanionSurface } from './controller';

/** Lado do quadrado da Tera (px lógicos) */
export const SQUARE = 88;
/** Largura da barra aberta */
export const BAR_WIDTH = 420;
/** Folga em volta do cartão pra sombra */
export const MARGIN = 14;
export const WINDOW_SIZE = { width: BAR_WIDTH + MARGIN * 2, height: SQUARE + MARGIN * 2 };
const CURSOR_POLL_MS = 33;
const EDGE_GAP = 24;

export interface CompanionWindowOptions {
  /** Canto superior esquerdo do quadrado, salvo da última vez */
  position?: Point;
  visible?: boolean;
  onSettle?: (p: Point) => void;
  onAnchorChange?: () => void;
  onMenu?: () => void;
}

export function defaultSquarePosition(): Point {
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - SQUARE - EDGE_GAP, y: a.y + a.height - SQUARE - EDGE_GAP };
}

/** Área de trabalho do monitor onde o quadrado está (ou o mais próximo) */
function workAreaAt(p: Point): Electron.Rectangle {
  return screen.getDisplayNearestPoint({ x: Math.round(p.x + SQUARE / 2), y: Math.round(p.y + SQUARE / 2) }).workArea;
}

export function anchorFor(square: Point, area: Electron.Rectangle): Anchor {
  return square.x + SQUARE / 2 < area.x + area.width / 2 ? 'left' : 'right';
}

/** Mantém o quadrado inteiro dentro da área de trabalho */
export function clampSquare(p: Point, area: Electron.Rectangle): Point {
  return {
    x: Math.min(Math.max(p.x, area.x), area.x + area.width - SQUARE),
    y: Math.min(Math.max(p.y, area.y), area.y + area.height - SQUARE),
  };
}

/** Bounds da janela pra um quadrado nesta posição e âncora */
export function windowBounds(square: Point, anchor: Anchor): Electron.Rectangle {
  const x = anchor === 'left' ? square.x - MARGIN : square.x + SQUARE + MARGIN - WINDOW_SIZE.width;
  return { x: Math.round(x), y: Math.round(square.y - MARGIN), ...WINDOW_SIZE };
}

export class CompanionWindow implements CompanionSurface {
  readonly win: BrowserWindow;
  private square: Point;
  private currentAnchor: Anchor;
  private ready = false;
  private pendingView: CompanionView | null = null;

  constructor(private readonly opts: CompanionWindowOptions = {}) {
    const saved = opts.position;
    const start = saved ? clampSquare(saved, workAreaAt(saved)) : defaultSquarePosition();
    this.square = start;
    this.currentAnchor = anchorFor(start, workAreaAt(start));

    this.win = new BrowserWindow({
      ...windowBounds(this.square, this.currentAnchor),
      title: 'Teracota',
      transparent: true,
      frame: false,
      resizable: false,
      hasShadow: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false, // showInactive: aparecer não rouba o foco de quem está digitando
      webPreferences: {
        preload: path.join(__dirname, 'companion-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true);
    this.win.setIgnoreMouseEvents(true, { forward: true });
    this.win.loadFile(path.join(__dirname, 'renderer', 'companion.html'));
    this.win.once('ready-to-show', () => { if (opts.visible !== false) this.win.showInactive(); });
    this.win.webContents.on('did-finish-load', () => {
      this.ready = true;
      this.win.setIgnoreMouseEvents(true, { forward: true });
      if (this.pendingView) this.win.webContents.send(COMPANION_IPC.view, this.pendingView);
    });

    // Cursor relativo à janela: o renderer decide se está em cima do cartão (os eventos
    // repassados pelo setIgnoreMouseEvents não são confiáveis no Windows).
    let last = '';
    const poll = setInterval(() => {
      if (!this.alive || !this.ready) return;
      const p = screen.getCursorScreenPoint();
      const b = this.win.getBounds();
      const key = `${p.x - b.x},${p.y - b.y}`;
      if (key === last) return;
      last = key;
      this.win.webContents.send(COMPANION_IPC.cursor, { x: p.x - b.x, y: p.y - b.y });
    }, CURSOR_POLL_MS);
    this.win.on('closed', () => clearInterval(poll));
  }

  get alive(): boolean {
    return !this.win.isDestroyed();
  }

  get anchor(): Anchor {
    return this.currentAnchor;
  }

  get position(): Point {
    return { ...this.square };
  }

  render(view: CompanionView): void {
    this.pendingView = view;
    if (this.alive && this.ready) this.win.webContents.send(COMPANION_IPC.view, view);
  }

  openMenu(): void {
    this.opts.onMenu?.();
  }

  setIgnoreMouse(ignore: boolean): void {
    if (this.alive) this.win.setIgnoreMouseEvents(ignore, { forward: true });
  }

  moveBy(dx: number, dy: number): void {
    this.moveTo({ x: this.square.x + dx, y: this.square.y + dy });
  }

  moveTo(p: Point): void {
    if (!this.alive) return;
    const area = workAreaAt(p);
    this.square = clampSquare(p, area);
    const anchor = anchorFor(this.square, area);
    const changed = anchor !== this.currentAnchor;
    this.currentAnchor = anchor;
    this.win.setBounds(windowBounds(this.square, anchor));
    if (changed) this.opts.onAnchorChange?.();
  }

  settle(): void {
    this.opts.onSettle?.(this.position);
  }

  resetPosition(): void {
    this.moveTo(defaultSquarePosition());
    this.settle();
  }

  setVisible(visible: boolean): void {
    if (!this.alive) return;
    if (visible) this.win.showInactive();
    else this.win.hide();
  }

  destroy(): void {
    if (this.alive) this.win.destroy();
  }
}
