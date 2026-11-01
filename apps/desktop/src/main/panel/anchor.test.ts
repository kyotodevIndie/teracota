import { describe, expect, it } from 'vitest';
import { CHARACTER_BOTTOM, CHARACTER_TOP, PANEL_WIDTH, placePanel } from './anchor';

const AREA = { x: 0, y: 0, width: 1920, height: 1080 };
const tera = (x: number, y: number) => ({ x, y, width: 320, height: 440 });

describe('onde a interface fica', () => {
  it('em cima da Tera, encostada na cabeça, centralizada nela', () => {
    const p = placePanel(tera(800, 600), 400, AREA);
    expect(p.side).toBe('above');
    expect(p.y + p.height).toBe(600 + CHARACTER_TOP - 2);
    expect(p.x).toBe(800 + 160 - PANEL_WIDTH / 2);
    expect(p.tailX).toBe(PANEL_WIDTH / 2);
  });

  it('sem espaço em cima, abre embaixo, logo abaixo dos pés', () => {
    const p = placePanel(tera(800, 0), 400, AREA);
    expect(p.side).toBe('below');
    expect(p.y).toBe(CHARACTER_BOTTOM + 2);
  });

  it('pouco espaço nos dois lados: fica no maior e limita a altura (a lista rola)', () => {
    const p = placePanel(tera(800, 300), 2000, AREA);
    expect(p.side).toBe('above');
    expect(p.height).toBe(p.maxHeight);
    expect(p.y).toBeGreaterThanOrEqual(AREA.y);
  });

  it('Tera no canto: a janela não sai da tela e a pontinha continua apontando pra ela', () => {
    const p = placePanel(tera(1920 - 320, 600), 300, AREA);
    expect(p.x + PANEL_WIDTH).toBeLessThanOrEqual(1920);
    expect(p.tailX).toBeGreaterThan(PANEL_WIDTH / 2);
    const left = placePanel(tera(0, 600), 300, AREA);
    expect(left.x).toBeGreaterThanOrEqual(0);
    expect(left.tailX).toBeLessThan(PANEL_WIDTH / 2);
  });

  it('respeita a área útil de um segundo monitor deslocado', () => {
    const area = { x: 2560, y: 389, width: 1920, height: 1051 };
    const p = placePanel(tera(2618, 923), 600, area);
    expect(p.y).toBeGreaterThanOrEqual(area.y);
    expect(p.x).toBeGreaterThanOrEqual(area.x);
  });
});
