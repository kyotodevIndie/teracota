import { describe, expect, it } from 'vitest';
import { hitRects } from './panel-layout';

const node = (left: number, top: number, width: number, height: number) => ({ getBoundingClientRect: () => ({ left, top, width, height }) }) as unknown as Element;

describe('recorte dos cartões', () => {
  it('um retângulo por cartão, com folga; ignora os escondidos', () => {
    expect(hitRects([node(10, 0, 400, 44), node(0, 0, 0, 0)])).toEqual([{ x: 7, y: -3, width: 406, height: 50 }]);
  });

  it('cartões demais viram um retângulo só', () => {
    const many = Array.from({ length: 5 }, (_, i) => node(10, i * 50, 400, 40));
    expect(hitRects(many, 3)).toEqual([{ x: 7, y: -3, width: 406, height: 246 }]);
  });
});
