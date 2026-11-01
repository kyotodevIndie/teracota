// Onde a interface fica: presa na Tera, em cima dela; sem espaço em cima, embaixo.
// Contas puras (testáveis); quem aplica é o PanelWindow.
import type { Rectangle } from 'electron';

/** Largura da janela da interface (o conteúdo tem margem pra sombra) */
export const PANEL_WIDTH = 420;
/** Onde a personagem fica dentro da janela da Tera (320×440): cabeça e pés, aproximados */
export const CHARACTER_TOP = 190;
export const CHARACTER_BOTTOM = 420;
/** Espaço mínimo pra preferir abrir em cima */
export const MIN_ABOVE = 360;
const GAP = 2;
const EDGE = 8;
const TAIL_MARGIN = 28;

export interface Placement {
  x: number;
  y: number;
  height: number;
  side: 'above' | 'below';
  tailX: number;
  maxHeight: number;
}

/**
 * tera = janela da Tera; contentHeight = altura que a interface quer; area = área útil do monitor.
 * Prefere em cima; embaixo só se em cima couber menos que o necessário e embaixo couber mais.
 */
export function placePanel(tera: Rectangle, contentHeight: number, area: Rectangle, width = PANEL_WIDTH): Placement {
  const head = tera.y + CHARACTER_TOP;
  const feet = tera.y + CHARACTER_BOTTOM;
  const spaceAbove = Math.max(0, head - GAP - (area.y + EDGE));
  const spaceBelow = Math.max(0, area.y + area.height - EDGE - (feet + GAP));
  const fitsAbove = spaceAbove >= Math.min(contentHeight, MIN_ABOVE);
  const side: Placement['side'] = fitsAbove || spaceAbove >= spaceBelow ? 'above' : 'below';
  const maxHeight = Math.max(120, side === 'above' ? spaceAbove : spaceBelow);
  const height = Math.max(1, Math.min(Math.round(contentHeight), maxHeight));
  const center = tera.x + tera.width / 2;
  const x = Math.round(Math.min(Math.max(center - width / 2, area.x + EDGE), area.x + area.width - EDGE - width));
  const y = side === 'above' ? Math.round(head - GAP - height) : Math.round(feet + GAP);
  const tailX = Math.round(Math.min(Math.max(center - x, TAIL_MARGIN), width - TAIL_MARGIN));
  return { x, y, height, side, tailX, maxHeight: Math.floor(maxHeight) };
}
