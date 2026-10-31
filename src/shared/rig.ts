// Rig 2D: personagem montado com PNGs em camadas articuladas.
//
// Cada camada é uma imagem com um pivô (ponto de rotação, em px da própria imagem),
// presa num ponto do pai (`at`, em px da imagem do pai; na raiz, px do canvas do rig).
// A transformação de uma camada é herdada pelos filhos; a ordem de desenho (`z`) é
// independente da hierarquia (a cauda é filha do corpo mas fica atrás dele).
//
// Este arquivo é puro (sem DOM nem Electron): validação do manifesto e a matemática
// das matrizes, usadas tanto no desenho quanto no teste de clique.

export interface RigLayer {
  id: string;
  /** PNG relativo à pasta da skin */
  image: string;
  /** null = raiz */
  parent: string | null;
  /** Ponto de rotação, em px da imagem */
  pivot: [number, number];
  /** Onde o pivô fica, em px da imagem do pai (raiz: px do canvas do rig) */
  at: [number, number];
  /** Ordem de desenho (maior = na frente) */
  z: number;
  /** Ângulo de repouso, em graus */
  rotation: number;
  scale: [number, number];
  /** Limite pros ângulos procedurais (graus, somados ao repouso) */
  limits?: { rotation: [number, number] };
}

/** Respiração: escala sutil de uma camada, ancorada no pivô dela */
export interface BreatheController {
  layer: string;
  /** Período em ms */
  period: number;
  /** Amplitude da escala vertical (0.015 = 1,5%) */
  amount: number;
}

/** Balanço em cadeia (cauda, cabelo): cada camada segue a anterior com atraso de mola */
export interface SwayController {
  layers: string[];
  /** Ângulo máximo do balanço de base, em graus */
  amplitude: number;
  period: number;
}

export interface RigManifest {
  /** Lado do canvas do rig, em px (as coordenadas de `at` da raiz usam esse espaço) */
  canvas: number;
  /** Ponto dos pés, em px do canvas: âncora do movimento procedural do corpo inteiro */
  feet: [number, number];
  layers: RigLayer[];
  controllers: { breathe?: BreatheController; sway?: SwayController };
}

export const MAX_LAYERS = 64;
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const NUM_LIMIT = 100_000;

export type RigParseResult = { rig: RigManifest; errors?: undefined } | { rig?: undefined; errors: string[] };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= NUM_LIMIT;
const isPair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);

/** Caminho relativo seguro: só .png, sem subir de pasta nem caminho absoluto */
export function isSafeImagePath(p: unknown): p is string {
  if (typeof p !== 'string' || !p.toLowerCase().endsWith('.png')) return false;
  if (p.startsWith('/') || p.startsWith('\\') || /^[a-z]:/i.test(p) || p.includes('://')) return false;
  return !p.split(/[\\/]/).some((seg) => seg === '..' || seg === '');
}

