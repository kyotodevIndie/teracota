import { afterEach, describe, expect, it } from 'vitest';
import { PocketStore } from './store';
import { InvalidTransitionError } from './states';
import { clock, driveTo, newTask, step } from '../testing/helpers';

const stores: PocketStore[] = [];
afterEach(() => { while (stores.length) stores.pop()?.close(); });
function mem(now = clock()): PocketStore {
  const s = PocketStore.open(':memory:', { now });
  stores.push(s);
  return s;
}

describe('endurecimento pós-revisão arquitetural', () => {
  function runSetup(c = clock()) {
    const s = mem(c);
    const t = driveTo(s, 'running');
    const sess = s.reserveSession(t.id);
    const run = s.beginRun({ taskId: t.id, sessionId: sess.id, kind: 'start' });
    return { s, c, t, sess, run };
  }

  it('UPDATE direto de tasks.state sem a transição no journal é barrado pelo banco', () => {
    const s = mem();
    const t = driveTo(s, 'interrupted');
    expect(() => s.db.prepare(`UPDATE tasks SET state = 'review' WHERE id = ?`).run(t.id)).toThrow(/JOURNAL_MISMATCH/);
  });

  it('gesto forjado direto no banco não satisfaz o trigger do journal enquanto não consumido', () => {
    const s = mem();
    const t = driveTo(s, 'interrupted');
    s.db.prepare(`INSERT INTO gestures(id, kind, task_id, issued_at, expires_at) VALUES ('g_forjado','task_action',?,1,9)`).run(t.id);
    expect(() => s.db.prepare(`INSERT INTO journal(ts, task_id, kind, from_state, to_state, actor, gesture_id) VALUES (1, ?, 'transition', 'interrupted', 'running', 'user', 'g_forjado')`).run(t.id)).toThrow(/GESTURE_REQUIRED/);
  });

  it('gesto: tipo e propósito amarrados; gesto sem tarefa só existe para create_task', () => {
    const s = mem();
    const t = driveTo(s, 'interrupted');
    expect(() => s.issueGesture('task_action', null)).toThrow(/CHECK/);
    expect(() => s.transition(t.id, 'running', { actor: 'user', reason: 'x', gestureId: s.issueGesture('task_action', t.id, 'to:cancelled') })).toThrow(/propósito/);
    expect(s.transition(t.id, 'running', { actor: 'user', reason: 'x', gestureId: s.issueGesture('task_action', t.id, 'to:running') }).state).toBe('running');
  });

  it('tx aninhado usa savepoint: erro engolido não deixa estado parcial; async é recusado', () => {
    const s = mem();
    const t = driveTo(s, 'interrupted');
    const g = s.issueGesture('task_action', t.id);
    s.tx(() => {
      try { s.transition(t.id, 'completed', { actor: 'user', reason: 'x', gestureId: g }); } catch { /* engolido */ }
      s.note(t.id, 'depois');
    });
    // o gesto não foi consumido pela transição que falhou
    expect(s.transition(t.id, 'running', { actor: 'user', reason: 'x', gestureId: g }).state).toBe('running');
    expect(() => s.tx((async () => 1) as unknown as () => number)).toThrow(/assíncronas/);
  });

  it('aprovação composta: um gesto decide e devolve a tarefa a running', () => {
    const { s, t, sess, run, c } = runSetup();
    step(s, t.id, 'awaiting_approval');
    s.createApprovalRequest({ approvalRequestId: 'ar', taskId: 'x', sessionId: 'y', runId: run.id, toolName: 'Bash', actionKey: 'k', classification: 'destructive', summary: 'rm', expiresAt: c() + 1000 });
    expect(s.getApproval('ar')?.taskId).toBe(t.id); // derivado do run
    expect(s.getApproval('ar')?.sessionId).toBe(sess.id);
    const g = s.issueGesture('approval', t.id, 'approval:ar');
    s.decideApproval('ar', { decision: 'allow', actor: 'user', gestureId: g, hmac: 'h', resumeTask: true });
    expect(s.mustTask(t.id).state).toBe('running');
    expect(s.consumeApproval('ar').consumedAt).not.toBeNull();
  });

  it('aprovação de outro boot do core ou de run encerrado não é consumível', () => {
    const { s, t, run, c } = runSetup();
    s.createApprovalRequest({ approvalRequestId: 'a1', taskId: t.id, sessionId: 's', runId: run.id, toolName: 'Bash', actionKey: 'k1', classification: 'destructive', summary: 'x', expiresAt: c() + 9999 });
    s.decideApproval('a1', { decision: 'allow', actor: 'user', gestureId: s.issueGesture('approval', t.id), hmac: 'h' });
    s.endRun(run.id, 'completed');
    expect(() => s.consumeApproval('a1')).toThrow(/run_mismatch/);
    const t2 = driveTo(s, 'running');
    const s2 = s.reserveSession(t2.id);
    const r2 = s.beginRun({ taskId: t2.id, sessionId: s2.id, kind: 'start' });
    s.createApprovalRequest({ approvalRequestId: 'a2', taskId: t2.id, sessionId: s2.id, runId: r2.id, toolName: 'Bash', actionKey: 'k2', classification: 'destructive', summary: 'x', expiresAt: c() + 9999 });
    s.decideApproval('a2', { decision: 'allow', actor: 'user', gestureId: s.issueGesture('approval', t2.id), hmac: 'h' });
    s.db.prepare('UPDATE approvals SET decided_fence = decided_fence + 7').run(); // simula decisão de outro boot
    expect(() => s.consumeApproval('a2')).toThrow(/outra instância/);
  });

  it('dois pedidos do mesmo run: decidir o 1º não devolve a running; só o último', () => {
    const { s, t, run, c } = runSetup();
    step(s, t.id, 'awaiting_approval');
    for (const id of ['p1', 'p2']) {
      s.createApprovalRequest({ approvalRequestId: id, taskId: t.id, sessionId: 'x', runId: run.id, toolName: 'Bash', actionKey: `k-${id}`, classification: 'destructive', summary: 'x', expiresAt: c() + 9999 });
    }
    s.decideApproval('p1', { decision: 'allow', actor: 'user', gestureId: s.issueGesture('approval', t.id, 'approval:p1'), hmac: 'h', resumeTask: true });
    expect(s.mustTask(t.id).state).toBe('awaiting_approval');
    s.decideApproval('p2', { decision: 'deny', actor: 'user', gestureId: s.issueGesture('approval', t.id, 'approval:p2'), hmac: 'h', resumeTask: true });
    expect(s.mustTask(t.id).state).toBe('running');
  });

  it('awaiting_approval→cancelled também exige saída limpa', () => {
    const s = mem();
    const t = driveTo(s, 'awaiting_approval');
    expect(() => s.transition(t.id, 'cancelled', { actor: 'user', reason: 'x', gestureId: s.issueGesture('task_action', t.id) })).toThrow(/saída limpa/);
    expect(step(s, t.id, 'cancelled').state).toBe('cancelled');
  });

  it('beginRun recusa sessão expirada, de outra tarefa, ou tarefa que não está running', () => {
    const s = mem();
    const t = driveTo(s, 'running');
    const sess = s.reserveSession(t.id);
    s.setSessionState(sess.id, 'active', 'x');
    s.setSessionState(sess.id, 'expired', 'x');
    expect(() => s.beginRun({ taskId: t.id, sessionId: sess.id, kind: 'resume' })).toThrow(InvalidTransitionError);
    const other = driveTo(s, 'running');
    const os = s.reserveSession(other.id);
    expect(() => s.beginRun({ taskId: t.id, sessionId: os.id, kind: 'start' })).toThrow(InvalidTransitionError);
    const q = newTask(s);
    const qs = s.reserveSession(q.id);
    expect(() => s.beginRun({ taskId: q.id, sessionId: qs.id, kind: 'start' })).toThrow(/running/);
  });

  it('segredos conhecidos são redigidos antes do journal; evento em run encerrado é recusado', () => {
    const { s, run } = runSetup();
    const e = s.appendEvent(run.id, 'activity', { kind: 'tool_use', summary: 'curl -H "Authorization: Bearer abcdef123456789" --token=zzzzzzzz sk-ant-api03-ABCDEFGHIJ' });
    expect(JSON.stringify(e.payload)).not.toMatch(/abcdef123456789|zzzzzzzz|ABCDEFGHIJ/);
    s.endRun(run.id, 'completed');
    expect(() => s.appendEvent(run.id, 'activity', { kind: 'status' })).toThrow();
  });

  it('efeitos: fluxo de status restrito, ids derivados do run, resolução exige gesto', () => {
    const { s, run, sess, t } = runSetup();
    const e = s.recordIntent({ taskId: 'x', sessionId: 'y', runId: run.id, toolUseId: 'u', toolName: 'Write', actionKey: 'k', classification: 'workspace_write', summary: 's', verifiable: false });
    expect(e.taskId).toBe(t.id);
    expect(e.sessionId).toBe(sess.id);
    expect(() => s.db.prepare(`UPDATE effects SET status = 'user_applied' WHERE id = ?`).run(e.id)).toThrow(/EFFECT_(FINAL|NEEDS_GESTURE)/);
    s.markUnconfirmed(t.id);
    expect(() => s.db.prepare(`UPDATE effects SET status = 'user_applied' WHERE id = ?`).run(e.id)).toThrow(/NEEDS_GESTURE/);
    expect(s.journalSince(0, t.id).some((j) => j.kind === 'effect' && j.reason === 'unconfirmed')).toBe(true);
  });
});
