import { describe, expect, it } from 'vitest';
import {
  type AlphaMask, MAX_LAYERS, apply, drawOrder, hitLayer, invert, isSafeImagePath, localMatrix, maskHit,
  multiply, parseRigManifest, topoOrder, worldMatrices,
} from './rig';

const layer = (id: string, parent: string | null, extra: Record<string, unknown> = {}) =>
  ({ id, image: `parts/${id}.png`, parent, pivot: [0, 0], at: [0, 0], ...extra });

const rig = (layers: unknown[], extra: Record<string, unknown> = {}) => ({ canvas: 512, feet: [256, 500], layers, ...extra });

const close = (a: number[], b: number[]) => {
  for (const [i, v] of a.entries()) expect(v).toBeCloseTo(b[i]!, 6);
};

describe('parseRigManifest', () => {
  it('aceita um rig válido e preenche os padrões', () => {
    const r = parseRigManifest(rig([layer('body', null), layer('head', 'body', { z: 2, rotation: 5, scale: 1.5 })]));
    expect(r.errors).toBeUndefined();
    const head = r.rig!.layers[1]!;
    expect(head).toMatchObject({ parent: 'body', z: 2, rotation: 5, scale: [1.5, 1.5] });
    expect(r.rig!.layers[0]).toMatchObject({ z: 0, rotation: 0, scale: [1, 1] });
  });

  it('recusa pai inexistente, duas raízes e ciclos, dizendo qual camada', () => {
    expect(parseRigManifest(rig([layer('body', null), layer('arm', 'nada')])).errors).toContain('camada "arm": pai "nada" não existe');
    expect(parseRigManifest(rig([layer('a', null), layer('b', null)])).errors?.[0]).toMatch(/exatamente uma raiz/);
    const cycle = parseRigManifest(rig([layer('root', null), layer('a', 'b'), layer('b', 'a')]));
    expect(cycle.errors?.some((e) => e.includes('ciclo'))).toBe(true);
  });

  it('recusa caminhos de imagem inseguros', () => {
    for (const image of ['../fora.png', 'parts/../../x.png', 'C:/x.png', '/abs.png', 'http://x/a.png', 'a.jpg', 'parts//a.png']) {
      expect(parseRigManifest(rig([{ ...layer('a', null), image }])).errors?.[0], image).toMatch(/image/);
    }
    expect(isSafeImagePath('parts/head/face.png')).toBe(true);
  });

  it('recusa números fora da faixa e ids repetidos', () => {
    expect(parseRigManifest(rig([layer('a', null, { scale: 20 })])).errors?.[0]).toMatch(/scale/);
    expect(parseRigManifest(rig([layer('a', null, { pivot: [1] })])).errors?.[0]).toMatch(/pivot/);
    expect(parseRigManifest(rig([layer('a', null), layer('a', 'a')])).errors?.[0]).toMatch(/repetido/);
    expect(parseRigManifest({ ...rig([layer('a', null)]), canvas: 0 }).errors?.[0]).toMatch(/canvas/);
  });

  it(`limita a ${MAX_LAYERS} camadas`, () => {
    const many = [layer('l0', null), ...Array.from({ length: MAX_LAYERS }, (_, i) => layer(`l${i + 1}`, 'l0'))];
    expect(parseRigManifest(rig(many)).errors?.[0]).toMatch(/no máximo/);
  });

  it('valida os controladores contra as camadas existentes', () => {
    const ok = parseRigManifest(rig([layer('body', null), layer('t1', 'body')], {
      controllers: { breathe: { layer: 'body' }, sway: { layers: ['t1'], amplitude: 500 } },
    }));
    expect(ok.rig?.controllers.breathe).toMatchObject({ layer: 'body', period: 2600 });
    expect(ok.rig?.controllers.sway?.amplitude).toBe(90); // preso no máximo
    const bad = parseRigManifest(rig([layer('body', null)], { controllers: { sway: { layers: ['nada'] } } }));
    expect(bad.errors?.[0]).toMatch(/sway/);
  });
});

describe('matrizes', () => {
  it('localMatrix leva o pivô até "at" e gira em volta dele', () => {
    const m = localMatrix([100, 50], 90, 1, 1, [10, 0]);
    close(apply(m, 10, 0), [100, 50]); // o pivô vai pro lugar
    close(apply(m, 20, 0), [100, 60]); // 10 px à direita do pivô, girado 90° (horário no canvas) → pra baixo
  });

  it('invert desfaz a transformação', () => {
    const m = localMatrix([30, 40], 33, 1.5, 0.8, [7, 9]);
    const [x, y] = apply(m, 12, 34);
    close(apply(invert(m)!, x, y), [12, 34]);
    expect(invert([0, 0, 0, 0, 0, 0])).toBeNull();
  });

  it('filhos herdam a transformação do pai; offsets somam e respeitam limites', () => {
    const parsed = parseRigManifest(rig([
      layer('body', null, { at: [100, 100] }),
      layer('arm', 'body', { at: [10, 0], limits: { rotation: [-20, 20] } }),
    ])).rig!;
    const order = topoOrder(parsed);
    let world = worldMatrices(order, { body: { rotation: 90 } });
    // o braço está 10 px à direita do corpo; com o corpo girado 90°, vai pra baixo
    close(apply(world.get('arm')!, 0, 0), [100, 110]);
    world = worldMatrices(order, { arm: { rotation: 999 } });
    const armAngle = Math.atan2(world.get('arm')![1], world.get('arm')![0]) * (180 / Math.PI);
    expect(armAngle).toBeCloseTo(20, 6); // preso no limite
    world = worldMatrices(order, { body: { scaleY: 2 } });
    close(multiply(world.get('body')!, [1, 0, 0, 1, 0, 0]), world.get('body')!);
  });

  it('ordem: pai antes do filho pro cálculo; z crescente pro desenho', () => {
    const parsed = parseRigManifest(rig([
      layer('hand', 'arm', { z: 3 }), layer('arm', 'body', { z: 2 }), layer('body', null, { z: 1 }), layer('tail', 'body', { z: -1 }),
    ])).rig!;
    expect(topoOrder(parsed).map((l) => l.id)).toEqual(['body', 'arm', 'hand', 'tail']);
    expect(drawOrder(parsed).map((l) => l.id)).toEqual(['tail', 'body', 'arm', 'hand']);
  });
});

