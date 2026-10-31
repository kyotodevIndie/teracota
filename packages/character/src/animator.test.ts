import { describe, expect, it } from 'vitest';
import { type AnimatorInput, POSE_TAU_MS, RigAnimator, approach } from './animator';
import { parseRigManifest, type RigManifest } from './rig';

const layer = (id: string, parent: string | null, extra: Record<string, unknown> = {}) =>
  ({ id, image: `parts/${id}.png`, parent, pivot: [0, 0], at: [0, 0], ...extra });

function makeRig(extra: Record<string, unknown> = {}): RigManifest {
  const r = parseRigManifest({
    canvas: 512, feet: [256, 500],
    layers: [
      layer('body', null), layer('head', 'body'), layer('legL', 'body'), layer('legR', 'body'),
      layer('eyes', 'head', { variants: { closed: 'e_c.png', happy: 'e_h.png' } }),
      layer('mouth', 'head', { variants: { open: 'm_o.png' } }),
      layer('zzz', 'head', { visible: false }),
    ],
    poses: {
      idle: { layers: {} },
      sleep: { layers: { head: { rotation: 10 }, eyes: { variant: 'closed' }, zzz: { visible: true } } },
    },
    expressions: { happy: { eyes: 'happy' } },
    controllers: {
      breathe: { layer: 'body', period: 2000, amount: 0.02 },
      blink: { layer: 'eyes', closed: 'closed', interval: [1000, 1000], duration: 100 },
      gaze: { layer: 'eyes', max: [6, 3], head: 'head', headMax: 5 },
      talk: { layer: 'mouth', variants: ['default', 'open'], period: 100 },
      walk: { legs: ['legL', 'legR'], swing: 20, period: 400 },
    },
    ...extra,
  });
  if (!r.rig) throw new Error(r.errors.join('\n'));
  return r.rig;
}

const input = (over: Partial<AnimatorInput> = {}): AnimatorInput => ({
  pose: 'idle', expression: 'neutral', talking: false, motion: null, dir: 1, gaze: null, drive: 0, reducedMotion: false, ...over,
});

describe('approach', () => {
  it('não depende do fps: dois passos de 8ms = um de 16ms', () => {
    const one = approach(16, 90);
    const two = 1 - (1 - approach(8, 90)) ** 2;
    expect(two).toBeCloseTo(one, 10);
    expect(approach(0, 90)).toBe(0);
  });
});

describe('RigAnimator', () => {
  it('troca de pose com transição suave, sem pulo', () => {
    const a = new RigAnimator(makeRig(), () => 0, 0);
    a.frame(0, input());
    const r1 = a.frame(16, input({ pose: 'sleep' })).offsets.head?.rotation ?? 0;
    expect(r1).toBeGreaterThan(0);
    expect(r1).toBeLessThan(3); // no primeiro quadro anda só um pedaço
    let r = r1;
    for (let t = 32; t <= 16 + POSE_TAU_MS * 6; t += 16) r = a.frame(t, input({ pose: 'sleep' })).offsets.head?.rotation ?? 0;
    expect(r).toBeCloseTo(10, 1);
  });

  it('a primeira pose aparece já no lugar (sem animar do repouso ao abrir)', () => {
    const a = new RigAnimator(makeRig(), () => 0, 0);
    expect(a.frame(0, input({ pose: 'sleep' })).offsets.head?.rotation).toBeCloseTo(10, 6);
  });

  it('pose define variantes e visibilidade; expressão sobrepõe', () => {
    const a = new RigAnimator(makeRig(), () => 0, 0);
    const sleep = a.frame(0, input({ pose: 'sleep' }));
    expect(sleep.variants.eyes).toBe('closed');
    expect(sleep.hidden.has('zzz')).toBe(false);
    const idle = a.frame(10, input({ expression: 'happy' }));
    expect(idle.variants.eyes).toBe('happy');
    expect(idle.hidden.has('zzz')).toBe(true);
  });

  it('pisca só com os olhos abertos aparecendo', () => {
    const a = new RigAnimator(makeRig(), () => 0, 0); // piscada a cada 1000ms, 100ms fechado
    expect(a.frame(500, input()).variants.eyes).toBeUndefined();
    expect(a.frame(1010, input()).variants.eyes).toBe('closed');
    expect(a.frame(1150, input()).variants.eyes).toBeUndefined();
    // feliz: olhos próprios, não pisca por cima
    expect(a.frame(2120, input({ expression: 'happy' })).variants.eyes).toBe('happy');
  });

  it('boca alterna só falando', () => {
    const a = new RigAnimator(makeRig(), () => 0.5, 0);
    expect(a.frame(50, input({ talking: true })).variants.mouth).toBe('default');
    expect(a.frame(150, input({ talking: true })).variants.mouth).toBe('open');
    expect(a.frame(160, input()).variants.mouth).toBeUndefined();
  });

  it('olhar persegue o alvo e gira a cabeça no limite', () => {
    const a = new RigAnimator(makeRig(), () => 0.5, 0);
    a.frame(0, input());
    let f = a.frame(16, input({ gaze: [1, -1] }));
    for (let t = 32; t < 2000; t += 16) f = a.frame(t, input({ gaze: [2, -2] })); // fora do intervalo: preso em ±1
    expect(f.offsets.eyes?.dx).toBeCloseTo(6, 2);
    expect(f.offsets.eyes?.dy).toBeCloseTo(-3, 2);
    expect(f.offsets.head?.rotation).toBeCloseTo(5, 2);
  });

  it('andando, as pernas balançam em oposição; parada, voltam ao centro', () => {
    const a = new RigAnimator(makeRig(), () => 0.5, 0);
    a.frame(0, input());
    const w = a.frame(100, input({ motion: 'walk' })); // 1/4 do ciclo de 400ms: pico
    expect(w.offsets.legL?.rotation).toBeCloseTo(20, 1);
    expect(w.offsets.legR?.rotation).toBeCloseTo(-20, 1);
    let s = w;
    for (let t = 116; t < 1000; t += 16) s = a.frame(t, input());
    expect(Math.abs(s.offsets.legL?.rotation ?? 0)).toBeLessThan(0.5);
  });

  it('movimento reduzido: sem respiração, olhar nem passos; piscada continua', () => {
    const a = new RigAnimator(makeRig(), () => 0, 0);
    const f = a.frame(500, input({ reducedMotion: true, motion: 'walk', gaze: [1, 1] }));
    expect(f.offsets.body).toBeUndefined();
    expect(f.offsets.legL).toBeUndefined();
    expect(f.offsets.eyes).toBeUndefined();
    expect(a.frame(1010, input({ reducedMotion: true })).variants.eyes).toBe('closed');
  });

  it('pose desconhecida usa a idle (ou o repouso)', () => {
    const a = new RigAnimator(makeRig(), () => 0, 0);
    expect(a.frame(0, input({ pose: 'nao-existe' })).variants.eyes).toBeUndefined();
  });
});
