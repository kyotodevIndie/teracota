// Painel de conversa (experimental): contrato entre o main e o renderer do painel.
// Só tipos e nomes de canais — nada específico de um agente.

export interface ProviderDescriptor {
  id: string;
  displayName: string;
  available: boolean;
  /** Por que não está disponível (mostrado ao usuário) */
  reason?: string;
}

export type BridgeState =
  | 'starting' | 'idle' | 'running' | 'waiting-permission' | 'done' | 'error' | 'cancelled' | 'closed';

/** Sessão anterior que dá pra retomar */
export interface SessionSummary {
  id: string;
  title: string;
  lastModified: number;
}

/** Eventos que um provider emite (o estado é derivado pelo manager) */
export type ProviderEventBody =
  | { type: 'session'; sessionId: string; cwdLabel: string; model: string }
  | { type: 'text-delta'; text: string }
  | { type: 'message'; role: 'user' | 'assistant'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'permission-request'; id: string; toolName: string; detail: string; outsideCwd: boolean }
  | { type: 'permission-resolved'; id: string; allow: boolean }
  | { type: 'turn-end'; outcome: 'done' | 'error' | 'cancelled'; message?: string };

export type BridgeEventBody = ProviderEventBody | { type: 'state'; state: BridgeState };

export type BridgeEvent = BridgeEventBody & { handle: string };

export interface HistoryEntry {
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
}

export interface PendingPermission {
  id: string;
  toolName: string;
  detail: string;
  outsideCwd: boolean;
}

export interface SessionSnapshot {
  handle: string;
  providerId: string;
  state: BridgeState;
  cwdLabel: string;
  model?: string;
  history: HistoryEntry[];
  /** Texto em streaming do turno atual, ainda sem virar mensagem */
  partial: string;
  permissions: PendingPermission[];
}

export interface FolderPick {
  cwdLabel: string;
  sessions: SessionSummary[];
}

export type PanelResult<T> = { ok: true; data: T } | { ok: false; error: string };

export const PANEL_IPC = {
  listProviders: 'panel:list-providers',
  pickFolder: 'panel:pick-folder',
  startSession: 'panel:start-session',
  send: 'panel:send',
  respondPermission: 'panel:respond-permission',
  interrupt: 'panel:interrupt',
  closeSession: 'panel:close-session',
  snapshot: 'panel:snapshot',
  hide: 'panel:hide',
  /** main -> renderer */
  event: 'panel:event',
} as const;

/** API estreita exposta pelo preload do painel (`window.teracotaPanel`) */
export interface PanelApi {
  listProviders(): Promise<PanelResult<ProviderDescriptor[]>>;
  /** O main abre o seletor de pasta; o renderer nunca informa caminhos */
  pickFolder(providerId: string): Promise<PanelResult<FolderPick | null>>;
  startSession(providerId: string, resumeId?: string): Promise<PanelResult<{ handle: string }>>;
  send(handle: string, text: string): Promise<PanelResult<null>>;
  respondPermission(handle: string, requestId: string, allow: boolean): Promise<PanelResult<null>>;
  interrupt(handle: string): Promise<PanelResult<null>>;
  closeSession(handle: string): Promise<PanelResult<null>>;
  snapshot(): Promise<PanelResult<SessionSnapshot[]>>;
  hide(): Promise<PanelResult<null>>;
  onEvent(cb: (e: BridgeEvent) => void): void;
}

declare global {
  interface Window {
    teracotaPanel?: PanelApi;
  }
}
