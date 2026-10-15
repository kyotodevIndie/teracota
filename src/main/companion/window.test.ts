import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {}, screen: {} }));

const { MARGIN, SQUARE, WINDOW_SIZE, anchorFor, clampSquare, windowBounds } = await import('./window');

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const left = { x: -2560, y: -355, width: 2560, height: 1400 };

describe('geometria do Mini Companion', () => {
  it('perto da borda direita a barra abre pra esquerda, e vice-versa', () => {
    expect(anchorFor({ x: 1800, y: 900 }, primary)).toBe('right');
    expect(anchorFor({ x: 40, y: 900 }, primary)).toBe('left');
    // monitor com coordenadas negativas
    expect(anchorFor({ x: -2500, y: 0 }, left)).toBe('left');
    expect(anchorFor({ x: -200, y: 0 }, left)).toBe('right');
  });

  it('o quadrado fica no mesmo lugar da tela quando a âncora troca', () => {
    const square = { x: 900, y: 500 };
    const l = windowBounds(square, 'left');
    const r = windowBounds(square, 'right');
    expect(l.x + MARGIN).toBe(square.x);
    expect(r.x + r.width - MARGIN - SQUARE).toBe(square.x);
    expect(l.y).toBe(square.y - MARGIN);
    expect(l.width).toBe(WINDOW_SIZE.width);
  });

  it('mantém o quadrado inteiro dentro da área de trabalho', () => {
    expect(clampSquare({ x: 5000, y: 5000 }, primary)).toEqual({ x: 1920 - SQUARE, y: 1040 - SQUARE });
    expect(clampSquare({ x: -9000, y: -9000 }, left)).toEqual({ x: -2560, y: -355 });
  });
});
