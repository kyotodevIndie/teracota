// Contrato da parte "app" da interface da Tera (conexão com agentes), separado do
// contrato do Agent Bridge (@tera/agent-bridge/contract), que é só sobre sessões.
import type { PanelResult } from '@tera/agent-bridge/contract';

export type PanelResultLike<T> = PanelResult<T>;

export const APP_PANEL_IPC = {
  connections: 'tera:connections',
  connect: 'tera:connect',
  setSpeech: 'tera:set-speech',
  copyOpenSessions: 'tera:copy-open-sessions',
  terminalPickFolder: 'tera:terminal-pick-folder',
  terminalStart: 'tera:terminal-start',
  terminalInput: 'tera:terminal-input',
  terminalResize: 'tera:terminal-resize',
  terminalKill: 'tera:terminal-kill',
  terminalSnapshot: 'tera:terminal-snapshot',
  minimize: 'tera:minimize',
  /** main -> renderer */
  terminalData: 'tera:terminal-data',
  terminalExit: 'tera:terminal-exit',
} as const;

/** Estado do terminal embutido (um por vez; sobrevive a esconder a janela) */
export interface TerminalSnapshot {
  running: boolean;
  /** Nome da pasta onde o terminal roda (null = pasta pessoal) */
  cwdLabel: string | null;
  /** Saída recente, pra redesenhar se a página da interface recarregar */
  scrollback: string;
}

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
  /** Minimiza a janela da interface (a barra de título é do HTML) */
  minimize(): Promise<PanelResult<null>>;
  /** Terminal embutido: roda o shell do usuário (e o `claude` dele) com o login que ele já tem */
  terminal: {
    /** Seletor de pasta do sistema; null = cancelou */
    pickFolder(): Promise<PanelResult<string | null>>;
    /** Abre o terminal na pasta escolhida; claude = já roda `claude` ao abrir */
    start(cols: number, rows: number, claude: boolean): Promise<PanelResult<TerminalSnapshot>>;
    input(data: string): void;
    resize(cols: number, rows: number): void;
    kill(): Promise<PanelResult<null>>;
    snapshot(): Promise<PanelResult<TerminalSnapshot>>;
    onData(cb: (data: string) => void): void;
    onExit(cb: (code: number) => void): void;
  };
}

declare global {
  interface Window {
    teracotaApp?: AppPanelApi;
  }
}
