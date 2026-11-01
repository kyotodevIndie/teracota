// Janela da interface da Tera: presa nela, como notificações empilhadas. A janela é
// transparente e do tamanho do conteúdo; o desktop aparece em volta e entre os cartões.
// Abre em cima da Tera (sem espaço, embaixo) e acompanha quando ela é arrastada.
// Dois jeitos de aparecer: full (a interface, com foco) e peek (só o pedido de uma IA, sem
// roubar o foco). Fechar só esconde; a personagem não depende desta janela.
import { BrowserWindow, screen, type Rectangle } from 'electron';
import path from 'node:path';
import { PANEL_IPC, type BridgeEvent } from '@tera/agent-bridge/contract';
import { APP_PANEL_IPC } from '../../shared/app-panel';
import type { PanelMode, PanelPlacement } from '../../shared/live';
import { PANEL_WIDTH, placePanel } from './anchor';

/** Linux (X11/XWayland): cliques nos vãos entre os cartões passam pro desktop (setShape) */
const USE_SHAPE = process.platform === 'linux';
const MAX_RECTS = 64;
const MAX_HEIGHT = 4000;
/** Clique fora fecha; um clique na Tera logo depois não reabre */
const BLUR_TOGGLE_MS = 400;

export interface PanelWindowOptions {
  /** Janela da Tera onde a interface fica presa (null = sem Tera na tela) */
  anchor(): Rectangle | null;
  /** Abriu ou fechou (a Tera fica parada enquanto está aberta) */
  onVisibility?(visible: boolean): void;
}

/** Retângulos do recorte vindos da interface: inteiros e dentro da janela */
export function parsePanelShape(input: unknown, width: number, height: number): Rectangle[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_RECTS) return null;
  const out: Rectangle[] = [];
  for (const r of input) {
    const o = r as Record<string, unknown> | null;
    const nums = [o?.x, o?.y, o?.width, o?.height];
    if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    const [x, y, w, h] = (nums as number[]).map(Math.round) as [number, number, number, number];
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(width, x + w);
    const y1 = Math.min(height, y + h);
    if (x1 > x0 && y1 > y0) out.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }
  return out.length ? out : null;
}

export class PanelWindow {
  private win: BrowserWindow | null = null;
  private quitting = false;
  private mode: PanelMode = 'full';
  private contentHeight = 480;
  private shape: unknown = null;
  private lastPlacement = '';
  /** Um diálogo do sistema (escolher pasta) está aberto: perder o foco pra ele não fecha */
  private dialogOpen = false;
  /** Quando fechou por clicar fora (o mesmo clique, se foi na Tera, não reabre) */
  private blurHiddenAt = 0;

  constructor(private readonly opts: PanelWindowOptions) {}

  private get alive(): boolean {
    return !!this.win && !this.win.isDestroyed();
  }

  /** Janela nativa (pra ancorar diálogos), se existir */
  get native(): BrowserWindow | null {
    return this.alive ? this.win : null;
  }

  /** O remetente de um IPC é esta janela? */
  isSender(sender: unknown): boolean {
    return this.alive && this.win!.webContents === sender;
  }

  get visible(): boolean {
    return this.alive && this.win!.isVisible();
  }

  get currentMode(): PanelMode {
    return this.mode;
  }

  /** Abre a interface completa (cria na primeira vez) e foca */
  show(): void {
    this.open('full');
  }

  /** Mostra só o pedido de uma IA, sem roubar o foco; não atrapalha a interface já aberta */
  peek(): void {
    if (this.visible && this.mode === 'full') return;
    this.open('peek');
  }

  /** Clique na Tera: abre; se já está aberta por inteiro, fecha */
  toggle(): void {
    if (this.visible && this.mode === 'full') this.hide();
    // o clique na Tera já fechou a interface (perdeu o foco): esse clique era pra fechar
    else if (Date.now() - this.blurHiddenAt < BLUR_TOGGLE_MS) this.blurHiddenAt = 0;
    else this.show();
  }

  /** Roda um diálogo do sistema sem a interface fechar por perder o foco */
  async withDialog<T>(fn: () => Promise<T>): Promise<T> {
    this.dialogOpen = true;
    try {
      return await fn();
    } finally {
      this.dialogOpen = false;
      this.win?.focus();
    }
  }

