// Contrato do "agora" da interface: sessões dos agentes ao vivo, pedidos pro usuário,
// limites de uso por IA e preferências visuais (temas). O main monta; a interface só desenha.
import type { ToolActivity } from '@tera/agent-bridge/contract';

/** O que a sessão está fazendo agora */
export type ActivityKind = ToolActivity | 'listening' | 'idle';

export interface Activity {
  kind: ActivityKind;
  /** Ex.: nome do arquivo, começo do comando, padrão da busca */
  detail?: string;
}

/**
 * O agente precisa do usuário. permission = pediu pra usar uma ferramenta; question =
 * fez uma pergunta (com opções, quando o agente manda); idle = parou esperando resposta.
 * A resposta é no terminal da sessão: a Tera mostra, não responde por ela.
 */
export interface AgentRequest {
  kind: 'permission' | 'question' | 'idle';
  /** Texto curto do agente, ex.: "Claude precisa da sua permissão para usar Bash" */
  message: string;
  /** Ex.: o comando que ele quer rodar */
  detail?: string;
  /** Alternativas de uma pergunta (só leitura) */
  options?: string[];
  at: number;
}

/** Sigla e cor do ícone de uma IA (até ter os ícones de verdade) */
export interface AiBadge {
  text: string;
  color: string;
}

export interface LiveSession {
  key: string;
  provider: string;
  providerName: string;
  badge: AiBadge;
  project: string;
  working: boolean;
  activity: Activity | null;
  request: AgentRequest | null;
  startedAt: number;
  lastSeen: number;
  /** Presente nas encerradas */
  endedAt?: number;
}

export interface LiveSnapshot {
  active: LiveSession[];
  /** Encerradas recentemente (as mais novas primeiro) */
  ended: LiveSession[];
}

/** Uma janela de limite do plano, ex.: as 5 horas ou a semana */
export interface UsageWindow {
  id: 'five_hour' | 'seven_day' | 'spend_limit';
  /** 0-100 (pode passar de 100 no spend_limit) */
  usedPct: number;
  /** ms desde a época; null = sem data */
  resetsAt: number | null;
}

export interface ProviderUsage {
  provider: string;
  displayName: string;
  badge: AiBadge;
  windows: UsageWindow[];
  updatedAt: number;
}

export const THEMES = ['vidro', 'aurora', 'claro', 'contraste'] as const;
export type ThemeId = (typeof THEMES)[number];

/** Preferências da interface e da Tera que aparecem nos Ajustes */
export interface UiPrefs {
  theme: ThemeId;
  /** Opacidade do vidro dos cartões, 0.4-0.95 */
  glass: number;
  moveMode: 'roam' | 'stay';
  reducedMotion: boolean;
  entityMode: 'single' | 'multi';
  /** IAs que sabem mandar os limites de uso pra Tera (cada uma liga nos Ajustes) */
  usageSources: UsageSource[];
}

export interface UsageSource {
  provider: string;
  label: string;
  description: string;
  enabled: boolean;
}

/** O que os Ajustes podem mudar de uma vez */
export type PrefsPatch = Partial<Omit<UiPrefs, 'usageSources'>> & {
  /** Liga/desliga os limites de uma IA */
  usage?: { provider: string; on: boolean };
};

export const DEFAULT_GLASS = 0.78;

export type PanelMode = 'full' | 'peek';

/** Onde a interface está em relação à Tera, e pra onde a pontinha aponta */
export interface PanelPlacement {
  mode: PanelMode;
  side: 'above' | 'below';
  /** x da pontinha (px dentro da janela) */
  tailX: number;
  /** Altura máxima que o conteúdo pode ter */
  maxHeight: number;
}
