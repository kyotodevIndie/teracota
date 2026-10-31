import { describe, expect, it } from 'vitest';
import { TOP_OVERFLOW, clampToArea, recoverPosition } from './geometry';

const SIZE = { width: 320, height: 440 };
const LEFT = { x: 0, y: 0, width: 2560, height: 1400 };
const RIGHT = { x: 2560, y: 360, width: 1920, height: 1080 };

describe('geometria da janela', () => {
  it('prende dentro da área útil, com folga nas laterais e no topo', () => {
    expect(clampToArea({ x: -500, y: -500 }, SIZE, LEFT)).toEqual({ x: -30, y: -TOP_OVERFLOW });
    expect(clampToArea({ x: 9999, y: 9999 }, SIZE, LEFT)).toEqual({ x: 2560 - 320 + 30, y: 1400 - 440 });
    expect(clampToArea({ x: 100, y: 200 }, SIZE, LEFT)).toEqual({ x: 100, y: 200 });
  });

  it('solta fora de tudo: volta pro monitor mais próximo', () => {
    // arrastada pra baixo do monitor da direita (que começa em y=360)
    expect(recoverPosition({ x: 3000, y: 3000 }, SIZE, [LEFT, RIGHT])).toEqual({ x: 3000, y: 360 + 1080 - 440 });
    // no vão acima do monitor da direita (não existe tela ali)
    const p = recoverPosition({ x: 3500, y: -300 }, SIZE, [LEFT, RIGHT]);
    expect(p.y).toBeGreaterThanOrEqual(360 - TOP_OVERFLOW);
  });

  it('monitor desligado: quem estava nele vai pro que sobrou', () => {
    expect(recoverPosition({ x: 3000, y: 500 }, SIZE, [LEFT])).toEqual({ x: 2560 - 320 + 30, y: 500 });
  });

  it('sem monitores (não deveria acontecer): não mexe', () => {
    expect(recoverPosition({ x: 10, y: 20 }, SIZE, [])).toEqual({ x: 10, y: 20 });
  });
});
