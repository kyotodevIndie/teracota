// Contrato do runner (docs/phase0/runner-contract.md §1). Independente de host e de SDK.
import type { ActionClass, ErrorCode, RunnerEvent } from '../../../shared/pocket';

export interface RunnerCapabilities {
  structuredEvents: boolean;
  interrupt: boolean;
  resumeSession: boolean;
  hostChosenSessionId: boolean;
  persistentApproval: boolean;
  usageMetrics: 'official' | 'estimate' | 'unavailable';
  authMode: 'user_managed';
}

export interface RunPolicy {
  /** Tempo máximo de uma aprovação pendente (decisão 4: 10 min). */
  approvalTtlMs: number;
}

export interface StartInput {
  taskId: string;
  runId: string;
  sessionId: string;
  cwd: string;
  prompt: string;
  policy: RunPolicy;
  /** Tentativa (1 = primeira); retries são decididos pelo orquestrador. */
  attempt?: number;
}
export interface ResumeInput extends StartInput {
  userGestureId: string;
}

export type InterruptOutcome = {
  accepted: boolean;
  outcome: 'interrupted' | 'forced_kill' | 'not_running' | 'already_pending';
};

/** Decisão já gravada pelo Core (com HMAC); o adapter só a repassa ao hook de finalização. */
export interface SignedDecision {
  approvalRequestId: string;
  decision: 'allow' | 'deny';
  hmac: string;
}

export interface AgentRunner {
  readonly id: string;
  capabilities(): Promise<RunnerCapabilities>;
  start(i: StartInput): Promise<{ runId: string }>;
  interrupt(runId: string, o: { reason: 'user' | 'cancel'; forceAfterMs: number }): Promise<InterruptOutcome>;
  resume(i: ResumeInput): Promise<{ runId: string }>;
  resolveApproval(runId: string, approvalRequestId: string, decision: SignedDecision): Promise<void>;
  onEvent(cb: (e: RunnerEvent) => void): () => void;
}

// ── ganchos que o orquestrador injeta (o adapter não muda estado nem decide política) ─────────────

export interface ToolRequest {
  toolName: string;
  input: Record<string, unknown>;
  toolUseId?: string;
  blockedPath?: string;
  signal: AbortSignal;
}
export interface RunContext {
  taskId: string;
  sessionId: string;
  runId: string;
  cwd: string;
  policy: RunPolicy;
  attempt: number;
  resumed: boolean;
  userGestureId?: string;
}

export type ToolDecision =
  | { kind: 'allow'; updatedInput?: Record<string, unknown> }
  | { kind: 'deny'; message: string; interrupt?: boolean; code?: ErrorCode }
  | {
      kind: 'ask';
      approvalRequestId: string;
      actionKey: string;
      classification: ActionClass;
      summary: string;
      expiresAt: number;
    };

export interface PermissionHooks {
  /** Chamado do `canUseTool`. Pode registrar intenção no ledger quando devolve `allow`. */
  decide(ctx: RunContext, req: ToolRequest): Promise<ToolDecision>;
  /** Depois que o usuário respondeu: confere fence/TTL/HMAC, consome a aprovação e registra a intenção. */
  finalize(ctx: RunContext, req: ToolRequest, d: SignedDecision): Promise<ToolDecision>;
  /** Portão uniforme (anterior ao modelo de permissão do CLI): NEGA (fence, credenciais, caminho bloqueado, R6) ou força 'ask' (garante que o canUseTool decida e registre). Nunca libera. `null` = segue o fluxo normal. */
  precheck(ctx: RunContext, req: ToolRequest): ToolDecision | 'ask' | null;
  /** `tool_result` recebido para um `toolUseId` (confirma o efeito no ledger). */
  toolResult(ctx: RunContext, toolUseId: string): void;
}

/** Quem atribui `eventId`/`seq` e persiste: o Core (store.appendEvent). */
export type EventSink = (runId: string, type: RunnerEvent['type'], payload: unknown) => RunnerEvent;
