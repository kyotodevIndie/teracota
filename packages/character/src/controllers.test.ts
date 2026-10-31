import { describe, expect, it } from 'vitest';
import { ChainSway, breathe, mergeOffsets } from './controllers';

describe('breathe', () => {
  it('oscila em volta de 1 com a amplitude e o período configurados', () => {
    const c = { layer: 'body', period: 2000, amount: 0.02 };
    expect(breathe(c, 0).body!.scaleY).toBeCloseTo(1, 6);
    expect(breathe(c, 500).body!.scaleY).toBeCloseTo(1.02, 6); // pico em 1/4 do período
    expect(breathe(c, 500).body!.scaleX).toBeCloseTo(0.99, 6); // afina enquanto estica
    expect(breathe(c, 2500).body!.scaleY).toBeCloseTo(breathe(c, 500).body!.scaleY!, 6);
  });
});

describe('ChainSway', () => {
  const c = { layers: ['t1', 't2', 't3'], amplitude: 18, period: 2400 };

  it('devolve um ângulo por segmento e fica dentro de uma faixa razoável', () => {
    const sway = new ChainSway(c);
    let max = 0;
    for (let t = 0; t <= 10_000; t += 16) {
      const out = sway.step(t);
      for (const id of c.layers) max = Math.max(max, Math.abs(out[id]!.rotation!));
    }
    expect(max).toBeGreaterThan(1); // mexe
    expect(max).toBeLessThan(c.amplitude); // a mola não dispara
  });

  it('o impulso do corpo empurra a cadeia e ela assenta quando o impulso some', () => {
    const still = { ...c, amplitude: 0 };
    const sway = new ChainSway(still);
    let t = 0;
    for (; t < 1000; t += 16) sway.step(t, 30);
    expect(sway.step(t, 30).t1!.rotation!).toBeGreaterThan(5);
    for (; t < 6000; t += 16) sway.step(t, 0);
    expect(Math.abs(sway.step(t, 0).t1!.rotation!)).toBeLessThan(0.5);
  });

  it('um salto grande de tempo não explode (dt limitado)', () => {
    const sway = new ChainSway(c);
    sway.step(0);
    const out = sway.step(60_000, 40);
    expect(Number.isFinite(out.t3!.rotation!)).toBe(true);
    expect(Math.abs(out.t3!.rotation!)).toBeLessThan(90);
  });
});

describe('mergeOffsets', () => {
  it('soma rotação/deslocamento e multiplica escala', () => {
    const out = mergeOffsets({ a: { rotation: 5, scaleY: 1.1, dx: 2 } }, { a: { rotation: 3, scaleY: 2 }, b: { dy: 1 } });
    expect(out.a).toEqual({ rotation: 8, scaleY: 1.1 * 2, dx: 2 });
    expect(out.b).toEqual({ dy: 1 });
  });
});
