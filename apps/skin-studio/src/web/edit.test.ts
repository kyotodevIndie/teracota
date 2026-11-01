import { describe, expect, it } from 'vitest';
import { type RawRig, addLayer, freeId, movePivot, moveLayer, nudgePose, removeLayer, setPoseValue, structureKey, toParentSpace, tree } from './edit';

const rig = (): RawRig => ({
  $schema: './rig.schema.json',
  canvas: 512,
  layers: [
    { id: 'body', image: 'parts/body.png', parent: null, pivot: [75, 170], at: [256, 404], z: 20 },
    { id: 'head', image: 'parts/head.png', parent: 'body', pivot: [100, 180], at: [75, 10], z: 40, rotation: 90 },
    { id: 'eyes', image: 'parts/eyes.png', parent: 'head', pivot: [55, 15], at: [100, 90], z: 42, variants: { closed: 'parts/eyes_closed.png' } },
  ],
  poses: { wave: { layers: { head: { rotation: 5 } } } },
  expressions: { happy: { eyes: 'closed' } },
  controllers: { blink: { layer: 'eyes', closed: 'closed' }, breathe: { layer: 'body' } },
});

describe('edições do Studio', () => {
  it('arrastar muda só o "at" e preserva o resto (inclusive $schema)', () => {
    const next = moveLayer(rig(), 'head', [3, -2]);
    expect(next.layers[1]!.at).toEqual([78, 8]);
    expect(next.$schema).toBe('./rig.schema.json');
    expect(rig().layers[1]!.at).toEqual([75, 10]); // original intacto
  });

  it('mover o pivô compensa o "at" com a rotação (a imagem não sai do lugar)', () => {
    // cabeça girada 90°: andar 10 px em x na imagem = andar 10 px em y no pai
    const next = movePivot(rig(), 'head', [10, 0]);
    expect(next.layers[1]!.pivot).toEqual([110, 180]);
    expect(next.layers[1]!.at[0]).toBeCloseTo(75);
    expect(next.layers[1]!.at[1]).toBeCloseTo(20);
  });

  it('vetor do rig pro espaço do pai desfaz rotação e escala do pai', () => {
    const [x, y] = toParentSpace([0, 2, -2, 0, 50, 50], 4, 0); // pai girado 90° e com escala 2
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(-2);
    expect(toParentSpace(null, 3, 4)).toEqual([3, 4]);
  });

  it('pose: valor neutro sai do arquivo; pose nova é criada', () => {
    let r = setPoseValue(rig(), 'wave', 'head', 'rotation', 0);
    expect(r.poses!.wave!.layers).toEqual({});
    r = nudgePose(r, 'sleep', 'body', [0, 6]);
    expect(r.poses!.sleep!.layers.body).toEqual({ dy: 6 });
  });

  it('camada nova: id livre, presa no escolhido, na frente de tudo', () => {
    expect(freeId(rig(), 'Head.png')).toBe('head-2');
    const r = addLayer(rig(), 'parts/hat.png', { width: 80, height: 40 }, 'head');
    const hat = r.layers.at(-1)!;
    expect(hat).toMatchObject({ id: 'hat', parent: 'head', pivot: [40, 20], z: 52 });
  });

  it('remover: filhos sobem pro avô, e some das poses, expressões e movimentos', () => {
    const r = removeLayer(rig(), 'head');
    expect(r.layers.find((l) => l.id === 'eyes')!.parent).toBe('body');
    expect(r.poses!.wave!.layers).toEqual({});
    const r2 = removeLayer(rig(), 'eyes');
    expect(r2.expressions!.happy).toEqual({});
    expect(r2.controllers).toEqual({ breathe: { layer: 'body' } });
    expect(removeLayer(rig(), 'body').layers).toHaveLength(3); // a raiz fica
  });

  it('árvore: pais antes dos filhos, com profundidade', () => {
    expect(tree(rig()).map((t) => `${t.depth}:${t.layer.id}`)).toEqual(['0:body', '1:head', '2:eyes']);
  });

  it('só estrutura (camadas, pais, arquivos) recarrega imagens; números não', () => {
    expect(structureKey(moveLayer(rig(), 'head', [1, 1]))).toBe(structureKey(rig()));
    expect(structureKey(addLayer(rig(), 'parts/x.png', { width: 1, height: 1 }, null))).not.toBe(structureKey(rig()));
  });
});
