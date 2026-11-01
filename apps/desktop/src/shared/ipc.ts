// Contrato de IPC entre o processo principal e o renderer (via preload).
import type { CompanionEvent } from './protocol';
import type { SkinInfo } from '@tera/character/skin';

export const IPC = {
  event: 'teracota:event',
  walk: 'teracota:walk',
  cursor: 'teracota:cursor',
  mode: 'teracota:mode',
  identity: 'teracota:identity',
  leave: 'teracota:leave',
  setIgnoreMouse: 'teracota:set-ignore-mouse',
  contextMenu: 'teracota:context-menu',
  moveBy: 'teracota:move-by',
  dragEnd: 'teracota:drag-end',
  walkAllowed: 'teracota:walk-allowed',
  getSkin: 'teracota:get-skin',
  getFallbackSkin: 'teracota:get-fallback-skin',
  clicked: 'teracota:clicked',
  walkTo: 'teracota:walk-to',
  walkArrived: 'teracota:walk-arrived',
  motion: 'teracota:motion',
  setShape: 'teracota:set-shape',
} as const;

/** Retângulo em px da janela (recorte da área clicável) */
export interface ShapeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** roam = passeia pela tela; stay = fica parado onde foi deixado */
export type MoveMode = 'roam' | 'stay';

/** single = uma Tera pra todas as sessões; multi = uma por sessão de agente */
export type EntityMode = 'single' | 'multi';

/** Um trecho de passeio: o renderer anda a janela de `from` até `to` na velocidade dada */
export interface WalkPlan {
  from: Point;
  to: Point;
  /** px por segundo */
  speed: number;
  dir: 1 | -1;
}

export interface WalkInfo {
  walking: boolean;
  /** 1 = direita, -1 = esquerda */
  dir: 1 | -1;
  /** Presente quando começa um trecho */
  plan?: WalkPlan;
}

/** Preferências de movimento vindas do main */
export interface MotionInfo {
  /** O usuário pediu menos movimento no menu (o renderer também respeita o do sistema) */
  reduced: boolean;
}

export interface ModeInfo {
  mode: MoveMode;
  /** true quando o usuário acabou de trocar (o personagem comenta) */
  announce: boolean;
}

/** Quem a entidade representa: projeto (plaquinha) e cor */
export interface Identity {
  label: string | null;
  color: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface CompanionApi {
  /** Skin atual (null = personagem SVG) */
  getSkin(): Promise<SkinInfo | null>;
  /** A skin original da Tera, pra quando a skin atual falha no renderer (ex.: rig) */
  getFallbackSkin(): Promise<SkinInfo | null>;
  onEvent(cb: (event: CompanionEvent) => void): void;
  onWalk(cb: (info: WalkInfo) => void): void;
  /** Posição do cursor relativa à janela */
  onCursor(cb: (p: Point) => void): void;
  onMode(cb: (info: ModeInfo) => void): void;
  onIdentity(cb: (identity: Identity) => void): void;
  /** A entidade vai embora (sessão encerrada) — a janela fecha logo depois */
  onLeave(cb: () => void): void;
  onMotion(cb: (info: MotionInfo) => void): void;
  setIgnoreMouse(ignore: boolean): void;
  /** Área clicável da janela (o main só usa no Linux; nos outros sistemas vale o setIgnoreMouse) */
  setShape(rects: ShapeRect[]): void;
  openContextMenu(): void;
  moveBy(dx: number, dy: number): void;
  dragEnd(): void;
  setWalkAllowed(allowed: boolean): void;
  /** Passo do passeio (posição absoluta da janela), no ritmo dos quadros da tela */
  walkTo(x: number, y: number): void;
  /** Chegou ao fim do trecho */
  walkArrived(): void;
  /** Clicaram na Tera (o main abre a interface) */
  notifyClick(): void;
}

declare global {
  interface Window {
    teracota?: CompanionApi;
  }
}