  /** Recolhe sem encerrar nada */
  hide(): void {
    if (!this.alive || !this.win!.isVisible()) return;
    this.win!.hide();
    this.opts.onVisibility?.(false);
  }

  /** A interface mediu o conteúdo (e, no Linux, onde estão os cartões) */
  layout(height: unknown, shape: unknown): void {
    if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return;
    this.contentHeight = Math.min(MAX_HEIGHT, Math.ceil(height));
    this.shape = shape;
    this.reposition();
  }

  /** A Tera mexeu (ou o monitor mudou): a interface vai junto */
  reposition(): void {
    if (!this.alive) return;
    const tera = this.opts.anchor();
    const area = tera ? screen.getDisplayMatching(tera).workArea : screen.getPrimaryDisplay().workArea;
    const anchor = tera ?? { x: area.x + area.width - 340, y: area.y + area.height - 440, width: 320, height: 440 };
    const p = placePanel(anchor, this.contentHeight, area);
    const b = this.win!.getBounds();
    if (b.x !== p.x || b.y !== p.y || b.width !== PANEL_WIDTH || b.height !== p.height) {
      this.win!.setBounds({ x: p.x, y: p.y, width: PANEL_WIDTH, height: p.height });
    }
    if (USE_SHAPE) {
      const rects = parsePanelShape(this.shape, PANEL_WIDTH, p.height);
      this.win!.setShape(rects ?? [{ x: 0, y: 0, width: PANEL_WIDTH, height: p.height }]);
    }
    const placement: PanelPlacement = { mode: this.mode, side: p.side, tailX: p.tailX, maxHeight: p.maxHeight };
    const key = JSON.stringify(placement);
    if (key !== this.lastPlacement) {
      this.lastPlacement = key;
      this.win!.webContents.send(APP_PANEL_IPC.placement, placement);
    }
  }

  /** Repassa um evento do bridge (conversa pela API) */
  send(event: BridgeEvent): void {
    if (!this.alive) return;
    this.win!.webContents.send(PANEL_IPC.event, event);
    if (event.type === 'permission-request' && !this.win!.isVisible()) this.peek();
  }

  /** Mensagem crua pra interface (ex.: saída do terminal); ignorada se a janela não existe */
  sendRaw(channel: string, payload: unknown): void {
    if (this.alive) this.win!.webContents.send(channel, payload);
  }

  /** Chamar no before-quit: a partir daí fechar fecha de verdade */
  markQuitting(): void {
    this.quitting = true;
  }

  destroy(): void {
    this.markQuitting();
    if (this.alive) this.win!.destroy();
  }

  private open(mode: PanelMode): void {
    const wasVisible = this.visible;
    if (!this.alive) this.create();
    const win = this.win!;
    this.mode = mode;
    this.lastPlacement = '';
    this.reposition();
    if (mode === 'full') {
      win.show();
      win.focus();
    } else if (!wasVisible) {
      win.showInactive();
    }
    if (!wasVisible) this.opts.onVisibility?.(true);
  }

  private create(): void {
    const win = new BrowserWindow({
      width: PANEL_WIDTH,
      height: this.contentHeight,
      title: 'Tera',
      // só os cartões aparecem: sem moldura, sem fundo, sem sombra da janela
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      // fica junto da Tera, que está sempre no topo
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'panel-preload.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.setAlwaysOnTop(true, 'floating');
    win.setMenu?.(null);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.on('did-finish-load', () => {
      this.lastPlacement = '';
      this.reposition();
    });
    win.on('close', (e) => {
      if (this.quitting) return;
      e.preventDefault();
      this.hide();
    });
    win.on('closed', () => { if (this.win === win) this.win = null; });
    // clicou fora: fecha (como um menu); o pedido sozinho (peek) não tem foco e fica
    win.on('blur', () => {
      if (this.quitting || this.dialogOpen || this.mode !== 'full' || !win.isVisible()) return;
      this.blurHiddenAt = Date.now();
      this.hide();
    });
    win.loadFile(path.join(__dirname, 'renderer', 'panel.html'));
    this.win = win;
  }
}
