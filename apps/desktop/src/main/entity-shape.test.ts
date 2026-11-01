import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {}, screen: {} }));
const { parseShape, SIZE, DRAG_EXTRA } = await import('./entity');

describe('recorte vindo do renderer', () => {
  it('aceita retângulos inteiros dentro da janela', () => {
    expect(parseShape([{ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 20, width: 300, height: 400 }])).toHaveLength(2);
    expect(parseShape([{ x: 0, y: 0, width: SIZE.width, height: SIZE.height }])).toHaveLength(1);
  });

  it('recusa o que não é retângulo, fora da janela ou demais', () => {
    expect(parseShape('tudo')).toBeNull();
    expect(parseShape([{ x: 0, y: 0, width: 10 }])).toBeNull();
    expect(parseShape([{ x: 0.5, y: 0, width: 10, height: 10 }])).toBeNull();
    expect(parseShape([{ x: -1, y: 0, width: 10, height: 10 }])).toBeNull();
    // arrastando, a janela tem a folga dos dois lados; mais que isso não
    expect(parseShape([{ x: 0, y: 0, width: SIZE.width + DRAG_EXTRA * 2, height: 10 }])).toHaveLength(1);
    expect(parseShape([{ x: 0, y: 0, width: SIZE.width + DRAG_EXTRA * 2 + 1, height: 10 }])).toBeNull();
    expect(parseShape(Array.from({ length: 201 }, () => ({ x: 0, y: 0, width: 1, height: 1 })))).toBeNull();
  });
});
