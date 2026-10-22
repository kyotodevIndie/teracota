// Migrações do banco da Pocket. Cada migração é imutável depois de publicada: o checksum
// fica em `schema_migrations` e uma divergência impede a abertura. Mudança = nova versão.
// A tabela allowed_transitions é um *literal congelado* (não importa states.ts); o teste
// `schema.test.ts` falha se states.ts divergir do banco, forçando uma nova migração.

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const TASK_STATES_SQL = `'queued','running','awaiting_approval','paused','interrupted','needs_reconcile','review','completed','failed','cancelled','session_expired','auth_error','usage_limited'`;

// from → [to:atores]
const V1_TASK_TRANSITIONS: Record<string, Record<string, string>> = {
  queued: { running: 'policy,user', cancelled: 'user', needs_reconcile: 'system' },
  running: {
    awaiting_approval: 'system', paused: 'system', interrupted: 'system', review: 'system',
    failed: 'system', cancelled: 'system', needs_reconcile: 'system', session_expired: 'system',
    auth_error: 'system', usage_limited: 'system',
  },
  awaiting_approval: { running: 'user', interrupted: 'system,user', cancelled: 'user', needs_reconcile: 'system' },
  paused: { running: 'user', cancelled: 'user' },
  interrupted: { running: 'user', review: 'user', cancelled: 'user' },
  review: { completed: 'user', running: 'user', cancelled: 'user' },
  needs_reconcile: { running: 'user', review: 'user', failed: 'user', cancelled: 'user' },
  session_expired: { running: 'user', failed: 'user', cancelled: 'user' },
  auth_error: { running: 'user', cancelled: 'user' },
  usage_limited: { running: 'user', cancelled: 'user' },
};

const V1_SESSION_TRANSITIONS: Record<string, string[]> = {
  reserved: ['active', 'archived'],
  active: ['idle', 'orphaned', 'expired', 'archived'],
  idle: ['active', 'expired', 'archived'],
  orphaned: ['idle', 'archived'],
  expired: ['archived'],
};

function transitionInserts(): string {
  const rows: string[] = [];
  for (const [from, tos] of Object.entries(V1_TASK_TRANSITIONS)) {
    for (const [to, actors] of Object.entries(tos)) rows.push(`('${from}','${to}','${actors}')`);
  }
  const srows: string[] = [];
  for (const [from, tos] of Object.entries(V1_SESSION_TRANSITIONS)) {
    for (const to of tos) srows.push(`('${from}','${to}')`);
  }
  return `
INSERT INTO allowed_transitions(from_state,to_state,actors) VALUES ${rows.join(',')};
INSERT INTO allowed_session_transitions(from_state,to_state) VALUES ${srows.join(',')};`;
}

