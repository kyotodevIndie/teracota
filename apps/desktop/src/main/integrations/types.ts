// Contrato entre os adapters de agentes e o Companion Core.
//
// Regra: nada específico de um agente sai da pasta do adapter. Cada adapter recebe
// os eventos nativos do seu agente e entrega AgentSignals normalizados; o core
// (manager/sessions) e o renderer nunca sabem qual agente originou o evento.
import type { CompanionEvent } from '../../shared/protocol';

/** O que um agente consegue informar. O core oferece a melhor experiência com o que houver. */
export interface AgentCapabilities {
  /** Identifica sessões (e projeto) — permite uma Tera por sessão */
  sessions: boolean;
  /** Avisa quando usa ferramentas (lendo, editando, terminal...) */
  toolEvents: boolean;
  /** Avisa quando arquivos são editados */
  fileEvents: boolean;
  /** Avisa quando precisa de permissão do usuário */
  permissions: boolean;
  /** Avisa quando algo falha */
  errors: boolean;
  /** Avisa quando termina a tarefa — sem isso, "trabalhando" expira sozinho rápido */
  completion: boolean;
  /** Mensagens do usuário/agente */
  messages: boolean;
  /** O agente fala com o MCP do Teracota (say/emote) */
  mcp: boolean;
}

/** Agente + sessão + projeto de um sinal */
export interface AgentSource {
  provider: string;
  sessionId: string;
  project: string;
}

/** O que um adapter entrega pro core, já normalizado */
export interface AgentSignal {
  source: AgentSource;
  /** Começo ou fim da sessão */
  lifecycle?: 'start' | 'end';
  /** true = começou a trabalhar, false = terminou; ausente = não muda */
  working?: boolean;
  /** A próxima ação é uma chamada ao MCP do Teracota (liga a chamada a esta sessão) */
  mcpCall?: boolean;
  /** O que mostrar (null = só atualiza a sessão) */
  event: CompanionEvent | null;
}

export interface AgentAdapter {
  /** Slug estável, ex.: "claude-code" */
  id: string;
  /** Nome pra mostrar no balão, ex.: "Claude Code" */
  displayName: string;
  capabilities: AgentCapabilities;
  /** Rotas HTTP locais que recebem os eventos nativos deste agente */
  routes: string[];
  /** Evento nativo (JSON) → sinal normalizado; null = ignorar */
  toSignal(body: unknown): AgentSignal | null;
  /** Opcional: conecta o agente ao Teracota (ex.: instala o plugin). Vira um item no menu. */
  connect?: AgentConnector;
}

export interface AgentConnector {
  /** Texto do item no menu, ex.: "Conectar ao Claude Code" */
  label: string;
  /** Instala/configura a integração */
  run(): Promise<ConnectResult>;
  /** Comando pra rodar à mão quando a conexão automática não der certo */
  manualCommand: string;
  /** O agente está instalado? A integração já está ativa? (usado pra oferecer a conexão) */
  status(): Promise<ConnectStatus>;
  /**
   * Opcional: como sessões que já estavam abertas passam a enviar eventos sem reiniciar.
   * Um app de fora não consegue digitar dentro da sessão — então a Tera copia o comando.
   */
  openSessions?: {
    /** Comando pra colar em cada sessão aberta, ex.: "/reload-plugins" */
    command: string;
  };
  /**
   * Opcional: o agente falar pela Tera (ferramentas MCP say/emote). Fica separado da
   * conexão principal porque pode ter custo pro usuário (ex.: o agente mostra erro de
   * MCP quando o Teracota está fechado). Vira uma opção liga/desliga no menu.
   */
  speech?: AgentSpeech;
}

export interface AgentSpeech {
  enable(port: number): Promise<ConnectResult>;
  disable(): Promise<ConnectResult>;
  enabled(): Promise<boolean>;
}

/** connected = já integrado; available = agente instalado, falta conectar; unavailable = agente não encontrado */
export type ConnectStatus = 'connected' | 'available' | 'unavailable';

export type ConnectResult = { ok: true } | { ok: false; reason: 'not-found' | 'failed'; output: string };
