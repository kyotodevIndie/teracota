// Uma entidade = uma Tera na tela: janela transparente + passeio + ponte de IPC.
import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { CHARACTER_NAME } from '../shared/brand';
import { IPC, type Identity, type MoveMode, type Point } from '../shared/ipc';
import type { CompanionEvent } from '../shared/protocol';
import { Walker } from './walker';

export const SIZE = { width: 320, height: 440 };
const CURSOR_POLL_MS = 33;
const LEAVE_MS = 2500;

export interface EntityOptions {
  position: Point;
  moveMode: MoveMode;
  identity: Identity;
  /** false = nasce escondida (app escondido pela bandeja) */
  visible?: boolean;
  /** Chamado quando a entidade para num lugar novo (arrastada ou fim do passeio) */
  onSettle?: (p: Point) => void;
}

export function cornerPosition(): Point {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - SIZE.width - 24,
    y: workArea.y + workArea.height - SIZE.height,
  };
}

/** A posição ainda cai dentro de algum monitor? (monitores podem ter mudado) */
export function isOnScreen({ x, y }: Point): boolean {
  const cx = x + SIZE.width / 2;
  const cy = y + SIZE.height - 100;
  return screen.getAllDisplays().some(({ workArea: a }) =>
    cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height);
}

export class Entity {
  readonly win: BrowserWindow;
  sessionId: string | null = null;
  identity: Identity;
  private readonly walker: Walker;
  private readonly onSettle?: (p: Point) => void;
  private ready = false;
  private readonly queue: Array<[string, unknown]> = [];
  private moveMode: MoveMode;

  constructor(opts: EntityOptions) {
    this.identity = opts.identity;
    this.moveMode = opts.moveMode;
    this.onSettle = opts.onSettle;

    this.win = new BrowserWindow({
      ...SIZE,
      ...opts.position,
      title: CHARACTER_NAME,
      transparent: true,
      frame: false,
      resizable: false,
      hasShadow: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false, // aparece sem roubar o foco (showInactive abaixo)
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    // 'screen-saver' mantém acima até de janelas em tela cheia
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true);
    // Cliques atravessam a janela, exceto sobre o personagem (o renderer alterna isso)
    this.win.setIgnoreMouseEvents(true, { forward: true });
    this.win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    this.win.once('ready-to-show', () => { if (opts.visible !== false) this.win.showInactive(); });
    let last = '';
    this.win.webContents.on('did-finish-load', () => {
      this.ready = true;
      // página nova (ou recarregada) começa deixando o clique passar, e recebe o cursor de novo
      this.win.setIgnoreMouseEvents(true, { forward: true });
      last = '';
      this.win.webContents.send(IPC.mode, { mode: this.moveMode, announce: false });
      this.win.webContents.send(IPC.identity, this.identity);
      for (const [channel, payload] of this.queue.splice(0)) this.win.webContents.send(channel, payload);
    });

    this.walker = new Walker(this.win, SIZE, opts.moveMode, {
      onWalk: (info) => this.post(IPC.walk, info),
      onStop: () => this.settle(),
    });

    // Posição do cursor relativa à janela. O renderer usa pra saber se o mouse está em
    // cima do personagem (os eventos repassados pelo setIgnoreMouseEvents não são
    // confiáveis no Windows, principalmente com monitores de escalas diferentes) e pros olhos.
    const poll = setInterval(() => {
      if (!this.alive) return;
      const p = screen.getCursorScreenPoint();
      const b = this.win.getBounds();
      const key = `${p.x - b.x},${p.y - b.y}`;
      if (key === last) return;
      last = key;
      this.post(IPC.cursor, { x: p.x - b.x, y: p.y - b.y });
    }, CURSOR_POLL_MS);
    this.win.on('closed', () => clearInterval(poll));
  }

  get alive(): boolean {
    return !this.win.isDestroyed();
  }

  get position(): Point {
    const { x, y } = this.win.getBounds();
    return { x, y };
  }

  send(event: CompanionEvent): void {
    this.post(IPC.event, event);
  }

  setIdentity(sessionId: string | null, identity: Identity): void {
    this.sessionId = sessionId;
    this.identity = identity;
    this.post(IPC.identity, identity);
  }

  setMoveMode(mode: MoveMode, announce: boolean): void {
    this.moveMode = mode;
    this.walker.setMode(mode);
    this.post(IPC.mode, { mode, announce });
  }

  setWalkAllowed(allowed: boolean): void {
    this.walker.setAllowed(allowed);
  }

  setIgnoreMouse(ignore: boolean): void {
    if (this.alive) this.win.setIgnoreMouseEvents(ignore, { forward: true });
  }

  moveBy(dx: number, dy: number): void {
    this.walker.interrupt();
    const { x, y } = this.position;
    this.moveTo({ x: x + dx, y: y + dy });
  }

  moveTo({ x, y }: Point): void {
    if (this.alive) this.win.setBounds({ x: Math.round(x), y: Math.round(y), ...SIZE });
  }

  resetPosition(): void {
    this.walker.interrupt();
    this.moveTo(cornerPosition());
    this.settle();
  }

  settle(): void {
    if (this.alive) this.onSettle?.(this.position);
  }

  setVisible(visible: boolean): void {
    if (!this.alive) return;
    if (visible) this.win.showInactive();
    else this.win.hide();
    this.walker.setPaused(!visible);
  }

  /** Despede-se e fecha a janela */
  leave(): void {
    this.walker.setAllowed(false);
    this.post(IPC.leave, null);
    setTimeout(() => this.destroy(), LEAVE_MS);
  }

  destroy(): void {
    if (this.alive) this.win.destroy();
  }

  private post(channel: string, payload: unknown): void {
    if (!this.alive) return;
    if (this.ready) this.win.webContents.send(channel, payload);
    else this.queue.push([channel, payload]);
  }
}
