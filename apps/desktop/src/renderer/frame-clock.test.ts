import { describe, expect, it } from 'vitest';
import { frameSkip, median } from './frame-clock';
import { walkStep } from './walk-plan';

describe('frameSkip', () => {
  it('intervalo inteiro de quadros: estável em qualquer taxa de tela', () => {
    expect(frameSkip(24, 1000 / 60)).toBe(3); // 20 fps cravados, nunca 3-2-3
    expect(frameSkip(24, 1000 / 144)).toBe(6); // 24 fps
    expect(frameSkip(30, 1000 / 120)).toBe(4);
    expect(frameSkip(60, 1000 / 60)).toBe(1);
  });

  it('sem limite ou entrada estranha: todo quadro', () => {
    expect(frameSkip(Number.POSITIVE_INFINITY, 1000 / 144)).toBe(1);
    expect(frameSkip(0, 16)).toBe(1);
    expect(frameSkip(240, 1000 / 60)).toBe(1);
  });

  it('mediana ignora o quadro atrasado', () => {
    expect(median([6.9, 7, 6.9, 40, 6.9])).toBeCloseTo(6.9);
    expect(median([])).toBe(0);
  });
});

describe('walkStep', () => {
  const plan = { from: { x: 0, y: 0 }, to: { x: 300, y: 400 }, speed: 100, dir: 1 as const };

  it('anda na velocidade do plano e chega exatamente no destino', () => {
    expect(walkStep(plan, 0)).toEqual({ position: { x: 0, y: 0 }, done: false });
    expect(walkStep(plan, 1000)).toEqual({ position: { x: 60, y: 80 }, done: false }); // 100 px na diagonal 3-4-5
    expect(walkStep(plan, 5000)).toEqual({ position: { x: 300, y: 400 }, done: true });
    expect(walkStep(plan, 60_000).done).toBe(true);
  });

  it('plano parado termina na hora', () => {
    expect(walkStep({ ...plan, to: plan.from }, 0).done).toBe(true);
  });
});
