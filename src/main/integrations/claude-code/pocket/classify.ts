// Classificação de fim de execução e resumo seguro de ferramentas. Funções puras.
// ATENÇÃO: os formatos reais de erro de auth / sessão inexistente / limite NÃO foram verificados contra o
// Claude real (contrato §7); aqui só há mapeamento defensivo sobre campos tipados do SDK + padrões de texto.
import path from 'node:path';
import type { ErrorCode } from '../../../../shared/pocket';

export interface FailureEvidence {
  subtype: string;
  errors: readonly string[];
  assistantError?: string;
  rateLimitRejected: boolean;
  creditsRequired: boolean;
  startupFailure?: string;
  stderrTail: string;
  resumed: boolean;
  apiStatus?: number | null;
}

export interface Classified {
  code: ErrorCode;
  retryable: boolean;
}

const AUTH_ERRORS = new Set(['authentication_failed', 'oauth_org_not_allowed', 'account_on_hold', 'verification_required']);
const RE_AUTH = /not logged in|please run \/login|invalid api key|authentication[_ ]failed|oauth token (has )?expired|(status|http|error)[ :]*401\b/i;
const RE_SESSION = /no conversation found|session.{0,40}not found|could not find session/i;
const RE_LIMIT = /usage limit|limit reached|credits? (are )?required|out of credits/i;
const RE_NETWORK = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|network error/i;
const RE_OVERLOADED = /overloaded|(status|http|error)[ :]*(529|503|502)\b|temporarily unavailable/i;

/** Ordem do contrato §1.2 (itens 4–8; 1–3 são decididos pelo chamador). */
export function classifyFailure(e: FailureEvidence): Classified {
  const text = `${e.errors.join('\n')}\n${e.stderrTail}`;
  if (e.rateLimitRejected || e.creditsRequired || e.assistantError === 'billing_error') {
    return { code: e.creditsRequired ? 'CREDITS_REQUIRED' : 'USAGE_LIMITED', retryable: false };
  }
  if (e.assistantError && AUTH_ERRORS.has(e.assistantError)) return { code: 'AUTH_REQUIRED', retryable: false };
  if (e.startupFailure && /signin|login|access_denied|org_verify/i.test(e.startupFailure)) return { code: 'AUTH_REQUIRED', retryable: false };
  if (RE_AUTH.test(text)) return { code: 'AUTH_REQUIRED', retryable: false };
  if (e.resumed && RE_SESSION.test(text)) return { code: 'SESSION_NOT_FOUND', retryable: false };
  if (RE_LIMIT.test(text) || e.assistantError === 'rate_limit') return { code: 'USAGE_LIMITED', retryable: false };
  if (e.subtype === 'error_max_turns') return { code: 'MAX_TURNS', retryable: false };
  if (e.assistantError === 'overloaded' || e.assistantError === 'server_error' || RE_OVERLOADED.test(text) || (e.apiStatus != null && e.apiStatus >= 500)) {
    return { code: 'TRANSIENT_OVERLOADED', retryable: true };
  }
  if (RE_NETWORK.test(text)) return { code: 'TRANSIENT_NETWORK', retryable: true };
  return { code: 'UNKNOWN', retryable: false };
}

/** Mensagem curta e sem conteúdo do usuário para o evento `failed`. */
export function sanitizedMessage(code: ErrorCode): string {
  switch (code) {
    case 'AUTH_REQUIRED': return 'O Claude Code não está autenticado.';
    case 'SESSION_NOT_FOUND': return 'A sessão anterior não existe mais.';
    case 'USAGE_LIMITED': return 'Limite de uso atingido.';
    case 'CREDITS_REQUIRED': return 'Créditos necessários para continuar.';
    case 'TRANSIENT_OVERLOADED': return 'Serviço sobrecarregado.';
    case 'TRANSIENT_NETWORK': return 'Falha de rede.';
    case 'MAX_TURNS': return 'Limite de turnos atingido.';
    case 'RUNNER_DIED': return 'O processo do Claude Code terminou sem resultado.';
    default: return 'Erro não classificado.';
  }
}

/**
 * Resumo de uma tool_use para eventos/UI: só o nome do alvo (arquivo) ou o primeiro token do comando.
 * Nunca o conteúdo de escrita, o texto de edição, argumentos de comando ou padrões de busca.
 */
export function summarizeToolUse(toolName: string, input: Record<string, unknown>): string {
  const str = (k: string): string | undefined => (typeof input[k] === 'string' ? (input[k] as string) : undefined);
  const file = str('file_path') ?? str('notebook_path') ?? str('path');
  if (file) return `${toolName} ${path.basename(file)}`.slice(0, 120);
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    const first = (str('command') ?? '').trim().split(/\s+/)[0] ?? '';
    return `${toolName} ${first.replace(/[^\w./:\\-]/g, '').slice(0, 40)}`.trim();
  }
  return toolName.slice(0, 120);
}
