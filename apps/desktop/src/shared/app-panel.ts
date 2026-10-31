// Contrato da parte "app" da interface da Tera (conexão com agentes), separado do
// contrato do Agent Bridge (@tera/agent-bridge/contract), que é só sobre sessões.
import type { PanelResult } from '@tera/agent-bridge/contract';

export const APP_PANEL_IPC = {
  connections: 'tera:connections',
  connect: 'tera:connect',
  setSpeech: 'tera:set-speech',
  copyOpenSessions: 'tera:copy-open-sessions',
} as const;

/** Um agente que a Tera sabe conectar (hooks) e o estado dele */
export interface AgentConnection {
  id: string;
  displayName: string;
  /** Texto do botão, ex.: "Conectar ao Claude Code" */
  label: string;
  /** connected = hooks instalados; available = agente instalado, falta conectar; unavailable = não encontrado */
  status: 'connected' | 'available' | 'unavailable';
  /** O agente fala pela Tera (MCP say/emote)? null = o agente não tem isso */
  speech: boolean | null;
  /** Comando pra colar nas sessões já abertas (ex.: /reload-plugins) */
  openSessionsCommand: string | null;
  /** Comando pra conectar à mão, se o botão não der certo */
  manualCommand: string;
}

/** API exposta pelo preload da interface (`window.teracotaApp`) */
export interface AppPanelApi {
  connections(): Promise<PanelResult<AgentConnection[]>>;
  connect(id: string): Promise<PanelResult<AgentConnection[]>>;
  setSpeech(id: string, on: boolean): Promise<PanelResult<AgentConnection[]>>;
  copyOpenSessions(id: string): Promise<PanelResult<null>>;
}

declare global {
  interface Window {
    teracotaApp?: AppPanelApi;
  }
}
