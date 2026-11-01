import { describe, expect, it } from 'vitest';
import { Pendulum } from './pendulum';

/** Simula um arrasto a `speed` px/s por `dragMs`, depois solta; devolve os ângulos por quadro */
function simulate(speed: number, dragMs: number, totalMs: number): number[] {
  const p = new Pendulum();
  const angles: number[] = [];
  const frame = 1000 / 60;
  p.step(0);
  for (let t = frame; t <= totalMs; t += frame) {
    if (t <= dragMs) p.push((speed * frame) / 1000);
    angles.push(p.step(t));
  }
  return angles;
}

describe('Pendulum', () => {
  it('puxando pra esquerda, os pés ficam pra direita (ângulo positivo)', () => {
    const angles = simulate(-500, 500, 500);
    expect(angles.at(-1)!).toBeGreaterThan(10);
  });

  it('puxando pra direita, o contrário', () => {
    const angles = simulate(500, 500, 500);
    expect(angles.at(-1)!).toBeLessThan(-10);
  });

  it('ao parar, passa do meio e depois assenta', () => {
    const angles = simulate(-500, 500, 4000);
    const afterStop = angles.slice(Math.round(500 / (1000 / 60)));
    expect(Math.min(...afterStop)).toBeLessThan(0); // passou do meio
    expect(Math.abs(angles.at(-1)!)).toBeLessThan(0.5); // assentou
  });

  it('não passa do limite mesmo arrastando muito rápido', () => {
    const angles = simulate(-20_000, 1000, 1000);
    expect(Math.max(...angles.map(Math.abs))).toBeLessThanOrEqual(35 * 1.3);
  });

  it('parado não balança', () => {
    expect(simulate(0, 1000, 1000).every((a) => a === 0)).toBe(true);
  });
});
