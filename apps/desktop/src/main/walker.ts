// Faz a janela do personagem passear pela tela: escolhe um ponto próximo,
// anda até ele, descansa um pouco e repete. Só anda quando o renderer
// permite (ocioso, sem mouse em cima, sem arrastar) e no modo 'roam'.
import { type BrowserWindow, screen } from 'electron';
import type { MoveMode, Point, WalkInfo } from '../shared/ipc';

const SPEED = 70; // px/s
const TICK_MS = 16;
const MIN_TRIP = 60;
const TRIP = { min: 150, max: 450 };
const REST = { min: 3000, max: 10_000 };
/** Quanto a janela pode subir além do topo da tela (só o espaço do balão fica de fora) */
const TOP_OVERFLOW = 120;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export interface WalkerEvents {
  onWalk(info: WalkInfo): void;
  /** Parou de andar (chegou ou foi interrompido) — bom momento pra salvar a posição */
  onStop(): void;
}

export class Walker {
  private allowed = false;
  private target: Point | null = null;
  private pos: Point = { x: 0, y: 0 };
  private dir: 1 | -1 = 1;
  private restUntil = Date.now() + rand(REST.min, REST.max);
  private lastTick = Date.now();
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly win: BrowserWindow,
    private readonly size: { width: number; height: number },
    private mode: MoveMode,
    private readonly events: WalkerEvents,
  ) {
    this.timer = setInterval(() => this.step(), TICK_MS);
    win.on('closed', () => clearInterval(this.timer));
  }

  setMode(mode: MoveMode): void {
    this.mode = mode;
    if (mode === 'stay') this.halt();
  }

  setAllowed(allowed: boolean): void {
    if (allowed === this.allowed) return;
    this.allowed = allowed;
    if (!allowed) this.halt();
    else this.restUntil = Math.max(this.restUntil, Date.now() + rand(1500, 4000));
  }

  private paused = false;

  /** Janela escondida: não anda (mas lembra se estava liberado) */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.halt();
  }

  /** O usuário mexeu no personagem: para e espera um pouco antes de voltar a andar */
  interrupt(): void {
    this.halt();
    this.restUntil = Date.now() + rand(5000, 10_000);
  }

  private halt(): void {
    if (!this.target) return;
    this.target = null;
    this.events.onWalk({ walking: false, dir: this.dir });
    this.events.onStop();
  }

  private step(): void {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    if (this.mode !== 'roam' || !this.allowed || this.paused || this.win.isDestroyed()) return;

    if (!this.target) {
      if (now >= this.restUntil) this.pickTarget();
      return;
    }

    const dx = this.target.x - this.pos.x;
    const dy = this.target.y - this.pos.y;
    const dist = Math.hypot(dx, dy);
    const stepLen = SPEED * dt;

    if (dist <= stepLen) {
      this.pos = { ...this.target };
      this.moveWindow();
      this.restUntil = now + rand(REST.min, REST.max);
      this.halt();
      return;
    }
    this.pos.x += (dx / dist) * stepLen;
    this.pos.y += (dy / dist) * stepLen;
    this.moveWindow();
  }

  private pickTarget(): void {
    const b = this.win.getBounds();
    const area = screen.getDisplayMatching(b).workArea;
    const angle = rand(0, Math.PI * 2);
    const dist = rand(TRIP.min, TRIP.max);
    const x = clamp(b.x + Math.cos(angle) * dist, area.x, area.x + area.width - this.size.width);
    const y = clamp(b.y + Math.sin(angle) * dist, area.y - TOP_OVERFLOW, area.y + area.height - this.size.height);

    if (Math.hypot(x - b.x, y - b.y) < MIN_TRIP) {
      this.restUntil = Date.now() + 1000; // encostado na borda — tenta outra direção logo
      return;
    }
    this.pos = { x: b.x, y: b.y };
    this.target = { x, y };
    if (Math.abs(x - b.x) > 5) this.dir = x > b.x ? 1 : -1;
    this.events.onWalk({ walking: true, dir: this.dir });
  }

  private moveWindow(): void {
    // setBounds (e não setPosition) evita a janela "crescer" com escala de DPI fracionada no Windows
    this.win.setBounds({ x: Math.round(this.pos.x), y: Math.round(this.pos.y), ...this.size });
  }
}
