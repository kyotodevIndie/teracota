// Tipos da Tera Pocket (Fase 1) compartilhados entre Core, adapter, orquestrador e UI.
// Fonte: docs/phase0/runner-contract.md. Sem dependências de Node/Electron.

export const TASK_STATES = [
  'queued', 'running', 'awaiting_approval', 'paused', 'interrupted', 'needs_reconcile', 'review',
  'completed', 'failed', 'cancelled', 'session_expired', 'auth_error', 'usage_limited',
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const SESSION_STATES = ['reserved', 'active', 'idle', 'orphaned', 'expired', 'archived'] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export type Actor = 'user' | 'system' | 'policy';

export const ERROR_CODES = [
  'AUTH_REQUIRED', 'SESSION_NOT_FOUND', 'USAGE_LIMITED', 'CREDITS_REQUIRED', 'TRANSIENT_OVERLOADED',
  'TRANSIENT_NETWORK', 'MAX_TURNS', 'RUNNER_DIED', 'RUNNER_SPAWN_FAILED', 'SESSION_ID_MISMATCH',
  'SESSION_ID_IN_USE', 'LOCK_BUSY', 'LOCK_LOST', 'INVALID_TRANSITION', 'POLICY_DENIED', 'PROTOCOL_ERROR',
  'UNKNOWN',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type ActionClass =
  | 'safe_read'          // leitura dentro do workspace / ferramentas internas
  | 'workspace_write'    // escrita livre dentro do workspace (decisão 3)
  | 'external_read'      // leitura fora do workspace
  | 'external_write'     // escrita fora do workspace
  | 'destructive'        // remoção, git commit/push, release, deploy
  | 'compound_shell'     // Bash composto ou fora da allowlist
  | 'unknown';           // não classificável com segurança

export interface TaskRow {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  state: TaskState;
  currentSessionId: string | null;
  interruptRequested: boolean;
  cancelRequested: boolean;
  pauseRequested: boolean;
  retryCount: number;
  lastErrorCode: ErrorCode | null;
  createdAt: number;
  updatedAt: number;
}

export interface SessionRow {
  id: string;
  taskId: string;
  generation: number;
  state: SessionState;
  externalActivity: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface RunRow {
  id: string;
  taskId: string;
  sessionId: string;
  kind: 'start' | 'resume';
  gestureId: string | null;
  attempt: number;
  runnerPid: number | null;
  runnerStartTime: string | null;
  startedAt: number;
  endedAt: number | null;
  outcome: string | null;
}

export interface JournalEntry {
  seq: number;
  ts: number;
  taskId: string | null;
  runId: string | null;
  runSeq: number | null;
  kind: 'transition' | 'event' | 'approval' | 'effect' | 'note';
  fromState: string | null;
  toState: string | null;
  reason: string | null;
  actor: Actor | null;
  gestureId: string | null;
  payload: unknown;
}

// ── Eventos normalizados do runner (contrato §1.2) ─────────────────────────

export type RunnerEventType =
  | 'started' | 'activity' | 'approval_requested' | 'interrupted' | 'failed' | 'completed'
  | 'usage_updated' | 'error';

export interface RunnerEventBase {
  v: 1;
  eventId: string;
  seq: number;
  taskId: string;
  sessionId: string;
  runId: string;
  ts: number;
}

export type RunnerEvent = RunnerEventBase & (
  | { type: 'started'; payload: { resumed: boolean; model?: string; claudeVersion?: string; cwd: string } }
  | { type: 'activity'; payload: { kind: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'status' | 'api_retry'; toolName?: string; toolUseId?: string; summary?: string } }
  | { type: 'approval_requested'; payload: { approvalRequestId: string; toolUseId?: string; toolName: string; actionKey: string; classification: ActionClass; summary: string; expiresAt: number } }
  | { type: 'interrupted'; payload: { requestedBy: 'user' | 'system'; forced: boolean; reason?: string } }
  | { type: 'failed'; payload: { code: ErrorCode; retryable: boolean; attempt: number; message: string } }
  | { type: 'completed'; payload: { resultSubtype: 'success'; durationMs: number } }
  | { type: 'usage_updated'; payload: { source: 'official' | 'estimate'; windows?: unknown; costUsdEstimate?: number } }
  | { type: 'error'; payload: { code: ErrorCode; fatal: boolean; detail: string } }
);

// ── Visão para a UI ────────────────────────────────────────────────────────

export interface PendingApprovalView {
  approvalRequestId: string;
  taskId: string;
  runId: string;
  toolName: string;
  classification: ActionClass;
  summary: string;
  expiresAt: number;
}

export interface UnconfirmedEffectView {
  id: string;
  taskId: string;
  toolName: string;
  actionKey: string;
  summary: string;
  verifiable: boolean;
  suggestion: 'applied' | 'not_applied' | 'unknown';
  status: string;
}

export interface TaskView extends TaskRow {
  pendingApprovals: PendingApprovalView[];
  unconfirmedEffects: UnconfirmedEffectView[];
  resumable: boolean;
}

export function isTerminal(s: TaskState): boolean {
  return s === 'completed' || s === 'failed' || s === 'cancelled';
}
