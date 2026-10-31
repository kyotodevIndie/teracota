// Passeio executado no renderer: o main escolhe o destino (conhece os monitores) e manda
// o plano; o renderer anda a janela a cada quadro da tela, junto com o desenho.
import type { Point, WalkPlan } from '../shared/ipc';

export interface WalkStep {
  position: Point;
  done: boolean;
}

/** Posição (px inteiros) depois de `elapsedMs` andando em linha reta na velocidade do plano */
export function walkStep(plan: WalkPlan, elapsedMs: number): WalkStep {
  const dx = plan.to.x - plan.from.x;
  const dy = plan.to.y - plan.from.y;
  const dist = Math.hypot(dx, dy);
  const travelled = (Math.max(0, elapsedMs) / 1000) * plan.speed;
  if (dist === 0 || travelled >= dist) return { position: { x: Math.round(plan.to.x), y: Math.round(plan.to.y) }, done: true };
  const k = travelled / dist;
  return { position: { x: Math.round(plan.from.x + dx * k), y: Math.round(plan.from.y + dy * k) }, done: false };
}
