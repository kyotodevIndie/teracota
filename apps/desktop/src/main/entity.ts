// Uma entidade = uma Tera na tela: janela transparente + passeio + ponte de IPC.
import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { CHARACTER_NAME } from '../shared/brand';
import { IPC, type Identity, type MotionInfo, type MoveMode, type Point } from '../shared/ipc';
import type { CompanionEvent } from '../shared/protocol';
import { recoverPosition } from './geometry';
import { Walker } from './walker';

export const SIZE = { width: 320, height: 440 };

/**
 * Linux (X11/XWayland): a área clicável é um recorte da janela (setShape), não o
 * "ignorar o mouse e reativar quando ele passa em cima" do Windows/macOS. No XWayland o
 * app só sabe onde está o cursor quando ele está sobre uma janela X11; com a janela
 * ignorando o mouse, ele nunca "entra", e a Tera ficava impossível de clicar.
 */
export const USE_SHAPE = process.platform === 'linux';
const MAX_SHAPE_RECTS = 200;

/** Valida os retângulos vindos do renderer (inteiros, dentro da janela) */
export function parseShape(input: unknown): Electron.Rectangle[] | null {
  if (!Array.isArray(input) || input.length > MAX_SHAPE_RECTS) return null;
  const out: Electron.Rectangle[] = [];
  for (const r of input) {
    const o = r as Record<string, unknown> | null;
    const nums = [o?.x, o?.y, o?.width, o?.height];
    if (!nums.every((n) => typeof n === 'number' && Number.isInteger(n))) return null;
    const [x, y, width, height] = nums as number[];
    if (x! < 0 || y! < 0 || width! <= 0 || height! <= 0 || x! + width! > SIZE.width || y! + height! > SIZE.height) return null;
    out.push({ x: x!, y: y!, width: width!, height: height! });
  }
  return out;
}
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

/** Posição dentro da área útil de algum monitor (o mais próximo, se caiu fora de todos) */
export function onScreenPosition(p: Point): Point {
  return recoverPosition(p, SIZE, screen.getAllDisplays().map((d) => d.workArea));
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
  private motion: MotionInfo = { reduced: false };

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
    // Cliques atravessam a janela, exceto sobre o personagem (o renderer alterna isso, ou
    // manda o recorte no Linux; até o primeiro recorte chegar, a janela inteira é clicável)
    if (!USE_SHAPE) this.win.setIgnoreMouseEvents(true, { forward: true });
    this.win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    this.win.once('ready-to-show', () => { if (opts.visible !== false) this.win.showInactive(); });
    let last = '';
    this.win.webContents.on('did-finish-load', () => {
      this.ready = true;
      // página nova (ou recarregada) começa deixando o clique passar, e recebe o cursor de novo
      if (!USE_SHAPE) this.win.setIgnoreMouseEvents(true, { forward: true });
      last = '';
      this.win.webContents.send(IPC.mode, { mode: this.moveMode, announce: false });
      this.win.webContents.send(IPC.identity, this.identity);
      this.win.webContents.send(IPC.motion, this.motion);
      for (const [channel, payload] of this.queue.splice(0)) this.win.webContents.send(channel, payload);
    });

    this.walker = new Walker({
      position: () => this.position,
      workArea: () => screen.getDisplayMatching(this.win.getBounds()).workArea,
      moveTo: (p) => this.moveTo(p),
      alive: () => this.alive,
    }, SIZE, opts.moveMode, {
      onWalk: (info) => this.post(IPC.walk, info),
      onStop: () => this.settle(),
    });
    this.win.on('closed', () => this.walker.dispose());

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

  setMotion(motion: MotionInfo): void {
    this.motion = motion;
    this.post(IPC.motion, motion);
  }

  /** Passo do passeio vindo do renderer */
  walkTo(p: Point): void {
    this.walker.stepTo(p);
  }

  walkArrived(): void {
    this.walker.arrived();
  }

  setIgnoreMouse(ignore: boolean): void {
    if (this.alive && !USE_SHAPE) this.win.setIgnoreMouseEvents(ignore, { forward: true });
  }

  /** Recorte da área clicável (só Linux); payload inválido é ignorado */
  setShape(input: unknown): void {
    if (!this.alive || !USE_SHAPE) return;
    const rects = parseShape(input);
    if (rects) this.win.setShape(rects);
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

  /** Parou num lugar novo (soltou do arrasto, fim do passeio): garante que ficou visível e salva */
  settle(): void {
    if (!this.alive) return;
    this.ensureOnScreen();
    this.onSettle?.(this.position);
  }

  /** Solta fora da tela ou num monitor que sumiu: volta pra área útil mais próxima */
  ensureOnScreen(): void {
    if (!this.alive) return;
    const p = this.position;
    const fixed = onScreenPosition(p);
    if (fixed.x !== p.x || fixed.y !== p.y) {
      this.walker.interrupt();
      this.moveTo(fixed);
    }
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
