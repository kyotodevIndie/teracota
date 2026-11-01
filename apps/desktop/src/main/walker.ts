// Planeja os passeios da Tera: escolhe um ponto próximo, manda o plano pro renderer
// (que anda a janela a cada quadro da tela, junto com o desenho), descansa e repete.
// Só anda quando o renderer permite (ocioso, sem mouse em cima, sem arrastar, sem
// movimento reduzido) e no modo 'roam'.
import type { MoveMode, Point, WalkInfo, WalkPlan } from '../shared/ipc';
import { type Rect, type Size, clampToArea } from './geometry';

export const SPEED = 70; // px/s
const TICK_MS = 200; // só agenda; o movimento em si é no renderer
const MIN_TRIP = 60;
const TRIP = { min: 150, max: 450 };
const REST = { min: 3000, max: 10_000 };
/** Folga pro renderer avisar que chegou antes do main desistir do trecho */
const ARRIVAL_GRACE_MS = 1500;

const rand = (min: number, max: number) => min + Math.random() * (max - min);

export interface WalkerEvents {
  onWalk(info: WalkInfo): void;
  /** Parou de andar (chegou ou foi interrompido) — bom momento pra salvar a posição */
  onStop(): void;
}

/** O que o Walker precisa da janela e da tela (injetável nos testes) */
export interface WalkerHost {
  position(): Point;
  /** Área útil do monitor onde a janela está */
  workArea(): Rect;
  moveTo(p: Point): void;
  alive(): boolean;
}

export class Walker {
  private allowed = false;
  private paused = false;
  private held = false;
  private plan: WalkPlan | null = null;
  private deadline = 0;
  private dir: 1 | -1 = 1;
  private restUntil = Date.now() + rand(REST.min, REST.max);
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly host: WalkerHost,
    private readonly size: Size,
    private mode: MoveMode,
    private readonly events: WalkerEvents,
  ) {
    this.timer = setInterval(() => this.check(), TICK_MS);
  }

  get walking(): boolean {
    return this.plan !== null;
  }

  dispose(): void {
    clearInterval(this.timer);
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

  /** Janela escondida: não anda (mas lembra se estava liberado) */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.halt();
  }

  /** Segura parada (ex.: a interface está aberta presa nela) */
  setHeld(held: boolean): void {
    this.held = held;
    if (held) this.halt();
  }

  /** O usuário mexeu no personagem: para e espera um pouco antes de voltar a andar */
  interrupt(): void {
    this.halt();
    this.restUntil = Date.now() + rand(5000, 10_000);
  }

  /** Passo vindo do renderer; ignorado se não há trecho em andamento (ex.: chegou atrasado) */
  stepTo(p: Point): void {
    if (!this.plan) return;
    this.host.moveTo(clampToArea(p, this.size, this.host.workArea()));
  }

  /** O renderer chegou ao fim do trecho */
  arrived(): void {
    if (!this.plan) return;
    this.host.moveTo(this.plan.to);
    this.restUntil = Date.now() + rand(REST.min, REST.max);
    this.halt();
  }

  private halt(): void {
    if (!this.plan) return;
    this.plan = null;
    this.events.onWalk({ walking: false, dir: this.dir });
    this.events.onStop();
  }

  private check(): void {
    if (!this.host.alive()) {
      this.dispose();
      return;
    }
    const now = Date.now();
    if (this.plan) {
      // o renderer sumiu (janela travada, recarregando): não fica "andando" pra sempre
      if (now > this.deadline) this.halt();
      return;
    }
    if (this.mode !== 'roam' || !this.allowed || this.paused || this.held || now < this.restUntil) return;
    this.pickTarget(now);
  }

  private pickTarget(now: number): void {
    const from = this.host.position();
    const area = this.host.workArea();
    const angle = rand(0, Math.PI * 2);
    const dist = rand(TRIP.min, TRIP.max);
    const to = clampToArea({ x: from.x + Math.cos(angle) * dist, y: from.y + Math.sin(angle) * dist }, this.size, area);
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length < MIN_TRIP) {
      this.restUntil = now + 1000; // encostado na borda — tenta outra direção logo
      return;
    }
    if (Math.abs(to.x - from.x) > 5) this.dir = to.x > from.x ? 1 : -1;
    this.plan = { from, to, speed: SPEED, dir: this.dir };
    this.deadline = now + (length / SPEED) * 1000 + ARRIVAL_GRACE_MS;
    this.events.onWalk({ walking: true, dir: this.dir, plan: this.plan });
  }
}
