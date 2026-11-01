import { describe, expect, it } from 'vitest';
import { clipRects, rectsFromGrid } from './shape';

describe('recorte da janela', () => {
  it('um quadrado vira um retângulo só (com folga)', () => {
    const hit = (x: number, y: number) => x >= 20 && x < 40 && y >= 20 && y < 60;
    expect(rectsFromGrid(hit, { x: 0, y: 0, width: 100, height: 100 }, 10, 0)).toEqual([{ x: 20, y: 20, width: 20, height: 40 }]);
    expect(rectsFromGrid(hit, { x: 0, y: 0, width: 100, height: 100 }, 10, 5)).toEqual([{ x: 15, y: 15, width: 30, height: 50 }]);
  });

  it('forma em T: dois retângulos', () => {
    const hit = (x: number, y: number) => (y < 20 && x < 60) || (y >= 20 && y < 50 && x >= 20 && x < 40);
    expect(rectsFromGrid(hit, { x: 0, y: 0, width: 60, height: 60 }, 10, 0)).toEqual([
      { x: 0, y: 0, width: 60, height: 20 },
      { x: 20, y: 20, width: 20, height: 30 },
    ]);
  });

  it('nada opaco: nenhum retângulo (a janela inteira deixa o clique passar)', () => {
    expect(rectsFromGrid(() => false, { x: 0, y: 0, width: 50, height: 50 }, 10, 5)).toEqual([]);
  });

  it('prende na janela', () => {
    expect(clipRects([{ x: -5, y: -5, width: 20, height: 20 }, { x: 400, y: 0, width: 10, height: 10 }], 320, 440)).toEqual([{ x: 0, y: 0, width: 15, height: 15 }]);
  });
});