/** Valida o rig.json. Erros vêm com o nome da camada, pra dar pra corrigir. */
export function parseRigManifest(input: unknown): RigParseResult {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') return { errors: ['o rig não é um objeto JSON'] };
  const o = input as Record<string, unknown>;

  const canvas = isNum(o.canvas) && o.canvas >= 16 && o.canvas <= 4096 ? o.canvas : null;
  if (canvas === null) errors.push('"canvas" deve ser um número entre 16 e 4096');
  const feet = isPair(o.feet) ? o.feet : canvas !== null ? ([canvas / 2, canvas] as [number, number]) : null;

  if (!Array.isArray(o.layers) || o.layers.length === 0) return { errors: [...errors, '"layers" deve ser uma lista com pelo menos uma camada'] };
  if (o.layers.length > MAX_LAYERS) return { errors: [...errors, `no máximo ${MAX_LAYERS} camadas (tem ${o.layers.length})`] };

  const layers: RigLayer[] = [];
  const ids = new Set<string>();
  for (const [i, raw] of (o.layers as unknown[]).entries()) {
    const l = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const name = typeof l.id === 'string' ? l.id : `#${i}`;
    const err = (msg: string) => { errors.push(`camada "${name}": ${msg}`); };
    if (typeof l.id !== 'string' || !ID.test(l.id)) { err('id inválido (letras, números, _ e -)'); continue; }
    if (ids.has(l.id)) { err('id repetido'); continue; }
    ids.add(l.id);
    if (!isSafeImagePath(l.image)) { err('"image" deve ser um .png relativo à pasta da skin'); continue; }
    if (l.parent !== null && l.parent !== undefined && typeof l.parent !== 'string') { err('"parent" deve ser um id ou null'); continue; }
    if (!isPair(l.pivot)) { err('"pivot" deve ser [x, y]'); continue; }
    if (!isPair(l.at)) { err('"at" deve ser [x, y]'); continue; }
    const scale = l.scale === undefined ? ([1, 1] as [number, number]) : isNum(l.scale) ? ([l.scale, l.scale] as [number, number]) : isPair(l.scale) ? l.scale : null;
    if (!scale || scale.some((s) => s < 0.1 || s > 5)) { err('"scale" deve ser um número ou [sx, sy] entre 0.1 e 5'); continue; }
    const rotation = l.rotation === undefined ? 0 : isNum(l.rotation) ? l.rotation : null;
    if (rotation === null) { err('"rotation" deve ser um número (graus)'); continue; }
    const z = l.z === undefined ? 0 : isNum(l.z) ? l.z : null;
    if (z === null) { err('"z" deve ser um número'); continue; }
    let limits: RigLayer['limits'];
    if (l.limits !== undefined) {
      const lim = (l.limits ?? {}) as Record<string, unknown>;
      if (!isPair(lim.rotation) || lim.rotation[0] > lim.rotation[1]) { err('"limits.rotation" deve ser [min, max]'); continue; }
      limits = { rotation: lim.rotation };
    }
    layers.push({
      id: l.id, image: l.image, parent: (l.parent as string | null | undefined) ?? null,
      pivot: l.pivot, at: l.at, z, rotation, scale, ...(limits && { limits }),
    });
  }

  // hierarquia: uma raiz, pais existentes, sem ciclos
  const byId = new Map(layers.map((l) => [l.id, l]));
  const roots = layers.filter((l) => l.parent === null);
  if (layers.length && roots.length !== 1) errors.push(`o rig precisa de exatamente uma raiz (parent: null); tem ${roots.length}`);
  for (const l of layers) {
    if (l.parent !== null && !byId.has(l.parent)) errors.push(`camada "${l.id}": pai "${l.parent}" não existe`);
  }
  for (const l of layers) {
    const seen = new Set<string>();
    let cur: RigLayer | undefined = l;
    while (cur?.parent) {
      if (seen.has(cur.id)) { errors.push(`camada "${l.id}": hierarquia em ciclo`); break; }
      seen.add(cur.id);
      cur = byId.get(cur.parent);
    }
  }

  const controllers: RigManifest['controllers'] = {};
  const c = (o.controllers ?? {}) as Record<string, unknown>;
  if (c.breathe !== undefined) {
    const b = c.breathe as Record<string, unknown>;
    if (typeof b?.layer !== 'string' || !byId.has(b.layer)) errors.push('controllers.breathe: "layer" deve ser uma camada existente');
    else controllers.breathe = { layer: b.layer, period: positive(b.period, 2600), amount: clamp(isNum(b.amount) ? b.amount : 0.015, 0, 0.2) };
  }
  if (c.sway !== undefined) {
    const s = c.sway as Record<string, unknown>;
    const list = Array.isArray(s?.layers) ? s.layers : null;
    if (!list?.length || !list.every((id) => typeof id === 'string' && byId.has(id))) {
      errors.push('controllers.sway: "layers" deve listar camadas existentes');
    } else {
      controllers.sway = { layers: list as string[], amplitude: clamp(isNum(s.amplitude) ? s.amplitude : 8, 0, 90), period: positive(s.period, 2200) };
    }
  }

  if (errors.length || canvas === null || feet === null) return { errors };
  return { rig: { canvas, feet, layers, controllers } };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const positive = (v: unknown, fallback: number) => (isNum(v) && v > 0 ? v : fallback);

// ---------- matrizes 2D ----------
// [a, b, c, d, e, f] como no Canvas: x' = a·x + c·y + e ; y' = b·x + d·y + f

export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Mat): Mat | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return null;
  return [
    m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** translate(at) · rotate(deg) · scale(sx, sy) · translate(-pivot) */
export function localMatrix(at: [number, number], deg: number, sx: number, sy: number, pivot: [number, number]): Mat {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  return [a, b, c, d, at[0] - (a * pivot[0] + c * pivot[1]), at[1] - (b * pivot[0] + d * pivot[1])];
}

/** Ajuste procedural de uma camada, somado ao repouso */
export interface LayerOffset {
  /** graus somados à rotação (presos em `limits`) */
  rotation?: number;
  /** multiplica a escala */
  scaleX?: number;
  scaleY?: number;
  dx?: number;
  dy?: number;
}

/** Camadas na ordem em que podem ser calculadas (pai antes do filho) */
export function topoOrder(rig: RigManifest): RigLayer[] {
  const out: RigLayer[] = [];
  const done = new Set<string>();
  const byId = new Map(rig.layers.map((l) => [l.id, l]));
  const visit = (l: RigLayer) => {
    if (done.has(l.id)) return;
    if (l.parent) visit(byId.get(l.parent)!);
    done.add(l.id);
    out.push(l);
  };
  for (const l of rig.layers) visit(l);
  return out;
}

/** Ordem de desenho: z crescente; empate mantém a ordem do manifesto */
export function drawOrder(rig: RigManifest): RigLayer[] {
  return rig.layers.map((l, i) => ({ l, i })).sort((a, b) => a.l.z - b.l.z || a.i - b.i).map(({ l }) => l);
}

/**
 * Matriz de cada camada: px da imagem → px do canvas do rig.
 * @param order resultado de topoOrder (calcule uma vez e reaproveite)
 */
export function worldMatrices(order: RigLayer[], offsets: Record<string, LayerOffset> = {}): Map<string, Mat> {
  const world = new Map<string, Mat>();
  for (const l of order) {
    const o = offsets[l.id];
    let rot = o?.rotation ?? 0;
    if (l.limits) rot = clamp(rot, l.limits.rotation[0], l.limits.rotation[1]);
    const at: [number, number] = [l.at[0] + (o?.dx ?? 0), l.at[1] + (o?.dy ?? 0)];
    const local = localMatrix(at, l.rotation + rot, l.scale[0] * (o?.scaleX ?? 1), l.scale[1] * (o?.scaleY ?? 1), l.pivot);
    world.set(l.id, l.parent ? multiply(world.get(l.parent)!, local) : local);
  }
  return world;
}

// ---------- clique ----------

/** Alfa de uma camada reduzido (gerado uma vez ao carregar) */
export interface AlphaMask {
  /** tamanho da imagem original */
  width: number;
  height: number;
  /** tamanho da máscara */
  mw: number;
  mh: number;
  data: Uint8Array;
}

/** O ponto (px da imagem) cai num pixel opaco da camada? */
export function maskHit(mask: AlphaMask, x: number, y: number, threshold = 40): boolean {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  const mx = Math.floor((x / mask.width) * mask.mw);
  const my = Math.floor((y / mask.height) * mask.mh);
  return (mask.data[my * mask.mw + mx] ?? 0) > threshold;
}

/**
 * Camada visível sob o ponto (px do canvas do rig), de cima pra baixo; null = nenhuma.
 * Só matemática: nada de ler pixels da tela.
 */
export function hitLayer(
  drawn: RigLayer[], world: Map<string, Mat>, masks: Map<string, AlphaMask>, x: number, y: number,
): string | null {
  for (let i = drawn.length - 1; i >= 0; i--) {
    const l = drawn[i]!;
    const m = world.get(l.id);
    const mask = masks.get(l.id);
    const inv = m && invert(m);
    if (!inv || !mask) continue;
    const [lx, ly] = apply(inv, x, y);
    if (maskHit(mask, lx, ly)) return l.id;
  }
  return null;
}
