import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Point, WalkInfo } from '../shared/ipc';
import { SPEED, Walker } from './walker';

const AREA = { x: 0, y: 0, width: 1920, height: 1040 };
const SIZE = { width: 320, height: 440 };

function setup(mode: 'roam' | 'stay' = 'roam') {
  let pos: Point = { x: 800, y: 400 };
  const walks: WalkInfo[] = [];
  const stops = vi.fn();
  const moves: Point[] = [];
  const host = {
    position: () => pos,
    workArea: () => AREA,
    moveTo: (p: Point) => { pos = p; moves.push(p); },
    alive: () => true,
  };
  const walker = new Walker(host, SIZE, mode, { onWalk: (i) => walks.push(i), onStop: stops });
  return { walker, walks, stops, moves, pos: () => pos };
}

beforeEach(() => vi.useFakeTimers());

/** Avança o relógio só até o primeiro trecho começar (o descanso inicial é aleatório) */
function untilWalking(walker: Walker): void {
  for (let i = 0; i < 200 && !walker.walking; i++) vi.advanceTimersByTime(200);
}
afterEach(() => vi.useRealTimers());

describe('Walker (planejador)', () => {
  it('liberado e descansado: manda um plano dentro da área útil', () => {
    const { walker, walks } = setup();
    walker.setAllowed(true);
    untilWalking(walker);
    const start = walks.find((w) => w.walking)!;
    expect(start.plan).toMatchObject({ from: { x: 800, y: 400 }, speed: SPEED });
    expect(start.plan!.to.x).toBeGreaterThanOrEqual(-30);
    expect(start.plan!.to.y + SIZE.height).toBeLessThanOrEqual(AREA.height);
    expect(walker.walking).toBe(true);
    walker.dispose();
  });

  it('passos do renderer movem a janela; chegar encerra e salva', () => {
    const { walker, walks, stops, moves, pos } = setup();
    walker.setAllowed(true);
    untilWalking(walker);
    const plan = walks.find((w) => w.walking)!.plan!;
    walker.stepTo({ x: plan.from.x + 1, y: plan.from.y });
    expect(moves.at(-1)).toEqual({ x: plan.from.x + 1, y: plan.from.y });
    walker.arrived();
    expect(pos()).toEqual(plan.to);
    expect(walks.at(-1)).toMatchObject({ walking: false });
    expect(stops).toHaveBeenCalledTimes(1);
    walker.stepTo({ x: 0, y: 0 }); // passo atrasado depois de chegar: ignorado
    expect(pos()).toEqual(plan.to);
    walker.dispose();
  });

  it('renderer sumiu no meio do trecho: desiste no prazo', () => {
    const { walker, walks } = setup();
    walker.setAllowed(true);
    untilWalking(walker);
    expect(walker.walking).toBe(true);
    vi.advanceTimersByTime(9000); // trecho máximo ~450px/70px/s ≈ 6,5 s + 1,5 s de folga
    expect(walks.some((w) => !w.walking)).toBe(true);
    walker.dispose();
  });

  it('modo "ficar parada", não liberado ou escondida: não anda', () => {
    const stay = setup('stay');
    stay.walker.setAllowed(true);
    vi.advanceTimersByTime(30_000);
    expect(stay.walks).toEqual([]);
    stay.walker.dispose();

    const hidden = setup();
    hidden.walker.setAllowed(true);
    hidden.walker.setPaused(true);
    vi.advanceTimersByTime(30_000);
    expect(hidden.walks).toEqual([]);
    hidden.walker.dispose();
  });

  it('o usuário mexeu nela: para na hora', () => {
    const { walker, walks } = setup();
    walker.setAllowed(true);
    untilWalking(walker);
    walker.interrupt();
    expect(walker.walking).toBe(false);
    expect(walks.at(-1)).toMatchObject({ walking: false });
    walker.dispose();
  });
});
