import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { checksum, MigrationError, openDatabase } from './db';
import { MIGRATIONS } from './schema';
import { ApprovalError, FencedOutError, GestureError, PocketStore, sanitizePayload } from './store';
import { InvalidTransitionError, SESSION_TRANSITIONS, TASK_TRANSITIONS } from './states';
import { ALL_STATES, clock, driveTo, newTask, step, tmpDir } from '../testing/helpers';
import { SESSION_STATES } from '../../../shared/pocket';

const cleanups: (() => void)[] = [];
const stores: PocketStore[] = [];
afterEach(() => {
  while (stores.length) stores.pop()?.close();
  while (cleanups.length) cleanups.pop()?.();
});
function mem(now = clock()): PocketStore {
  const s = PocketStore.open(':memory:', { now });
  stores.push(s);
  return s;
}
function file(name = 'p.db', now = clock()): { s: PocketStore; path: string; dir: string } {
  const t = tmpDir();
  cleanups.push(t.cleanup);
  const p = path.join(t.dir, name);
  const s = PocketStore.open(p, { now });
  stores.push(s);
  return { s, path: p, dir: t.dir };
}

describe('migrações', () => {
  it('abre com WAL e synchronous=FULL, user_version = última migração', () => {
    const { s } = file();
    expect((s.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe('wal');
    expect((s.db.prepare('PRAGMA synchronous').get() as { synchronous: number }).synchronous).toBe(2);
    expect((s.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(MIGRATIONS.at(-1)?.version);
    expect((s.db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
  });

  it('reabrir é idempotente e não cria backup', () => {
    const { s, path: p, dir } = file();
    s.close(); stores.length = 0;
    const s2 = PocketStore.open(p); stores.push(s2);
    expect(readdirSync(dir).filter((f) => f.includes('.bak-'))).toEqual([]);
  });

  it('recusa banco mais novo que o app', () => {
    const { s, path: p } = file();
    s.db.exec('PRAGMA user_version = 99');
    s.close(); stores.length = 0;
    expect(() => openDatabase(p)).toThrow(MigrationError);
  });

  it('recusa migração alterada depois de aplicada', () => {
    const { s, path: p } = file();
    s.close(); stores.length = 0;
    const tampered = [{ ...MIGRATIONS[0]!, sql: `${MIGRATIONS[0]!.sql}\n-- alterado` }];
    expect(() => openDatabase(p, { migrations: tampered })).toThrow(/alterada/);
  });

  it('migração nova faz backup, aplica e faz rollback se falhar', () => {
    const { s, path: p, dir } = file();
    s.close(); stores.length = 0;
    const v2 = { version: 2, name: 'extra', sql: 'CREATE TABLE extra(x INTEGER);' };
    const db = openDatabase(p, { migrations: [...MIGRATIONS, v2], now: () => 42 });
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2);
    expect(existsSync(path.join(dir, 'p.db.bak-v1-42'))).toBe(true);
    db.close();

    const bad = { version: 3, name: 'quebra', sql: 'CREATE TABLE ok3(x INTEGER); INSERT INTO nao_existe VALUES (1);' };
    expect(() => openDatabase(p, { migrations: [...MIGRATIONS, v2, bad] })).toThrow(/falhou/);
    const db2 = new DatabaseSync(p);
    expect((db2.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2);
    expect(db2.prepare("SELECT name FROM sqlite_master WHERE name = 'ok3'").get()).toBeUndefined();
    db2.close();
  });

  it('o schema reflete a tabela de transições do código (drift exige nova migração)', () => {
    const { db } = mem();
    const rows = db.prepare('SELECT from_state, to_state, actors FROM allowed_transitions').all() as { from_state: string; to_state: string; actors: string }[];
    const fromDb = new Map(rows.map((r) => [`${r.from_state}>${r.to_state}`, r.actors]));
    const fromCode = new Map<string, string>();
    for (const [f, tos] of Object.entries(TASK_TRANSITIONS)) for (const [t, a] of Object.entries(tos)) fromCode.set(`${f}>${t}`, (a as readonly string[]).join(','));
    expect(fromDb).toEqual(fromCode);
    const sr = db.prepare('SELECT from_state, to_state FROM allowed_session_transitions').all() as { from_state: string; to_state: string }[];
    const sessCode = Object.entries(SESSION_TRANSITIONS).flatMap(([f, ts]) => ts.map((t) => `${f}>${t}`)).sort();
    expect(sr.map((r) => `${r.from_state}>${r.to_state}`).sort()).toEqual(sessCode);
    expect(checksum(MIGRATIONS[0]!)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('máquina de estados da tarefa', () => {
  it('todas as combinações estado × estado batem com a tabela (ator correto)', () => {
    const s = mem();
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        const t = driveTo(s, from);
        const rule = TASK_TRANSITIONS[from][to];
        if (rule) {
          expect(() => step(s, t.id, to), `${from}→${to}`).not.toThrow();
          expect(s.mustTask(t.id).state).toBe(to);
        } else {
          expect(() => step(s, t.id, to, { actor: 'user' }), `${from}→${to}`).toThrow(InvalidTransitionError);
          expect(s.mustTask(t.id).state).toBe(from);
        }
      }
    }
  });

  it('proibidas: sair de terminal, interrupted→failed, running→queued, awaiting_approval→review/completed', () => {
    const s = mem();
    for (const term of ['completed', 'failed', 'cancelled'] as const) {
      const t = driveTo(s, term);
      for (const to of ALL_STATES) expect(() => step(s, t.id, to, { actor: 'user' })).toThrow(InvalidTransitionError);
    }
    const i = driveTo(s, 'interrupted');
    expect(() => step(s, i.id, 'failed', { actor: 'user' })).toThrow(InvalidTransitionError);
    const r = driveTo(s, 'running');
    expect(() => step(s, r.id, 'queued', { actor: 'user' })).toThrow(InvalidTransitionError);
    const a = driveTo(s, 'awaiting_approval');
    for (const to of ['review', 'completed'] as const) expect(() => step(s, a.id, to, { actor: 'user' })).toThrow(InvalidTransitionError);
  });

  it('→running sem gesto é recusado: sistema/política não retomam, e o banco também barra', () => {
    const s = mem();
    const t = driveTo(s, 'interrupted');
    expect(() => s.transition(t.id, 'running', { actor: 'system', reason: 'x' })).toThrow(InvalidTransitionError);
    expect(() => s.transition(t.id, 'running', { actor: 'policy', reason: 'x' })).toThrow(InvalidTransitionError);
    expect(() => s.transition(t.id, 'running', { actor: 'user', reason: 'x' })).toThrow(GestureError);
    // bypass direto no SQL (simula bug no código): os triggers recusam
    expect(() => s.db.prepare(`INSERT INTO journal(ts, task_id, kind, from_state, to_state, actor) VALUES (1, ?, 'transition', 'interrupted', 'running', 'system')`).run(t.id)).toThrow(/GESTURE_REQUIRED/);
    expect(() => s.db.prepare(`UPDATE tasks SET state = 'completed' WHERE id = ?`).run(t.id)).toThrow(/INVALID_TRANSITION|JOURNAL_MISMATCH/);
    expect(s.mustTask(t.id).state).toBe('interrupted');
  });

  it('ator errado em transição permitida é recusado', () => {
    const s = mem();
    const r = driveTo(s, 'review');
    expect(() => s.transition(r.id, 'completed', { actor: 'system', reason: 'x' })).toThrow(InvalidTransitionError);
    const run = driveTo(s, 'running');
    expect(() => step(s, run.id, 'review', { actor: 'user' })).toThrow(InvalidTransitionError);
    const t = newTask(s);
    expect(() => s.transition(t.id, 'running', { actor: 'user', reason: 'x', gestureId: s.issueGesture('create_task', null) })).toThrow(/mismatch/);
  });

  it('queued→running pela política é aceito (execução manual é o padrão do orquestrador)', () => {
    const s = mem();
    const t = newTask(s);
    expect(s.transition(t.id, 'running', { actor: 'policy', reason: 'scheduler' }).state).toBe('running');
  });

  it('running→cancelled exige saída limpa', () => {
    const s = mem();
    const t = driveTo(s, 'running');
    expect(() => s.transition(t.id, 'cancelled', { actor: 'system', reason: 'x' })).toThrow(/saída limpa/);
    expect(s.transition(t.id, 'cancelled', { actor: 'system', reason: 'x', evidence: { cleanExit: true } }).state).toBe('cancelled');
  });

  it('gesto: uso único, outra tarefa, expirado e inexistente', () => {
    const c = clock();
    const s = mem(c);
    const a = driveTo(s, 'interrupted');
    const b = driveTo(s, 'interrupted');
    const g = s.issueGesture('task_action', a.id);
    expect(() => s.transition(b.id, 'running', { actor: 'user', reason: 'x', gestureId: g })).toThrow(/mismatch/);
    s.transition(a.id, 'running', { actor: 'user', reason: 'x', gestureId: g });
    const a2 = driveTo(s, 'interrupted');
    expect(() => s.transition(a2.id, 'running', { actor: 'user', reason: 'x', gestureId: g })).toThrow(GestureError);
    const old = s.issueGesture('task_action', b.id, null, 1000);
    c.advance(1001);
    expect(() => s.transition(b.id, 'running', { actor: 'user', reason: 'x', gestureId: old })).toThrow(/expired/);
    expect(() => s.transition(b.id, 'running', { actor: 'user', reason: 'x', gestureId: 'g_nao_existe' })).toThrow(/unknown/);
    expect(s.mustTask(b.id).state).toBe('interrupted');
  });

  it('atomicidade: transição que falha não deixa journal nem estado parcial', () => {
    const s = mem();
    const t = driveTo(s, 'interrupted');
    const before = s.journalSince(0, t.id).length;
    expect(() => s.transition(t.id, 'running', { actor: 'user', reason: 'x', gestureId: 'g_invalido' })).toThrow();
    expect(s.journalSince(0, t.id).length).toBe(before);
    expect(s.mustTask(t.id).state).toBe('interrupted');
  });

  it('retomar zera as flags de interrupção/cancelamento', () => {
    const s = mem();
    const t = driveTo(s, 'running');
    s.setFlag(t.id, 'interrupt_requested', true);
    expect(s.mustTask(t.id).interruptRequested).toBe(true);
    step(s, t.id, 'interrupted');
    step(s, t.id, 'running');
    expect(s.mustTask(t.id).interruptRequested).toBe(false);
  });

  it('o estado da tarefa sempre bate com a última transição do journal', () => {
    const s = mem();
    const t = driveTo(s, 'review');
    const last = s.journalSince(0, t.id).filter((e) => e.kind === 'transition').at(-1);
    expect(last?.toState).toBe(s.mustTask(t.id).state);
  });
});

describe('sessões', () => {
  it('reserva, transições válidas e uma só sessão viva por tarefa', () => {
    const s = mem();
    const t = newTask(s);
    const a = s.reserveSession(t.id);
    expect(a.state).toBe('reserved');
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(() => s.reserveSession(t.id)).toThrow(/UNIQUE/);
    expect(() => s.setSessionState(a.id, 'expired', 'x')).toThrow(InvalidTransitionError);
    s.setSessionState(a.id, 'active', 'x');
    s.setSessionState(a.id, 'idle', 'x');
    s.setSessionState(a.id, 'expired', 'resume recusado');
    s.setSessionState(a.id, 'archived', 'substituída');
    const b = s.reserveSession(t.id);
    expect(b.generation).toBe(2);
    expect(s.mustTask(t.id).currentSessionId).toBe(b.id);
    for (const st of SESSION_STATES) {
      if (st === 'archived') expect(() => s.setSessionState(a.id, st, 'x')).not.toThrow(); // no-op
      else expect(() => s.setSessionState(a.id, st, 'x')).toThrow(InvalidTransitionError);
    }
  });
});

describe('journal e eventos', () => {
  it('é append-only no banco', () => {
    const s = mem();
    newTask(s);
    expect(() => s.db.exec(`UPDATE journal SET reason = 'x'`)).toThrow(/APPEND_ONLY/);
    expect(() => s.db.exec('DELETE FROM journal')).toThrow(/APPEND_ONLY/);
  });

  it('seq por runId é contíguo e payload grande/prompt é truncado', () => {
    const s = mem();
    const t = driveTo(s, 'running');
    const sess = s.reserveSession(t.id);
    const run = s.beginRun({ taskId: t.id, sessionId: sess.id, kind: 'start' });
    const e1 = s.appendEvent(run.id, 'activity', { kind: 'text', summary: 'x'.repeat(5000) });
    const e2 = s.appendEvent(run.id, 'activity', { kind: 'status' });
    expect([e1.seq, e2.seq]).toEqual([1, 2]);
    expect(e1.v).toBe(1);
    expect(e1.taskId).toBe(t.id);
    expect((e1.payload.summary as string).length).toBeLessThan(500);
    const huge = sanitizePayload({ a: Array.from({ length: 100 }, (_, i) => i) });
    expect((huge as { a: unknown[] }).a.length).toBe(20);
    const run2 = s.beginRun({ taskId: t.id, sessionId: sess.id, kind: 'resume' });
    expect(s.appendEvent(run2.id, 'activity', { kind: 'status' }).seq).toBe(1);
  });
});

describe('fence (exclusividade de escrita)', () => {
  it('um segundo store no mesmo arquivo derruba o primeiro; o primeiro nunca mais grava', () => {
    const { s: a, path: p } = file();
    const t = newTask(a);
    const b = PocketStore.open(p); stores.push(b);
    expect(b.fence).toBe(a.fence + 1);
    expect(() => step(a, t.id, 'running')).toThrow(FencedOutError);
    expect(() => a.issueGesture('create_task', null)).toThrow(FencedOutError);
    expect(a.fenceIsCurrent()).toBe(false);
    expect(step(b, t.id, 'running').state).toBe('running');
    expect(b.journalSince(0, t.id).length).toBeGreaterThan(1);
  });
});

describe('aprovações', () => {
  function setup(c = clock()) {
    const s = mem(c);
    const t = driveTo(s, 'running');
    const sess = s.reserveSession(t.id);
    const run = s.beginRun({ taskId: t.id, sessionId: sess.id, kind: 'start' });
    const req = (id = 'ar1', ttl = 600_000) => s.createApprovalRequest({
      approvalRequestId: id, taskId: t.id, sessionId: sess.id, runId: run.id, toolName: 'Bash', actionKey: `k-${id}`,
      classification: 'destructive', summary: 'rm x', expiresAt: c() + ttl,
    });
    return { s, c, t, run, req };
  }

  it('decisão única, consumo único, sem consumir deny', () => {
    const { s, t, req } = setup();
    req();
    const g = s.issueGesture('approval', t.id);
    s.decideApproval('ar1', { decision: 'allow', actor: 'user', gestureId: g, hmac: 'h' });
    expect(() => s.decideApproval('ar1', { decision: 'deny', actor: 'user', gestureId: s.issueGesture('approval', t.id), hmac: 'h2' })).toThrow(/already_decided/);
    expect(s.consumeApproval('ar1').consumedAt).not.toBeNull();
    expect(() => s.consumeApproval('ar1')).toThrow(/already_consumed/);
    req('ar2');
    s.decideApproval('ar2', { decision: 'deny', actor: 'user', gestureId: s.issueGesture('approval', t.id), hmac: 'h' });
    expect(() => s.consumeApproval('ar2')).toThrow(/not_allowed/);
  });

  it('aprovar sem gesto falha; banco impede alterar decisão e reutilizar', () => {
    const { s, t, req } = setup();
    req();
    expect(() => s.decideApproval('ar1', { decision: 'allow', actor: 'user', hmac: 'h' })).toThrow(GestureError);
    s.decideApproval('ar1', { decision: 'allow', actor: 'user', gestureId: s.issueGesture('approval', t.id), hmac: 'h' });
    expect(() => s.db.prepare(`UPDATE approvals SET decision = 'deny'`).run()).toThrow(/IMMUTABLE/);
    expect(() => s.db.prepare(`UPDATE approvals SET action_key = 'outro'`).run()).toThrow(/IMMUTABLE/);
    s.consumeApproval('ar1');
    expect(() => s.db.prepare(`UPDATE approvals SET consumed_at = NULL`).run()).toThrow(/CONSUMED/);
  });

  it('allow só pelo usuário; gesto de outro tipo não vale', () => {
    const { s, t, req } = setup();
    req();
    expect(() => s.decideApproval('ar1', { decision: 'allow', actor: 'system', hmac: 'h' })).toThrow(/not_allowed/);
    expect(() => s.decideApproval('ar1', { decision: 'allow', actor: 'user', gestureId: s.issueGesture('task_action', t.id), hmac: 'h' })).toThrow(GestureError);
    expect(s.decideApproval('ar1', { decision: 'deny', actor: 'system', hmac: 'h' }).decision).toBe('deny');
  });

  it('TTL: aprovação expira antes da decisão ou do consumo', () => {
    const { s, c, t, req } = setup();
    req('ar1', 1000);
    c.advance(1001);
    expect(() => s.decideApproval('ar1', { decision: 'allow', actor: 'user', gestureId: s.issueGesture('approval', t.id), hmac: 'h' })).toThrow(ApprovalError);
    req('ar2', 1000);
    s.decideApproval('ar2', { decision: 'allow', actor: 'user', gestureId: s.issueGesture('approval', t.id), hmac: 'h' });
    c.advance(1001);
    expect(() => s.consumeApproval('ar2')).toThrow(/expired/);
    expect(s.pendingApprovals().map((a) => a.approvalRequestId)).toEqual(['ar1']);
  });
});

describe('ledger de efeitos', () => {
  function setup() {
    const s = mem();
    const t = driveTo(s, 'running');
    const sess = s.reserveSession(t.id);
    const run = s.beginRun({ taskId: t.id, sessionId: sess.id, kind: 'start' });
    const intent = (toolUseId: string, actionKey: string) => s.recordIntent({
      taskId: t.id, sessionId: sess.id, runId: run.id, toolUseId, toolName: 'Write', actionKey,
      classification: 'workspace_write', summary: 'Write a.txt', targetPath: 'a.txt', expectedHash: 'abc', verifiable: true,
    });
    return { s, t, run, intent };
  }

  it('intent → confirmed; confirmado é final', () => {
    const { s, run, intent } = setup();
    const e = intent('tu1', 'k1');
    expect(s.confirmEffect(run.id, 'tu1')).toBe(true);
    expect(s.confirmEffect(run.id, 'tu1')).toBe(false);
    expect(s.mustEffect(e.id).status).toBe('confirmed');
    expect(() => s.db.prepare(`UPDATE effects SET status = 'unconfirmed' WHERE id = ?`).run(e.id)).toThrow(/FINAL/);
    expect(() => s.db.prepare('DELETE FROM effects').run()).toThrow(/NO_DELETE/);
  });

  it('crash: intenções abertas viram unconfirmed, bloqueiam o actionKey (R6) até o usuário resolver', () => {
    const { s, t, intent } = setup();
    const e1 = intent('tu1', 'k1');
    const e2 = intent('tu2', 'k2');
    expect(s.markUnconfirmed(t.id)).toBe(2);
    expect([...s.blockedActionKeys(t.id).entries()].sort()).toEqual([['k1', 'deny'], ['k2', 'deny']]);
    s.resolveEffect(e1.id, 'user_not_applied', s.issueGesture('effect_resolution', t.id));
    s.resolveEffect(e2.id, 'user_applied', s.issueGesture('effect_resolution', t.id));
    expect([...s.blockedActionKeys(t.id).entries()]).toEqual([['k2', 'reapprove']]);
    expect(() => s.resolveEffect(e1.id, 'user_applied', s.issueGesture('effect_resolution', t.id))).toThrow(InvalidTransitionError);
    expect(() => s.resolveEffect(e2.id, 'user_unknown', 'g_x')).toThrow();
  });
});
