// Protocolo normalizado do Teracota. Toda integração (adapters de agentes, MCP,
// API local) termina num CompanionEvent — o renderer não sabe de onde ele veio.

export const DEFAULT_PORT = 7777;

export const EXPRESSIONS = ['neutral', 'happy', 'focused', 'confused', 'surprised', 'sleepy', 'sad'] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export const ANIMS = ['bob', 'type', 'sway', 'shake', 'jump', 'breathe', 'perk', 'wave'] as const;
export type Anim = (typeof ANIMS)[number];

export const STATES = [
  'idle', 'listening', 'thinking', 'reading', 'searching', 'typing', 'terminal', 'web',
  'delegating', 'error', 'attention', 'happy', 'sad', 'sleeping',
] as const;
export type StateName = (typeof STATES)[number];

/** O que a Tera deve mostrar. Não carrega nada específico de nenhum agente. */
export interface CompanionEvent {
  /** Atividade — define pose/expressão/animação/ícone padrão */
  state?: StateName;
  /** Sobrescreve a expressão do estado (ou reação passageira, se não houver state) */
  expression?: Expression;
  /** Sobrescreve a animação do estado (ou reação passageira, se não houver state) */
  anim?: Anim;
  /** Texto do balão de fala */
  say?: string;
  /** ms até voltar ao estado base */
  duration?: number;
  /** O agente está no meio de uma tarefa */
  working?: boolean;
  /** Etiqueta de origem no balão (ex.: "front" ou "Meu Agente · hera") — montada pelo core */
  from?: string;
}

/** De onde vem um evento: qual agente, qual sessão, qual projeto */
export interface EventSource {
  /** Identificador do agente/ferramenta em formato slug, ex.: "meu-agente" */
  provider: string;
  sessionId?: string;
  project?: string;
}

/** Evento recebido pela API local (`/api/v1/event`): o visual + origem e ciclo de vida opcionais */
export interface IncomingEvent {
  event: CompanionEvent | null;
  /** Com source, o evento entra no fluxo de sessões (e ganha uma Tera própria no modo "uma por sessão") */
  source?: EventSource;
  /** Começo/fim da sessão (só faz sentido com source) */
  lifecycle?: 'start' | 'end';
}

export function getPort(): number {
  return Number(process.env.TERACOTA_PORT) || DEFAULT_PORT;
}

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

const SLUG = /^[a-z0-9][a-z0-9._-]{0,39}$/;

function cleanText(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

/** Valida a origem: provider em formato slug; sessão e projeto como texto curto */
export function parseSource(input: unknown): EventSource | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const o = input as Record<string, unknown>;
  const provider = typeof o.provider === 'string' ? o.provider.trim().toLowerCase() : '';
  if (!SLUG.test(provider)) return undefined;
  const sessionId = cleanText(o.sessionId, 200);
  const project = cleanText(o.project, 60);
  return { provider, ...(sessionId && { sessionId }), ...(project && { project }) };
}

/** Valida uma requisição da API local: evento + origem/ciclo de vida opcionais */
export function parseIncoming(input: unknown): IncomingEvent | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const event = parseEvent(input);
  const source = parseSource(o.source);
  const lifecycle = source && (o.lifecycle === 'start' || o.lifecycle === 'end') ? o.lifecycle : undefined;
  if (!event && !lifecycle) return null;
  return { event, ...(source && { source }), ...(lifecycle && { lifecycle }) };
}

/** Valida um evento vindo de fora (HTTP); descarta campos inválidos. */
export function parseEvent(input: unknown): CompanionEvent | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const ev: CompanionEvent = {};
  if (isOneOf(STATES, o.state)) ev.state = o.state;
  if (isOneOf(EXPRESSIONS, o.expression)) ev.expression = o.expression;
  if (isOneOf(ANIMS, o.anim)) ev.anim = o.anim;
  if (typeof o.say === 'string' && o.say.trim()) ev.say = o.say.trim().slice(0, 280);
  if (typeof o.duration === 'number' && o.duration > 0) ev.duration = Math.min(o.duration, 60_000);
  if (typeof o.working === 'boolean') ev.working = o.working;
  if (typeof o.from === 'string' && o.from.trim()) ev.from = o.from.trim().slice(0, 40);
  return Object.keys(ev).length ? ev : null;
}
