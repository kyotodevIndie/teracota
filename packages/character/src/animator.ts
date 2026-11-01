// Animação do rig por quadro, sem DOM: a partir do estado pedido (pose, expressão, fala,
// movimento, olhar) calcula o ajuste de cada camada e qual variante de imagem mostrar.
//
// - Poses mudam com transição suave (cada valor persegue o alvo com uma constante de
//   tempo), então trocar de estado nunca dá "pulo".
// - Respiração e balanço usam o relógio contínuo: não reiniciam a fase a cada troca.
// - Movimento reduzido desliga tudo que é procedural e contínuo (respirar, balançar,
//   cauda, olhar, passos); piscada e boca continuam, porque comunicam estado.
import { ChainSway, breathe, mergeOffsets } from './controllers';
import type { LayerOffset, PoseLayer, RigManifest } from './rig';

export type RigMotion = 'walk' | 'drag' | null;

export interface AnimatorInput {
  /** Pose pedida (idle, work, sleep...). Pose sem definição no rig = idle; '' = repouso */
  pose: string;
  expression: string;
  talking: boolean;
  motion: RigMotion;
  /** 1 = direita, -1 = esquerda */
  dir: 1 | -1;
  /** Pra onde olhar, normalizado em [-1, 1] (0,0 = pra frente); null = pra frente */
  gaze: [number, number] | null;
  /** Empurrão da cauda/cabelo (ex.: velocidade do balanço ao arrastar), em graus */
  drive: number;
  reducedMotion: boolean;
}

export interface AnimatorFrame {
  offsets: Record<string, LayerOffset>;
  /** Variante a desenhar em cada camada (ausente = "default") */
  variants: Record<string, string>;
  /** Camadas escondidas neste quadro */
  hidden: Set<string>;
}

/** Constante de tempo das transições entre poses (ms): ~95% do caminho em 3τ */
export const POSE_TAU_MS = 90;
/** Constante de tempo do olhar (ms) */
const GAZE_TAU_MS = 140;
const NUMERIC = ['rotation', 'dx', 'dy', 'scaleX', 'scaleY'] as const;
type Numeric = (typeof NUMERIC)[number];
const NEUTRAL: Record<Numeric, number> = { rotation: 0, dx: 0, dy: 0, scaleX: 1, scaleY: 1 };

/** Fração do caminho até o alvo percorrida em dt (aproximação exponencial, independe do fps) */
export function approach(dtMs: number, tauMs: number): number {
  if (dtMs <= 0) return 0;
  if (tauMs <= 0) return 1;
  return 1 - Math.exp(-dtMs / tauMs);
}

export class RigAnimator {
  private readonly sway: ChainSway | null;
  /** Valores atuais (já suavizados) por camada */
  private readonly current = new Map<string, Record<Numeric, number>>();
  private gaze: [number, number] = [0, 0];
  private last: number | null = null;
  private nextBlink: number;
  private blinkUntil = 0;
  private walkPhase = 0;

  constructor(readonly rig: RigManifest, private readonly random: () => number = Math.random, now = 0) {
    this.sway = rig.controllers.sway ? new ChainSway(rig.controllers.sway) : null;
    this.nextBlink = now + this.blinkGap();
  }

