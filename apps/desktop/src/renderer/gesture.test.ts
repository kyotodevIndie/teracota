import { describe, expect, it } from 'vitest';
import { DRAG_THRESHOLD, PointerGesture } from './gesture';

describe('PointerGesture', () => {
  it('apertar e soltar parado é clique', () => {
    const g = new PointerGesture();
    g.down(100, 100);
    expect(g.move(101, 100)).toEqual([]); // tremidinha da mão não vira arrasto
    expect(g.up(true)).toEqual({ type: 'click' });
  });

  it('andar além do limite vira arrasto, e soltar o arrasto NÃO é clique', () => {
    const g = new PointerGesture();
    g.down(100, 100);
    const ev = g.move(100 + DRAG_THRESHOLD + 2, 100);
    expect(ev.map((e) => e.type)).toEqual(['drag-start', 'drag']);
    expect(g.move(120, 110)).toEqual([{ type: 'drag', dx: 14, dy: 10 }]);
    expect(g.up(true)).toEqual({ type: 'drag-end' });
    expect(g.up(true)).toBeNull(); // nada pendente
  });

  it('soltar perdido (blur, fora da janela) encerra sem clique', () => {
    const g = new PointerGesture();
    g.down(0, 0);
    expect(g.up(false)).toBeNull();
    g.down(0, 0);
    g.move(50, 0);
    expect(g.up(false)).toEqual({ type: 'drag-end' });
  });

  it('mexer sem ter apertado (carinho) não gera nada', () => {
    const g = new PointerGesture();
    expect(g.move(10, 10)).toEqual([]);
    expect(g.up(true)).toBeNull();
  });
});
