// Movimento procedural mínimo do rig. Funções puras de tempo (sem DOM), testáveis.
import type { BreatheController, LayerOffset, SwayController } from './rig';

const wave = (t: number, periodMs: number) => Math.sin((t / periodMs) * Math.PI * 2);

/** Respiração: estica um pouco pra cima e afina, ancorada no pivô da camada (os filhos herdam) */
export function breathe(c: BreatheController, t: number): Record<string, LayerOffset> {
  const b = wave(t, c.period);
  return { [c.layer]: { scaleY: 1 + c.amount * b, scaleX: 1 - c.amount * 0.5 * b } };
}

const STIFFNESS = 60; // 1/s²
const DAMPING = 7; // 1/s
const MAX_DT = 1 / 20;
/** Atraso de fase entre um segmento e o próximo (fração do período) */
const PHASE_LAG = 0.12;

/**
 * Balanço em cadeia (cauda): cada segmento persegue, com uma mola, um seno lento com
 * atraso de fase em relação ao anterior; `drive` (graus) empurra a cadeia toda pro
 * lado oposto do movimento do corpo — ao balançar/andar a cauda "fica pra trás".
 * Ângulos são relativos ao pai (a hierarquia soma), então a ponta mexe mais.
 */
export class ChainSway {
  private readonly angle: number[];
  private readonly velocity: number[];
  private last: number | null = null;

  constructor(private readonly c: SwayController) {
    this.angle = c.layers.map(() => 0);
    this.velocity = c.layers.map(() => 0);
  }

  step(now: number, drive = 0): Record<string, LayerOffset> {
    const dt = this.last === null ? 0 : Math.min(MAX_DT, (now - this.last) / 1000);
    this.last = now;
    const out: Record<string, LayerOffset> = {};
    const n = this.c.layers.length;
    this.c.layers.forEach((id, i) => {
      const share = 1 / n;
      const target = this.c.amplitude * share * wave(now - i * PHASE_LAG * this.c.period, this.c.period) + drive * share;
      if (dt > 0) {
        const accel = STIFFNESS * (target - this.angle[i]!) - DAMPING * this.velocity[i]!;
        this.velocity[i]! += accel * dt;
        this.angle[i]! += this.velocity[i]! * dt;
      }
      out[id] = { rotation: this.angle[i]! };
    });
    return out;
  }

  reset(): void {
    this.angle.fill(0);
    this.velocity.fill(0);
    this.last = null;
  }
}

/** Junta ajustes de vários controladores (rotação e deslocamento somam; escala multiplica) */
export function mergeOffsets(...parts: Record<string, LayerOffset>[]): Record<string, LayerOffset> {
  const out: Record<string, LayerOffset> = {};
  for (const part of parts) {
    for (const [id, o] of Object.entries(part)) {
      const cur = out[id] ?? {};
      out[id] = cur;
      if (o.rotation !== undefined) cur.rotation = (cur.rotation ?? 0) + o.rotation;
      if (o.dx !== undefined) cur.dx = (cur.dx ?? 0) + o.dx;
      if (o.dy !== undefined) cur.dy = (cur.dy ?? 0) + o.dy;
      if (o.scaleX !== undefined) cur.scaleX = (cur.scaleX ?? 1) * o.scaleX;
      if (o.scaleY !== undefined) cur.scaleY = (cur.scaleY ?? 1) * o.scaleY;
    }
  }
  return out;
}
