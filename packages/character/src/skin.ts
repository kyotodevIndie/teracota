// Formato de skin (pacote de sprites) — compartilhado entre main, renderer e o importador.
import { isSafeImagePath, type RigManifest } from './rig';

/** Poses que uma skin pode ter. Só `idle` é obrigatória; as outras caem num fallback. */
export const POSES = [
  'idle', 'walk', 'drag', 'land', 'work', 'think', 'talk',
  'happy', 'error', 'sad', 'sleep', 'wave', 'surprised',
] as const;
export type Pose = (typeof POSES)[number];

export interface SkinAnimation {
  /** Caminhos relativos à pasta da skin */
  frames: string[];
  /** Duração de cada frame em ms */
  durations: number[];
  /** false = toca uma vez (ex.: land). Padrão: true */
  loop?: boolean;
  /** Corrige o tamanho desta animação em relação às outras (ancorado nos pés). Padrão: 1 */
  scale?: number;
  /**
   * Só pra `drag`: em vez de tocar em loop, escolhe o frame pelo balanço do pêndulo.
   * Índices dos frames com os pés pra direita, no centro e pra esquerda, e quantos
   * graus de inclinação já estão desenhados nos frames inclinados.
   */
  swing?: SkinSwing;
}

export interface SkinSwing {
  feetRight: number;
  center: number;
  feetLeft: number;
  lean: number;
}

export interface SkinManifest {
  name: string;
  /** sprites (frames por pose) ou rig (camadas articuladas, o padrão da Tera) */
  type?: 'sprites' | 'rig';
  /** Só pra type "rig": caminho do rig.json, relativo à pasta da skin */
  rig?: string;
  /** Tamanho (px) em que cada frame quadrado é desenhado na tela */
  size: number;
  /** Pra que lado o personagem olha na animação `walk` */
  facing: 'left' | 'right';
  animations: Partial<Record<Pose, SkinAnimation>>;
}

/** Lado das máscaras de clique (canal alfa reduzido), em px */
export const HIT_MASK_SIZE = 64;

/** O que o main manda pro renderer */
export interface SkinInfo {
  id: string;
  /** URL (file://) da pasta da skin, terminando em / */
  baseUrl: string;
  manifest: SkinManifest;
  /** Alfa de cada frame em HIT_MASK_SIZE², pra saber se o mouse está em cima do personagem */
  hitMasks: Partial<Record<Pose, Uint8Array[]>>;
  /** Só skins de rig: o manifesto do rig já validado */
  rig?: RigManifest;
}

/** A skin de sprites da Tera: é ela o fallback quando o rig falha */
export const ORIGINAL_SKIN_ID = 'tera';

/** O rig 2D da Tera: o renderer padrão */
export const DEFAULT_SKIN_ID = 'tera-rig';

/** Id reservado pro personagem desenhado em SVG (sem sprites) */
export const SVG_SKIN_ID = 'svg';

function parseSwing(input: unknown, frameCount: number): { swing?: SkinSwing } {
  if (!input || typeof input !== 'object') return {};
  const s = input as Record<string, unknown>;
  const index = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < frameCount ? v : null);
  const feetRight = index(s.feetRight);
  const center = index(s.center);
  const feetLeft = index(s.feetLeft);
  if (feetRight === null || center === null || feetLeft === null) return {};
  return { swing: { feetRight, center, feetLeft, lean: typeof s.lean === 'number' ? s.lean : 0 } };
}

export function parseSkinManifest(input: unknown): SkinManifest | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const base = {
    name: typeof o.name === 'string' ? o.name : 'Skin',
    size: typeof o.size === 'number' && o.size > 0 ? o.size : 260,
    facing: o.facing === 'left' ? 'left' as const : 'right' as const,
  };
  if (o.type === 'rig') {
    // o rig.json em si é validado por parseRigManifest (rig.ts) ao carregar
    return isSafeJsonPath(o.rig) ? { ...base, type: 'rig', rig: o.rig, animations: {} } : null;
  }
  if (!o.animations || typeof o.animations !== 'object') return null;
  const animations: SkinManifest['animations'] = {};
  for (const pose of POSES) {
    const a = (o.animations as Record<string, unknown>)[pose] as Partial<SkinAnimation> | undefined;
    if (!a || !Array.isArray(a.frames) || !a.frames.length) continue;
    const frames = a.frames.filter((f): f is string => typeof f === 'string');
    const durations = frames.map((_, i) => {
      const d = Array.isArray(a.durations) ? a.durations[i] : undefined;
      return typeof d === 'number' && d > 0 ? d : 150;
    });
    const scale = typeof a.scale === 'number' && a.scale > 0.2 && a.scale < 3 ? a.scale : 1;
    animations[pose] = { frames, durations, loop: a.loop !== false, scale, ...parseSwing(a.swing, frames.length) };
  }
  if (!animations.idle) return null;
  // sem "type": skin de sprites (formato de sempre, inalterado)
  return { ...base, animations };
}

/** Caminho relativo seguro pra um .json dentro da pasta da skin */
function isSafeJsonPath(p: unknown): p is string {
  return typeof p === 'string' && p.toLowerCase().endsWith('.json') && isSafeImagePath(p.replace(/\.json$/i, '.png'));
}