  frame(now: number, input: AnimatorInput): AnimatorFrame {
    const dt = this.last === null ? Number.POSITIVE_INFINITY : Math.min(250, now - this.last);
    this.last = now;
    const { rig } = this;
    // pose vazia ('') = o repouso do rig, sem pose nenhuma (o Skin Studio monta o rig assim)
    const pose: Record<string, PoseLayer> = input.pose === '' ? {} : rig.poses[input.pose]?.layers ?? rig.poses.idle?.layers ?? {};

    // 1. pose: cada camada persegue o alvo da pose atual (sem pose = repouso)
    const k = dt === Number.POSITIVE_INFINITY ? 1 : approach(dt, POSE_TAU_MS);
    const offsets: Record<string, LayerOffset> = {};
    const ids = new Set([...this.current.keys(), ...Object.keys(pose)]);
    for (const id of ids) {
      const target = pose[id];
      const cur = this.current.get(id) ?? { ...NEUTRAL };
      let settled = !target;
      for (const key of NUMERIC) {
        const goal = target?.[key] ?? NEUTRAL[key];
        cur[key] += (goal - cur[key]) * k;
        if (Math.abs(goal - cur[key]) > 1e-3) settled = false;
      }
      if (settled) this.current.delete(id); // voltou ao repouso: não precisa mais acompanhar
      else this.current.set(id, cur);
      offsets[id] = { ...cur };
    }

    // 2. variantes e visibilidade: camada → pose → expressão → piscada → fala
    const variants: Record<string, string> = {};
    const hidden = new Set<string>();
    for (const l of rig.layers) if (!l.visible) hidden.add(l.id);
    for (const [id, p] of Object.entries(pose)) {
      if (p.variant) variants[id] = p.variant;
      if (p.visible === true) hidden.delete(id);
      if (p.visible === false) hidden.add(id);
    }
    Object.assign(variants, rig.expressions[input.expression] ?? {});
    this.applyBlink(now, variants);
    this.applyTalk(now, input.talking, variants);

    // 3. movimento procedural contínuo
    const parts: Record<string, LayerOffset>[] = [offsets];
    if (!input.reducedMotion) {
      if (rig.controllers.breathe) parts.push(breathe(rig.controllers.breathe, now));
      if (this.sway) {
        const walkDrive = input.motion === 'walk' ? -10 * input.dir : 0;
        parts.push(this.sway.step(now, input.drive + walkDrive));
      }
      parts.push(this.walkOffsets(dt, input));
      parts.push(this.gazeOffsets(dt, input.gaze));
    }
    return { offsets: mergeOffsets(...parts), variants, hidden };
  }

  private blinkGap(): number {
    const b = this.rig.controllers.blink;
    if (!b) return Number.POSITIVE_INFINITY;
    return b.interval[0] + this.random() * (b.interval[1] - b.interval[0]);
  }

  /** Pisca só quando os olhos abertos estão aparecendo (dormindo/feliz já têm olhos próprios) */
  private applyBlink(now: number, variants: Record<string, string>): void {
    const b = this.rig.controllers.blink;
    if (!b) return;
    const showing = variants[b.layer] ?? 'default';
    if (now >= this.nextBlink) {
      this.blinkUntil = now + b.duration;
      this.nextBlink = now + b.duration + this.blinkGap();
    }
    if (now < this.blinkUntil && showing === b.open) variants[b.layer] = b.closed;
  }

  private applyTalk(now: number, talking: boolean, variants: Record<string, string>): void {
    const t = this.rig.controllers.talk;
    if (!t || !talking) return;
    variants[t.layer] = t.variants[Math.floor(now / t.period) % t.variants.length]!;
  }

  private walkOffsets(dt: number, input: AnimatorInput): Record<string, LayerOffset> {
    const w = this.rig.controllers.walk;
    if (!w) return {};
    if (input.motion === 'walk') {
      this.walkPhase += (Number.isFinite(dt) ? dt : 0) / w.period;
    } else {
      // parou: termina o passo até a perna mais próxima do centro, sem estalar
      const frac = this.walkPhase % 0.5;
      if (frac > 1e-3 && Number.isFinite(dt)) this.walkPhase += Math.min(0.5 - frac, dt / w.period);
    }
    const s = Math.sin(this.walkPhase * Math.PI * 2);
    const out: Record<string, LayerOffset> = {
      [w.legs[0]]: { rotation: w.swing * s },
      [w.legs[1]]: { rotation: -w.swing * s },
    };
    if (w.arms) {
      out[w.arms[0]] = { rotation: -w.swing * 0.6 * s };
      out[w.arms[1]] = { rotation: w.swing * 0.6 * s };
    }
    return out;
  }

  private gazeOffsets(dt: number, gaze: [number, number] | null): Record<string, LayerOffset> {
    const g = this.rig.controllers.gaze;
    if (!g) return {};
    const target: [number, number] = gaze ? [clamp1(gaze[0]), clamp1(gaze[1])] : [0, 0];
    const k = Number.isFinite(dt) ? approach(dt, GAZE_TAU_MS) : 1;
    this.gaze = [this.gaze[0] + (target[0] - this.gaze[0]) * k, this.gaze[1] + (target[1] - this.gaze[1]) * k];
    const out: Record<string, LayerOffset> = { [g.layer]: { dx: this.gaze[0] * g.max[0], dy: this.gaze[1] * g.max[1] } };
    if (g.head) out[g.head] = { rotation: this.gaze[0] * g.headMax };
    return out;
  }
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