const V1 = `
CREATE TABLE core_owner (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fence INTEGER NOT NULL,
  owner_pid INTEGER,
  owner_token TEXT,
  acquired_at INTEGER NOT NULL
);
INSERT INTO core_owner(id, fence, acquired_at) VALUES (1, 0, 0);

CREATE TABLE allowed_transitions (
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  actors TEXT NOT NULL,
  PRIMARY KEY (from_state, to_state)
) WITHOUT ROWID;
CREATE TABLE allowed_session_transitions (
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  PRIMARY KEY (from_state, to_state)
) WITHOUT ROWID;
${transitionInserts()}

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  cwd TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (${TASK_STATES_SQL})),
  current_session_id TEXT,
  interrupt_requested INTEGER NOT NULL DEFAULT 0 CHECK (interrupt_requested IN (0,1)),
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0,1)),
  pause_requested INTEGER NOT NULL DEFAULT 0 CHECK (pause_requested IN (0,1)),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  last_error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX tasks_state ON tasks(state);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  generation INTEGER NOT NULL CHECK (generation >= 1),
  state TEXT NOT NULL CHECK (state IN ('reserved','active','idle','orphaned','expired','archived')),
  external_activity INTEGER NOT NULL DEFAULT 0 CHECK (external_activity IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (task_id, generation)
);
-- no máximo uma sessão não arquivada/expirada por tarefa
CREATE UNIQUE INDEX sessions_one_live_per_task ON sessions(task_id)
  WHERE state IN ('reserved','active','idle','orphaned');

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  kind TEXT NOT NULL CHECK (kind IN ('start','resume')),
  gesture_id TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  fence INTEGER NOT NULL,
  runner_pid INTEGER,
  runner_start_time TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  outcome TEXT
);
CREATE INDEX runs_task ON runs(task_id);

CREATE TABLE journal (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  task_id TEXT,
  run_id TEXT,
  run_seq INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('transition','event','approval','effect','note')),
  from_state TEXT,
  to_state TEXT,
  reason TEXT,
  actor TEXT CHECK (actor IN ('user','system','policy')),
  gesture_id TEXT,
  payload TEXT
);
CREATE UNIQUE INDEX journal_run_seq ON journal(run_id, run_seq) WHERE run_seq IS NOT NULL;
CREATE INDEX journal_task ON journal(task_id, seq);

CREATE TABLE gestures (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  task_id TEXT,
  purpose TEXT,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  consumed_for TEXT,
  CHECK ((kind = 'create_task' AND task_id IS NULL) OR (kind <> 'create_task' AND task_id IS NOT NULL))
);

CREATE TABLE approvals (
  approval_request_id TEXT PRIMARY KEY,
  approval_id TEXT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  tool_use_id TEXT,
  tool_name TEXT NOT NULL,
  action_key TEXT NOT NULL,
  classification TEXT NOT NULL,
  summary_shown TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  decision TEXT CHECK (decision IN ('allow','deny')),
  actor TEXT CHECK (actor IN ('user','system')),
  gesture_id TEXT,
  decided_at INTEGER,
  consumed_at INTEGER,
  decided_fence INTEGER,
  hmac TEXT
);
CREATE INDEX approvals_task ON approvals(task_id, requested_at);

CREATE TABLE effects (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  tool_use_id TEXT,
  tool_name TEXT NOT NULL,
  action_key TEXT NOT NULL,
  classification TEXT NOT NULL,
  summary TEXT NOT NULL,
  target_path TEXT,
  expected_hash TEXT,
  verifiable INTEGER NOT NULL DEFAULT 0 CHECK (verifiable IN (0,1)),
  status TEXT NOT NULL CHECK (status IN ('intent','confirmed','denied','unconfirmed','user_applied','user_not_applied','user_unknown')),
  intent_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  resolved_at INTEGER,
  resolved_gesture_id TEXT
);
CREATE INDEX effects_task ON effects(task_id, status);
CREATE INDEX effects_action ON effects(task_id, action_key);

CREATE TABLE processes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT,
  pid INTEGER NOT NULL,
  start_time TEXT,
  role TEXT NOT NULL,
  spawned_at INTEGER NOT NULL,
  ended_at INTEGER,
  end_reason TEXT
);
CREATE INDEX processes_live ON processes(ended_at) WHERE ended_at IS NULL;

-- ── invariantes protegidos no banco ───────────────────────────────────────
CREATE TRIGGER journal_no_update BEFORE UPDATE ON journal
BEGIN SELECT RAISE(ABORT, 'JOURNAL_APPEND_ONLY'); END;
CREATE TRIGGER journal_no_delete BEFORE DELETE ON journal
BEGIN SELECT RAISE(ABORT, 'JOURNAL_APPEND_ONLY'); END;
-- todo →running que não seja queued→running exige ator 'user' e gesto
CREATE TRIGGER journal_gesture_guard BEFORE INSERT ON journal
WHEN NEW.kind = 'transition' AND NEW.to_state = 'running' AND NEW.from_state IS NOT 'queued'
 AND (NEW.actor IS NOT 'user' OR NOT EXISTS (
  SELECT 1 FROM gestures WHERE id = NEW.gesture_id AND consumed_at IS NOT NULL AND task_id = NEW.task_id))
BEGIN SELECT RAISE(ABORT, 'GESTURE_REQUIRED'); END;
CREATE TRIGGER journal_transition_actor BEFORE INSERT ON journal
WHEN NEW.kind = 'transition' AND (NEW.actor IS NULL OR NEW.to_state IS NULL OR NEW.task_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'TRANSITION_INCOMPLETE'); END;

CREATE TRIGGER tasks_insert_queued BEFORE INSERT ON tasks
WHEN NEW.state <> 'queued'
BEGIN SELECT RAISE(ABORT, 'INVALID_TRANSITION'); END;
CREATE TRIGGER tasks_state_guard BEFORE UPDATE OF state ON tasks
WHEN NEW.state <> OLD.state AND NOT EXISTS (
  SELECT 1 FROM allowed_transitions WHERE from_state = OLD.state AND to_state = NEW.state)
BEGIN SELECT RAISE(ABORT, 'INVALID_TRANSITION'); END;
-- a projeção só muda se o journal já registrou exatamente esta transição
CREATE TRIGGER tasks_state_matches_journal BEFORE UPDATE OF state ON tasks
WHEN NEW.state <> OLD.state AND NOT EXISTS (
  SELECT 1 FROM journal j WHERE j.seq = (SELECT MAX(seq) FROM journal WHERE task_id = OLD.id AND kind = 'transition')
    AND j.from_state = OLD.state AND j.to_state = NEW.state)
BEGIN SELECT RAISE(ABORT, 'JOURNAL_MISMATCH'); END;
CREATE TRIGGER tasks_immutable BEFORE UPDATE ON tasks
WHEN NEW.id <> OLD.id OR NEW.cwd <> OLD.cwd OR NEW.created_at <> OLD.created_at
BEGIN SELECT RAISE(ABORT, 'TASK_IMMUTABLE_FIELD'); END;
CREATE TRIGGER tasks_no_delete BEFORE DELETE ON tasks
BEGIN SELECT RAISE(ABORT, 'NO_DELETE'); END;

CREATE TRIGGER sessions_state_guard BEFORE UPDATE OF state ON sessions
WHEN NEW.state <> OLD.state AND NOT EXISTS (
  SELECT 1 FROM allowed_session_transitions WHERE from_state = OLD.state AND to_state = NEW.state)
BEGIN SELECT RAISE(ABORT, 'INVALID_SESSION_TRANSITION'); END;
CREATE TRIGGER sessions_no_delete BEFORE DELETE ON sessions
BEGIN SELECT RAISE(ABORT, 'NO_DELETE'); END;

CREATE TRIGGER gestures_consume_once BEFORE UPDATE ON gestures
WHEN OLD.consumed_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'GESTURE_ALREADY_CONSUMED'); END;
CREATE TRIGGER gestures_no_delete BEFORE DELETE ON gestures
BEGIN SELECT RAISE(ABORT, 'NO_DELETE'); END;

CREATE TRIGGER approvals_decision_once BEFORE UPDATE ON approvals
WHEN OLD.decision IS NOT NULL AND (NEW.decision IS NOT OLD.decision OR NEW.hmac IS NOT OLD.hmac
  OR NEW.decided_at IS NOT OLD.decided_at OR NEW.gesture_id IS NOT OLD.gesture_id
  OR NEW.actor IS NOT OLD.actor)
BEGIN SELECT RAISE(ABORT, 'APPROVAL_DECISION_IMMUTABLE'); END;
CREATE TRIGGER approvals_consume_once BEFORE UPDATE ON approvals
WHEN OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS NOT OLD.consumed_at
BEGIN SELECT RAISE(ABORT, 'APPROVAL_ALREADY_CONSUMED'); END;
CREATE TRIGGER approvals_consume_needs_allow BEFORE UPDATE ON approvals
WHEN NEW.consumed_at IS NOT NULL AND (NEW.decision IS NOT 'allow' OR NEW.hmac IS NULL)
BEGIN SELECT RAISE(ABORT, 'APPROVAL_NOT_ALLOWED'); END;
CREATE TRIGGER approvals_allow_by_user BEFORE UPDATE ON approvals
WHEN NEW.decision = 'allow' AND (NEW.actor IS NOT 'user' OR NEW.gesture_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'APPROVAL_ALLOW_NEEDS_USER'); END;
CREATE TRIGGER approvals_key_immutable BEFORE UPDATE ON approvals
WHEN NEW.action_key <> OLD.action_key OR NEW.run_id <> OLD.run_id OR NEW.task_id <> OLD.task_id
  OR NEW.expires_at <> OLD.expires_at OR NEW.tool_use_id IS NOT OLD.tool_use_id OR NEW.classification <> OLD.classification
  OR NEW.tool_name <> OLD.tool_name OR NEW.summary_shown <> OLD.summary_shown OR NEW.requested_at <> OLD.requested_at
  OR NEW.session_id <> OLD.session_id
BEGIN SELECT RAISE(ABORT, 'APPROVAL_FIELD_IMMUTABLE'); END;
CREATE TRIGGER approvals_no_delete BEFORE DELETE ON approvals
BEGIN SELECT RAISE(ABORT, 'NO_DELETE'); END;

CREATE TRIGGER effects_status_forward BEFORE UPDATE OF status ON effects
WHEN NEW.status <> OLD.status AND NOT (
  (OLD.status = 'intent' AND NEW.status IN ('confirmed','denied','unconfirmed'))
  OR (OLD.status = 'unconfirmed' AND NEW.status IN ('user_applied','user_not_applied','user_unknown')))
BEGIN SELECT RAISE(ABORT, 'EFFECT_FINAL'); END;
CREATE TRIGGER effects_user_needs_gesture BEFORE UPDATE OF status ON effects
WHEN NEW.status LIKE 'user_%' AND NEW.resolved_gesture_id IS NULL
BEGIN SELECT RAISE(ABORT, 'EFFECT_NEEDS_GESTURE'); END;
CREATE TRIGGER effects_key_immutable BEFORE UPDATE ON effects
WHEN NEW.action_key <> OLD.action_key OR NEW.task_id <> OLD.task_id OR NEW.run_id <> OLD.run_id
  OR NEW.intent_at <> OLD.intent_at
BEGIN SELECT RAISE(ABORT, 'EFFECT_FIELD_IMMUTABLE'); END;
CREATE TRIGGER effects_no_delete BEFORE DELETE ON effects
BEGIN SELECT RAISE(ABORT, 'NO_DELETE'); END;
`;

export const MIGRATIONS: readonly Migration[] = [{ version: 1, name: 'core-inicial', sql: V1 }];
