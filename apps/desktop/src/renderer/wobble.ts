// Movimento procedural contínuo por cima dos frames da skin (respirar, balançar,
// quicar ao andar, pêndulo ao ser carregada). Com só 4 frames por animação, é o
// que deixa o personagem fluido — roda a cada quadro da tela.
import type { Pose } from '@tera/character/skin';

export interface Wobble {
  /** Deslocamento em px de tela */
  dx: number;
  dy: number;
  /** Escala (1 = normal) */
  sx: number;
  sy: number;
  /** Rotação em graus (positivo = horário) */
  rot: number;
  /** Ponto fixo das transformações, em fração da altura do frame (pés ≈ 0.945) */
  pivotY: number;
}

export const FEET_Y = 484 / 512;
const GRIP_Y = 0.04; // ponto por onde ela é segurada ao ser arrastada

const wave = (t: number, periodMs: number) => Math.sin((t / periodMs) * Math.PI * 2);

/** Respiração: estica um pouco pra cima e afina, ancorado nos pés */
function breathe(w: Wobble, t: number, periodMs: number, amount: number): void {
  const b = wave(t, periodMs);
  w.sy = 1 + amount * b;
  w.sx = 1 - amount * 0.5 * b;
}

/**
 * @param t   ms desde que a animação atual começou
 * @param dir direção do passeio (1 direita, -1 esquerda)
 */
export function wobbleFor(pose: Pose, t: number, dir: 1 | -1): Wobble {
  const w: Wobble = { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, pivotY: FEET_Y };
  switch (pose) {
    case 'idle':
    case 'talk':
    case 'wave':
    case 'surprised':
    case 'land':
      breathe(w, t, 2600, 0.012);
      break;
    case 'think':
      breathe(w, t, 2600, 0.01);
      w.rot = 1.5 * wave(t, 3400);
      break;
    case 'sad':
    case 'sleep':
      breathe(w, t, 3600, 0.018);
      break;
    case 'work':
      breathe(w, t, 2600, 0.008);
      w.dy = -1.2 * Math.abs(wave(t, 640)); // mexendo no ritmo da digitação
      break;
    case 'walk': {
      // 2 passos por ciclo de 4 frames (140ms cada): sobe no meio de cada passo
      const s = Math.abs(Math.sin(((t - 70) / 280) * Math.PI));
      w.dy = -3.5 * s;
      w.sy = 1 + 0.02 * (s - 0.5);
      w.sx = 1 - 0.01 * (s - 0.5);
      w.rot = 2 * dir; // inclina pra frente
      break;
    }
    case 'drag':
      w.pivotY = GRIP_Y; // o balanço em si vem da física (pendulum.ts)
      break;
    case 'happy': {
      const s = wave(t, 700);
      w.sy = 1 + 0.015 * s;
      w.sx = 1 - 0.01 * s;
      break;
    }
    case 'error':
      w.dx = 1.2 * wave(t, 140); // tremidinha
      break;
  }
  return w;
}
