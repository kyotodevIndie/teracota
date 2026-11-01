// Edições do Skin Studio sobre o rig.json cru (o objeto que vai pro arquivo): mexem só no
// que foi pedido e preservam o resto (inclusive "$schema" e campos desconhecidos).
// Puras e testadas; a tela só chama.
import { type Mat, invert } from '@tera/character/rig';

export type RawLayer = Record<string, unknown> & {
  id: string;
  image: string;
  parent?: string | null;
  pivot: [number, number];
  at: [number, number];
  z?: number;
  rotation?: number;
  scale?: number | [number, number];
  variants?: Record<string, string>;
  visible?: boolean;
};

export type RawPoseLayer = { rotation?: number; dx?: number; dy?: number; scaleX?: number; scaleY?: number; variant?: string; visible?: boolean };

export type RawRig = Record<string, unknown> & {
  canvas: number;
  feet?: [number, number];
  layers: RawLayer[];
  poses?: Record<string, { layers: Record<string, RawPoseLayer> }>;
  expressions?: Record<string, Record<string, string>>;
  controllers?: Record<string, unknown>;
};

const round = (v: number, step = 0.5) => Math.round(v / step) * step;
const round2 = (p: [number, number]): [number, number] => [round(p[0]), round(p[1])];

export const clone = (rig: RawRig): RawRig => structuredClone(rig);

export function layer(rig: RawRig, id: string): RawLayer | undefined {
  return rig.layers.find((l) => l.id === id);
}

/** Parte linear (rotação/escala) da matriz aplicada a um vetor */
const linear = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y, m[1] * x + m[3] * y];

/** Vetor em px do rig → no espaço do pai (onde ficam `at`, dx e dy) */
export function toParentSpace(parentWorld: Mat | null, dx: number, dy: number): [number, number] {
  if (!parentWorld) return [dx, dy];
  const inv = invert(parentWorld);
  return inv ? linear(inv, dx, dy) : [dx, dy];
}

/** Arrastou a camada (no repouso): muda onde o pivô fica no pai */
export function moveLayer(rig: RawRig, id: string, parentDelta: [number, number]): RawRig {
  const next = clone(rig);
  const l = layer(next, id);
  if (l) l.at = round2([l.at[0] + parentDelta[0], l.at[1] + parentDelta[1]]);
  return next;
}

/**
 * Move o pivô sem a imagem sair do lugar: o pivô anda `localDelta` (px da imagem) e o `at`
 * compensa com a rotação e a escala da camada.
 */
export function movePivot(rig: RawRig, id: string, localDelta: [number, number]): RawRig {
  const next = clone(rig);
  const l = layer(next, id);
  if (!l) return next;
  const [sx, sy] = typeof l.scale === 'number' ? [l.scale, l.scale] : l.scale ?? [1, 1];
  const r = ((l.rotation ?? 0) * Math.PI) / 180;
  const [ux, uy] = [localDelta[0] * sx, localDelta[1] * sy];
  const shift: [number, number] = [Math.cos(r) * ux - Math.sin(r) * uy, Math.sin(r) * ux + Math.cos(r) * uy];
  l.pivot = round2([l.pivot[0] + localDelta[0], l.pivot[1] + localDelta[1]]);
  l.at = round2([l.at[0] + shift[0], l.at[1] + shift[1]]);
  return next;
}

/** Ajuste de uma camada numa pose (cria a pose e a entrada se faltar; valor neutro remove) */
export function setPoseValue(rig: RawRig, pose: string, id: string, key: keyof RawPoseLayer, value: number | string | boolean | undefined): RawRig {
  const next = clone(rig);
  next.poses ??= {};
  next.poses[pose] ??= { layers: {} };
  const entry = (next.poses[pose].layers[id] ??= {});
  const neutral = key === 'scaleX' || key === 'scaleY' ? 1 : key === 'variant' ? 'default' : 0;
  if (value === undefined || value === neutral || value === '') delete entry[key];
  else (entry as Record<string, unknown>)[key] = typeof value === 'number' ? round(value, 0.1) : value;
  if (!Object.keys(entry).length) delete next.poses[pose].layers[id];
  return next;
}