describe('clique', () => {
  // máscara 4×4 de uma imagem 40×40: só a metade de cima é opaca
  const half: AlphaMask = { width: 40, height: 40, mw: 4, mh: 4, data: Uint8Array.from([255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0]) };

  it('maskHit respeita a transparência e os limites da imagem', () => {
    expect(maskHit(half, 5, 5)).toBe(true);
    expect(maskHit(half, 5, 35)).toBe(false);
    expect(maskHit(half, -1, 5)).toBe(false);
    expect(maskHit(half, 40, 5)).toBe(false);
  });

  it('hitLayer considera rotação e a camada de cima primeiro', () => {
    const parsed = parseRigManifest(rig([
      layer('back', null, { at: [100, 100], z: 0 }),
      layer('front', 'back', { at: [0, 0], z: 1 }),
    ])).rig!;
    const masks = new Map([['back', half], ['front', half]]);
    const drawn = drawOrder(parsed);
    let world = worldMatrices(topoOrder(parsed));
    expect(hitLayer(drawn, world, masks, 110, 105)).toBe('front'); // as duas cobrem: a da frente ganha
    expect(hitLayer(drawn, world, masks, 110, 135)).toBeNull(); // metade transparente
    // girando a frente 180° em volta do pivô (0,0), a parte opaca dela vai pra cima/esquerda
    world = worldMatrices(topoOrder(parsed), { front: { rotation: 180 } });
    expect(hitLayer(drawn, world, masks, 95, 95)).toBe('front');
    expect(hitLayer(drawn, world, masks, 110, 105)).toBe('back');
  });
});

describe('variantes, poses, expressões e controladores', () => {
  const face = () => [
    layer('body', null),
    layer('legL', 'body'), layer('legR', 'body'),
    layer('eyes', 'body', { variants: { closed: 'parts/eyes_closed.png', happy: 'parts/eyes_happy.png' } }),
    layer('mouth', 'body', { variants: { open: 'parts/mouth_open.png' } }),
    layer('zzz', 'body', { visible: false }),
  ];

  it('aceita variantes e preenche "default" com a image', () => {
    const r = parseRigManifest(rig(face()));
    expect(r.errors).toBeUndefined();
    expect(r.rig!.layers.find((l) => l.id === 'eyes')!.variants).toEqual({ default: 'parts/eyes.png', closed: 'parts/eyes_closed.png', happy: 'parts/eyes_happy.png' });
    expect(r.rig!.layers.find((l) => l.id === 'zzz')!.visible).toBe(false);
  });

  it('recusa variante com caminho inseguro ou nome reservado', () => {
    expect(parseRigManifest(rig([layer('body', null, { variants: { x: '../fora.png' } })])).errors?.[0]).toMatch(/variante "x"/);
    expect(parseRigManifest(rig([layer('body', null, { variants: { default: 'a.png' } })])).errors?.[0]).toMatch(/variante "default"/);
  });

  it('poses e expressões só com camadas e variantes que existem', () => {
    const ok = parseRigManifest(rig(face(), {
      poses: { sleep: { layers: { eyes: { variant: 'closed' }, zzz: { visible: true }, body: { rotation: 3, dy: 4 } } } },
      expressions: { happy: { eyes: 'happy', mouth: 'open' } },
    }));
    expect(ok.errors).toBeUndefined();
    expect(ok.rig!.poses.sleep!.layers.body).toEqual({ rotation: 3, dy: 4 });
    expect(parseRigManifest(rig(face(), { poses: { sleep: { layers: { eyes: { variant: 'nada' } } } } })).errors?.[0]).toMatch(/variante "nada"/);
    expect(parseRigManifest(rig(face(), { expressions: { happy: { eyes: 'nada' } } })).errors?.[0]).toMatch(/sem a variante/);
  });

  it('controladores de piscada, olhar, fala e caminhada', () => {
    const r = parseRigManifest(rig(face(), {
      controllers: {
        blink: { layer: 'eyes', closed: 'closed' },
        gaze: { layer: 'eyes', max: [4, -2] },
        talk: { layer: 'mouth', variants: ['default', 'open'] },
        walk: { legs: ['legL', 'legR'] },
      },
    }));
    expect(r.errors).toBeUndefined();
    expect(r.rig!.controllers).toMatchObject({
      blink: { layer: 'eyes', open: 'default', closed: 'closed', interval: [2500, 6000], duration: 130 },
      gaze: { layer: 'eyes', max: [4, 2], headMax: 4 },
      talk: { variants: ['default', 'open'], period: 110 },
      walk: { legs: ['legL', 'legR'], swing: 22, period: 560 },
    });
    expect(parseRigManifest(rig(face(), { controllers: { blink: { layer: 'eyes', closed: 'nada' } } })).errors?.[0]).toMatch(/blink/);
    expect(parseRigManifest(rig(face(), { controllers: { talk: { layer: 'mouth', variants: ['open'] } } })).errors?.[0]).toMatch(/talk/);
  });
});
