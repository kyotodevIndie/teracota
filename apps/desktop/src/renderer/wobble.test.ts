import { describe, expect, it } from 'vitest';
import { WOBBLE_BLEND_MS, WobbleMixer, wobbleFor } from './wobble';

describe('WobbleMixer', () => {
  it('trocar de pose não reinicia a respiração (sem pulo no quadro da troca)', () => {
    const m = new WobbleMixer();
    m.set('idle', 0);
    const before = m.get(1000, 1, false);
    m.set('talk', 1000); // falar troca a pose; antes isso zerava a fase do seno
    const after = m.get(1000, 1, false);
    expect(after.sy).toBeCloseTo(before.sy, 6);
  });

  it('mistura do movimento antigo pro novo e termina no novo', () => {
    const m = new WobbleMixer();
    m.set('idle', 0);
    m.set('error', 500);
    const mid = m.get(500 + WOBBLE_BLEND_MS / 2, 1, false);
    const end = m.get(500 + WOBBLE_BLEND_MS + 1, 1, false);
    const target = wobbleFor('error', 500 + WOBBLE_BLEND_MS + 1, 1);
    expect(end.dx).toBeCloseTo(target.dx, 6);
    expect(Math.abs(mid.dx)).toBeLessThanOrEqual(1.2); // no meio, só uma parte do tremor
  });

  it('movimento reduzido: corpo parado', () => {
    const m = new WobbleMixer();
    m.set('walk', 0);
    const w = m.get(1234, 1, true);
    expect(w).toMatchObject({ dx: 0, dy: 0, sx: 1, sy: 1, rot: 0 });
  });
});
