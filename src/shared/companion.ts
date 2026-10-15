// Mini Companion: contrato entre o controller (main) e a janela compacta (renderer).
// O renderer só desenha o CompanionView; quem decide o estado é o main.
import type { Pose } from './skin';

export const COMPANION_IPC = {
  view: 'companion:view',
  cursor: 'companion:cursor',
  setIgnoreMouse: 'companion:set-ignore-mouse',
  /** Interações do usuário: hover, clique, arrastar arquivos, ações */
  input: 'companion:input',
  moveBy: 'companion:move-by',
  dragEnd: 'companion:drag-end',
  contextMenu: 'companion:context-menu',
  getSkin: 'companion:get-skin',
  /** Só em desenvolvimento: injeta eventos simulados */
  simulate: 'companion:simulate',
} as const;

/** Estado visual: um só por vez, derivado do contexto (ver visual-state.ts) */
export const VISUAL_STATES = ['MINI', 'EXPANDED', 'WORKING', 'ATTENTION', 'DRAGGING', 'NOTIFICATION', 'PANEL'] as const;
export type VisualState = (typeof VISUAL_STATES)[number];

export type NotificationKind = 'permission' | 'question' | 'error' | 'completion' | 'info';

/**
 * Ação que a interface pode oferecer. Só entra numa notificação se a Teracota
 * conseguir de fato executá-la — nunca um botão de aprovar que não aprova nada.
 */
export type ActionId =
  | 'acknowledge'   // "Vou ver no terminal": marca como encaminhada (a resposta acontece lá)
  | 'dismiss'       // fecha uma notificação informativa
  | 'mute'          // silencia notificações não críticas
  | 'unmute'
  | 'open-menu';    // menu completo da Teracota

export interface CompanionAction {
  id: ActionId;
  label: string;
}

export interface NotificationView {
  id: string;
  kind: NotificationKind;
  title: string;
  message: string;
  /** "Agente · projeto", quando se sabe de onde veio */
  origin: string | null;
  /** Quantas vezes o mesmo evento se repetiu (agrupado) */
  count: number;
  at: number;
  actions: CompanionAction[];
}

/** Pra que lado a barra cresce a partir do quadrado (depende de onde ele está na tela) */
export type Anchor = 'left' | 'right';

export interface CompanionView {
  state: VisualState;
  anchor: Anchor;
  /** Pose da Tera no quadrado */
  pose: Pose;
  /** Algum agente trabalhando (indicador discreto) */
  working: boolean;
  /** Solicitações aguardando resposta (badge no modo mini) */
  pendingCount: number;
  /** Notificação em destaque (ATTENTION/NOTIFICATION/EXPANDED com fila) */
  notification: NotificationView | null;
  /** Posição dela na fila e total, pra navegar entre várias */
  queue: { index: number; total: number };
  /** Texto do modo expandido sem notificação */
  context: { title: string; detail: string };
  actions: CompanionAction[];
  muted: boolean;
  /** Área de soltar arquivos (só em DRAGGING) */
  drop: { hint: string; note: string } | null;
}

export type CompanionInput =
  | { type: 'hover'; over: boolean }
  | { type: 'click' }
  | { type: 'drag-files'; over: boolean }
  | { type: 'drop-files'; names: string[] }
  | { type: 'action'; id: ActionId; notificationId?: string }
  | { type: 'navigate'; delta: 1 | -1 };

export interface CompanionApi {
  getSkin(): Promise<import('./skin').SkinInfo | null>;
  onView(cb: (view: CompanionView) => void): void;
  onCursor(cb: (p: { x: number; y: number }) => void): void;
  setIgnoreMouse(ignore: boolean): void;
  input(input: CompanionInput): void;
  moveBy(dx: number, dy: number): void;
  dragEnd(): void;
  openContextMenu(): void;
  /** Só em desenvolvimento */
  simulate(scenario: string): void;
}

declare global {
  interface Window {
    teracotaCompanion?: CompanionApi;
  }
}