/** Arrastou a camada numa pose: soma ao dx/dy da pose */
export function nudgePose(rig: RawRig, pose: string, id: string, parentDelta: [number, number]): RawRig {
  const cur = rig.poses?.[pose]?.layers[id] ?? {};
  const moved = setPoseValue(rig, pose, id, 'dx', (cur.dx ?? 0) + parentDelta[0]);
  return setPoseValue(moved, pose, id, 'dy', (cur.dy ?? 0) + parentDelta[1]);
}

/** Campo da camada (repouso) */
export function setLayerValue(rig: RawRig, id: string, key: string, value: unknown): RawRig {
  const next = clone(rig);
  const l = layer(next, id);
  if (!l) return next;
  if (value === undefined) delete l[key];
  else l[key] = value;
  return next;
}

/** Id livre parecido com o pedido (corpo, corpo-2, ...) */
export function freeId(rig: RawRig, wanted: string): string {
  const base = wanted.toLowerCase().replace(/\.png$/, '').replace(/[^a-z0-9_-]+/g, '_').replace(/^[^a-z0-9]+/, '').slice(0, 36) || 'camada';
  const ids = new Set(rig.layers.map((l) => l.id));
  if (!ids.has(base)) return base;
  for (let i = 2; ; i++) if (!ids.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Camada nova presa no pai (ou na raiz), com o pivô no centro da imagem e na frente de tudo */
export function addLayer(rig: RawRig, image: string, size: { width: number; height: number }, parent: string | null): RawRig {
  const next = clone(rig);
  const root = next.layers.find((l) => !l.parent);
  const id = freeId(next, image.split('/').pop() ?? 'camada');
  const z = Math.max(0, ...next.layers.map((l) => l.z ?? 0)) + 10;
  const parentId = parent ?? root?.id ?? null;
  const at: [number, number] = parentId ? [0, 0] : [next.canvas / 2, next.canvas / 2];
  next.layers.push({ id, image, parent: parentId, pivot: round2([size.width / 2, size.height / 2]), at, z });
  return next;
}

/** Remove a camada; os filhos passam pro avô; tira das poses, expressões e movimentos */
export function removeLayer(rig: RawRig, id: string): RawRig {
  const next = clone(rig);
  const l = layer(next, id);
  if (!l || !l.parent) return next; // a raiz não sai
  for (const child of next.layers) if (child.parent === id) child.parent = l.parent;
  next.layers = next.layers.filter((x) => x.id !== id);
  for (const p of Object.values(next.poses ?? {})) delete p.layers[id];
  for (const e of Object.values(next.expressions ?? {})) delete e[id];
  const c = next.controllers ?? {};
  for (const [name, ctl] of Object.entries(c)) {
    if (JSON.stringify(ctl).includes(`"${id}"`)) delete c[name];
  }
  return next;
}

/** Ordem pra mostrar a árvore: pais antes dos filhos, com a profundidade */
export function tree(rig: RawRig): { layer: RawLayer; depth: number }[] {
  const out: { layer: RawLayer; depth: number }[] = [];
  const kids = (p: string | null) => rig.layers.filter((l) => (l.parent ?? null) === p).sort((a, b) => (b.z ?? 0) - (a.z ?? 0));
  const visit = (l: RawLayer, depth: number, seen: Set<string>) => {
    if (seen.has(l.id)) return;
    seen.add(l.id);
    out.push({ layer: l, depth });
    for (const k of kids(l.id)) visit(k, depth + 1, seen);
  };
  const seen = new Set<string>();
  for (const r of kids(null)) visit(r, 0, seen);
  // pais que não existem (rig com erro): aparecem soltos no fim
  for (const l of rig.layers) if (!seen.has(l.id)) visit(l, 0, seen);
  return out;
}

/** O que muda o carregamento das imagens (camadas, pais, arquivos): o resto é só número */
export function structureKey(rig: RawRig): string {
  return JSON.stringify(rig.layers.map((l) => [l.id, l.parent ?? null, l.image, l.variants ?? null]));
}
