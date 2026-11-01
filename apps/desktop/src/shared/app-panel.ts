// Contrato da parte "app" da interface da Tera (conexão com agentes), separado do
// contrato do Agent Bridge (@tera/agent-bridge/contract), que é só sobre sessões.
import type { PanelResult } from '@tera/agent-bridge/contract';
import type { LiveSnapshot, PanelPlacement, PrefsPatch, ProviderUsage, UiPrefs } from './live';
import type { PluginStatus } from './plugins';
import type { RemoteState } from './remote';

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
  live: 'tera:live',
  usage: 'tera:usage',
  prefs: 'tera:prefs',
  setPrefs: 'tera:set-prefs',
  /** Do pedido (peek) pra interface inteira */
  expand: 'tera:expand',
  plugins: 'tera:plugins',
  setPlugin: 'tera:set-plugin',
  setPluginValue: 'tera:set-plugin-value',
  openPluginsFolder: 'tera:open-plugins-folder',
  rescanPlugins: 'tera:rescan-plugins',
  pluginsChanged: 'tera:plugins-changed',
  remote: 'tera:remote',
  remoteSet: 'tera:remote-set',
  remotePair: 'tera:remote-pair',
  remoteConfirm: 'tera:remote-confirm',
  remoteRevoke: 'tera:remote-revoke',
  remoteChanged: 'tera:remote-changed',
  /** main -> renderer: a Tera falou (com a interface aberta, a fala aparece nela) */
  speech: 'tera:speech',
  /** renderer -> main, sem resposta: altura do conteúdo e recorte dos cartões */
  layout: 'tera:layout',
  /** main -> renderer */
  terminalData: 'tera:terminal-data',
  terminalExit: 'tera:terminal-exit',
  liveChanged: 'tera:live-changed',
  usageChanged: 'tera:usage-changed',
  prefsChanged: 'tera:prefs-changed',
  placement: 'tera:placement',
} as const;

/** Retângulo do recorte da janela (px da janela) */
export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

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
  /** Sessões dos agentes agora (e as encerradas há pouco) */
  live(): Promise<PanelResult<LiveSnapshot>>;
  /** Limites de uso por IA */
  usage(): Promise<PanelResult<ProviderUsage[]>>;
  prefs(): Promise<PanelResult<UiPrefs>>;
  setPrefs(patch: PrefsPatch): Promise<PanelResult<UiPrefs>>;
  /** Abre a interface inteira (a partir do pedido mostrado sozinho) */
  expand(): Promise<PanelResult<null>>;
  /** Altura do conteúdo e onde estão os cartões (o resto da janela deixa o clique passar) */
  layout(height: number, rects: LayoutRect[]): void;
  onLive(cb: (snapshot: LiveSnapshot) => void): void;
  onUsage(cb: (usage: ProviderUsage[]) => void): void;
  onPrefs(cb: (prefs: UiPrefs) => void): void;
  onPlacement(cb: (placement: PanelPlacement) => void): void;
  /** Plugins: lista, ligar (aprova as permissões pedidas), ajustes, pasta */
  plugins(): Promise<PanelResult<PluginStatus[]>>;
  setPlugin(id: string, on: boolean): Promise<PanelResult<PluginStatus[]>>;
  setPluginValue(id: string, key: string, value: number | boolean | string): Promise<PanelResult<PluginStatus[]>>;
  openPluginsFolder(): Promise<PanelResult<null>>;
  rescanPlugins(): Promise<PanelResult<PluginStatus[]>>;
  onPlugins(cb: (list: PluginStatus[]) => void): void;
  onSpeech(cb: (s: { text: string; from?: string }) => void): void;
  /** Celular (rede de casa): ligar, QR de pareamento, confirmar, desconectar */
  remote(): Promise<PanelResult<RemoteState>>;
  remoteSet(on: boolean): Promise<PanelResult<RemoteState>>;
  remotePair(): Promise<PanelResult<RemoteState>>;
  remoteConfirm(approve: boolean): Promise<PanelResult<RemoteState>>;
  remoteRevoke(id: string): Promise<PanelResult<RemoteState>>;
  onRemote(cb: (s: RemoteState) => void): void;
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
