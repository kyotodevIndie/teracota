// Máquinas de estado da tarefa e da sessão (contrato §2). Tabela única, usada pelo
// código e para popular `allowed_transitions` (que o trigger do SQLite consulta).
import type { Actor, SessionState, TaskState } from '../../../shared/pocket';

type Rule = readonly Actor[];
const U: Rule = ['user'];
const S: Rule = ['system'];
const P: Rule = ['policy', 'user'];
const SU: Rule = ['system', 'user'];

/** de → para → quem pode disparar. `running` só por gesto, exceto queued→running (política). */
export const TASK_TRANSITIONS: Record<TaskState, Partial<Record<TaskState, Rule>>> = {
  queued: { running: P, cancelled: U, needs_reconcile: S },
  running: {
    awaiting_approval: S, paused: S, interrupted: S, review: S, failed: S,
    cancelled: S, needs_reconcile: S, session_expired: S, auth_error: S, usage_limited: S,
  },
  // expiração de aprovação: o sistema nega com interrupt (nunca volta a running sem gesto)
  awaiting_approval: { running: U, interrupted: SU, cancelled: U, needs_reconcile: S },
  paused: { running: U, cancelled: U },
  interrupted: { running: U, review: U, cancelled: U },
  review: { completed: U, running: U, cancelled: U },
  needs_reconcile: { running: U, review: U, failed: U, cancelled: U },
  session_expired: { running: U, failed: U, cancelled: U },
  auth_error: { running: U, cancelled: U },
  usage_limited: { running: U, cancelled: U },
  completed: {}, failed: {}, cancelled: {},
};

export const SESSION_TRANSITIONS: Record<SessionState, readonly SessionState[]> = {
  reserved: ['active', 'archived'],
  active: ['idle', 'orphaned', 'expired', 'archived'],
  idle: ['active', 'expired', 'archived'],
  orphaned: ['idle', 'archived'],
  expired: ['archived'],
  archived: [],
};

/** Estados dos quais o usuário pode retomar (contrato §1.3 resume), além de `review` (pedido de ajuste). */
export const RESUMABLE_STATES: readonly TaskState[] = [
  'interrupted', 'paused', 'needs_reconcile', 'usage_limited', 'auth_error', 'session_expired', 'review',
];

/** Estados em que há (ou deveria haver) um runner vivo neste processo. */
export const ACTIVE_STATES: readonly TaskState[] = ['running', 'awaiting_approval'];

export class InvalidTransitionError extends Error {
  readonly code = 'INVALID_TRANSITION' as const;
  constructor(readonly from: string | null, readonly to: string, detail?: string) {
    super(`transição inválida ${from ?? '(nova)'} → ${to}${detail ? `: ${detail}` : ''}`);
    this.name = 'InvalidTransitionError';
  }
}

export function allowedActors(from: TaskState, to: TaskState): Rule | undefined {
  return TASK_TRANSITIONS[from]?.[to];
}

export function canSessionTransition(from: SessionState, to: SessionState): boolean {
  return SESSION_TRANSITIONS[from].includes(to);
}
