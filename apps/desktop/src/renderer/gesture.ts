// Clique × arrasto × carinho, sem DOM (testável). O carinho não passa por aqui: é mexer
// o mouse em cima dela SEM apertar (pet.ts). Apertar e soltar sem andar = clique; andar
// mais que o limite com o botão apertado = arrasto, e soltar um arrasto nunca é clique.

export const DRAG_THRESHOLD = 4;

export type GestureEvent =
  | { type: 'drag-start' }
  | { type: 'drag'; dx: number; dy: number }
  | { type: 'drag-end' }
  | { type: 'click' };

export class PointerGesture {
  private pressed: { x: number; y: number; moved: number } | null = null;
  private dragging = false;

  get active(): boolean {
    return this.pressed !== null;
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  down(x: number, y: number): void {
    this.pressed = { x, y, moved: 0 };
    this.dragging = false;
  }

  /** Movimento com o botão apertado (coordenadas de tela) */
  move(x: number, y: number): GestureEvent[] {
    const p = this.pressed;
    if (!p) return [];
    const dx = x - p.x;
    const dy = y - p.y;
    p.x = x;
    p.y = y;
    p.moved += Math.abs(dx) + Math.abs(dy);
    const out: GestureEvent[] = [];
    if (!this.dragging && p.moved > DRAG_THRESHOLD) {
      this.dragging = true;
      out.push({ type: 'drag-start' });
    }
    if (this.dragging && (dx || dy)) out.push({ type: 'drag', dx, dy });
    return out;
  }

  /**
   * Fim do gesto. `clicked` = o botão foi solto de verdade em cima dela; false quando o
   * "soltar" se perdeu (janela perdeu o foco, botão solto fora) — aí nunca é clique.
   */
  up(clicked: boolean): GestureEvent | null {
    if (!this.pressed) return null;
    const wasDragging = this.dragging;
    this.pressed = null;
    this.dragging = false;
    if (wasDragging) return { type: 'drag-end' };
    return clicked ? { type: 'click' } : null;
  }
}
