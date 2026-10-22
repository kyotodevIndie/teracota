export const STATES = ['queued', 'running', 'awaiting_approval', 'paused', 'interrupted', 'review', 'completed', 'failed', 'cancelled',
  'needs_reconcile', 'session_expired', 'auth_error', 'usage_limited'];

export const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

// from -> allowed targets. "null" = task does not exist yet.
export const TRANSITIONS = {
  null: ['queued'],
  queued: ['running', 'cancelled'],
  running: ['awaiting_approval', 'paused', 'interrupted', 'review', 'completed', 'failed', 'cancelled',
    'needs_reconcile', 'session_expired', 'auth_error', 'usage_limited'],
  awaiting_approval: ['running', 'cancelled', 'interrupted', 'failed', 'needs_reconcile'],
  paused: ['running', 'cancelled'],
  interrupted: ['running', 'cancelled'],                 // resume is always explicit
  review: ['completed', 'running', 'cancelled'],
  needs_reconcile: ['running', 'completed', 'failed', 'cancelled'], // only by user decision
  session_expired: ['running', 'failed', 'cancelled'],
  auth_error: ['running', 'cancelled'],                  // after re-login, explicit
  usage_limited: ['running', 'cancelled'],
  completed: [], failed: [], cancelled: [],
};

/** States from which the user can explicitly resume (new run, new lock). */
export const RESUMABLE = new Set(['needs_reconcile', 'interrupted', 'paused', 'usage_limited', 'auth_error', 'session_expired']);

export class InvalidTransitionError extends Error {
  constructor(from, to) { super(`invalid transition ${from} -> ${to}`); this.name = 'InvalidTransitionError'; this.from = from; this.to = to; }
}

export function canTransition(from, to) {
  return (TRANSITIONS[String(from)] ?? []).includes(to);
}
