// Geometria da janela da Tera em relação aos monitores (sem Electron, testável).
import type { Point } from '../shared/ipc';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Quanto a janela pode subir além do topo da área útil (só o espaço do balão fica de fora) */
export const TOP_OVERFLOW = 120;
/** Quanto a janela pode passar das laterais (a borda da janela é transparente) */
export const SIDE_OVERFLOW = 30;

/** Prende a posição da janela numa área útil, deixando a personagem inteira visível */
export function clampToArea(p: Point, size: Size, area: Rect): Point {
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));
  return {
    x: Math.round(clamp(p.x, area.x - SIDE_OVERFLOW, area.x + area.width - size.width + SIDE_OVERFLOW)),
    y: Math.round(clamp(p.y, area.y - TOP_OVERFLOW, area.y + area.height - size.height)),
  };
}

/** Ponto de referência da personagem (meio, um pouco acima dos pés) */
export function anchorOf(p: Point, size: Size): Point {
  return { x: p.x + size.width / 2, y: p.y + size.height - 100 };
}

export function contains(area: Rect, p: Point): boolean {
  return p.x >= area.x && p.x <= area.x + area.width && p.y >= area.y && p.y <= area.y + area.height;
}

/** Área (de uma lista) mais próxima de um ponto: a que contém, ou a de menor distância */
export function nearestArea(areas: Rect[], p: Point): Rect | null {
  let best: Rect | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const a of areas) {
    const dx = Math.max(a.x - p.x, 0, p.x - (a.x + a.width));
    const dy = Math.max(a.y - p.y, 0, p.y - (a.y + a.height));
    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

/**
 * Onde a janela deve ficar: se a personagem está numa área útil, só prende nela; se
 * caiu fora de todas (monitor desligado, arrastada pra fora), vai pra mais próxima.
 */
export function recoverPosition(p: Point, size: Size, areas: Rect[]): Point {
  const anchor = anchorOf(p, size);
  const area = areas.find((a) => contains(a, anchor)) ?? nearestArea(areas, anchor);
  return area ? clampToArea(p, size, area) : p;
}
