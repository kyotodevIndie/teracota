import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PocketStore } from '../core/store';
import type { RunContext, SignedDecision, ToolDecision } from '../runner/types';
import { clock, driveTo, step, tmpDir } from '../testing/helpers';
import { ApprovalService, APPROVAL_TTL_MS } from './approvals';
import { createPermissionHooks } from './permission-hooks';

const t = tmpDir('pocket-hooks-');
let ws = '';
const stores: PocketStore[] = [];
beforeAll(() => { ws = path.join(t.dir, 'ws'); mkdirSync(path.join(ws, 'src'), { recursive: true }); writeFileSync(path.join(ws, 'src', 'a.ts'), 'x'); });
afterAll(() => t.cleanup());
afterEach(() => { while (stores.length) stores.pop()?.close(); });

function setup(over: { lockHeld?: () => boolean } = {}) {
  const c = clock();
  const store = PocketStore.open(':memory:', { now: c });
  stores.push(store);
  const task = driveTo(store, 'running', ws);
  const sess = store.reserveSession(task.id);
  const run = store.beginRun({ taskId: task.id, sessionId: sess.id, kind: 'start' });
  const approvals = new ApprovalService(store);
  let held = true;
  const hooks = createPermissionHooks({ store, approvals, lockHeld: over.lockHeld ?? (() => held) });
  const ctx: RunContext = { taskId: task.id, sessionId: sess.id, runId: run.id, cwd: ws, policy: { approvalTtlMs: APPROVAL_TTL_MS }, attempt: 1, resumed: false };
  const req = (toolName: string, input: Record<string, unknown>, toolUseId = 'tu1') => ({ toolName, input, toolUseId, signal: new AbortController().signal });
  /** pede aprovação e (opcionalmente) o usuário decide */
  async function ask(toolName: string, input: Record<string, unknown>, toolUseId = 'tu1') {
    step(store, task.id, 'awaiting_approval');
    const d = await hooks.decide(ctx, req(toolName, input, toolUseId));
    if (d.kind !== 'ask') throw new Error(`esperava ask, veio ${d.kind}`);
    return d;
  }
  const user = (id: string, decision: 'allow' | 'deny', svc = approvals): SignedDecision =>
    svc.decideByUser(id, decision, store.issueGesture('approval', task.id, `approval:${id}`));
  return { c, store, task, sess, run, approvals, hooks, ctx, req, ask, user, setHeld: (v: boolean) => { held = v; } };
}

describe('decide: política automática', () => {
  it('escrita dentro do workspace: allow + intenção no ledger; tool_result confirma', async () => {
    const s = setup();
    const d = await s.hooks.decide(s.ctx, s.req('Write', { file_path: 'src/n.ts', content: 'abc' }));
    expect(d).toEqual({ kind: 'allow' });
    const eff = s.store.effectsOf(s.task.id);
    expect(eff).toHaveLength(1);
    expect(eff[0]).toMatchObject({ status: 'intent', toolUseId: 'tu1', verifiable: true });
    s.hooks.toolResult(s.ctx, 'tu1');
    expect(s.store.effectsOf(s.task.id)[0]?.status).toBe('confirmed');
  });

  it('leitura no workspace e comando seguro: allow sem intenção', async () => {
    const s = setup();
    expect((await s.hooks.decide(s.ctx, s.req('Read', { file_path: 'src/a.ts' }))).kind).toBe('allow');
    expect((await s.hooks.decide(s.ctx, s.req('Bash', { command: 'git status' }))).kind).toBe('allow');
    expect(s.store.effectsOf(s.task.id)).toHaveLength(0);
  });

  it('credenciais: deny imediato, sem pedido de aprovação', async () => {
    const s = setup();
    const d = await s.hooks.decide(s.ctx, s.req('Read', { file_path: path.join(os.homedir(), '.ssh', 'id_rsa') }));
    expect(d).toMatchObject({ kind: 'deny', code: 'POLICY_DENIED' });
    expect(s.store.pendingApprovals()).toHaveLength(0);
  });

  it('perda do fence ou do lock: deny com interrupt (LOCK_LOST) antes de qualquer efeito', async () => {
    const s = setup();
    s.setHeld(false);
    expect(await s.hooks.decide(s.ctx, s.req('Write', { file_path: 'src/n.ts', content: 'x' }))).toMatchObject({ kind: 'deny', interrupt: true, code: 'LOCK_LOST' });
    s.setHeld(true);
    s.store.db.prepare('UPDATE core_owner SET fence = fence + 1').run();
    expect(await s.hooks.decide(s.ctx, s.req('Write', { file_path: 'src/n.ts', content: 'x' }))).toMatchObject({ kind: 'deny', code: 'LOCK_LOST' });
    expect(s.store.db.prepare('SELECT COUNT(*) AS n FROM effects').get()).toMatchObject({ n: 0 });
  });
});

describe('aprovação: fluxo, uso único, TTL, HMAC, fence', () => {
  const rm = { command: 'rm -rf build' };

  it('destrutivo pede aprovação; allow do usuário libera uma vez e registra a intenção', async () => {
    const s = setup();
    const a = await s.ask('Bash', rm);
    expect(a.classification).toBe('destructive');
    expect(a.expiresAt - s.c()).toBe(APPROVAL_TTL_MS);
    const signed = s.user(a.approvalRequestId, 'allow');
    expect(s.store.mustTask(s.task.id).state).toBe('running'); // um clique = decisão + volta a running
    expect(await s.hooks.finalize(s.ctx, s.req('Bash', rm), signed)).toEqual({ kind: 'allow' });
    expect(s.store.effectsOf(s.task.id).map((e) => e.toolName)).toEqual(['Bash']);
    // reutilizar a mesma decisão: recusada
    const again = await s.hooks.finalize(s.ctx, s.req('Bash', rm), signed);
    expect(again.kind).toBe('deny');
    expect((again as { message: string }).message).toMatch(/already_consumed/);
    expect(s.store.effectsOf(s.task.id)).toHaveLength(1);
  });

  it('deny do usuário nega e não consome', async () => {
    const s = setup();
    const a = await s.ask('Bash', rm);
    const signed = s.user(a.approvalRequestId, 'deny');
    expect(await s.hooks.finalize(s.ctx, s.req('Bash', rm), signed)).toMatchObject({ kind: 'deny' });
    expect(s.store.effectsOf(s.task.id)).toHaveLength(0);
  });

  it('expira após 10 min: nem decidir nem usar', async () => {
    const s = setup();
    const a = await s.ask('Bash', rm);
    const signed = s.user(a.approvalRequestId, 'allow');
    s.c.advance(APPROVAL_TTL_MS + 1);
    expect(await s.hooks.finalize(s.ctx, s.req('Bash', rm), signed)).toMatchObject({ kind: 'deny' });
    // e decidir tarde também falha
    const s2 = setup();
    const a2 = await s2.ask('Bash', rm);
    s2.c.advance(APPROVAL_TTL_MS + 1);
    expect(() => s2.user(a2.approvalRequestId, 'allow')).toThrow(/expired/);
  });

  it('HMAC adulterado, decisão trocada e run diferente são recusados', async () => {
    const s = setup();
    const a = await s.ask('Bash', rm);
    const signed = s.user(a.approvalRequestId, 'allow');
    const flip = (x: string) => (x[0] === 'a' ? 'b' : 'a') + x.slice(1);
    expect(await s.hooks.finalize(s.ctx, s.req('Bash', rm), { ...signed, hmac: flip(signed.hmac) })).toMatchObject({ kind: 'deny' });
    expect(await s.hooks.finalize(s.ctx, s.req('Bash', rm), { ...signed, hmac: '' })).toMatchObject({ kind: 'deny' });
    expect(await s.hooks.finalize({ ...s.ctx, runId: 'run_outro' }, s.req('Bash', rm), signed)).toMatchObject({ kind: 'deny' });
    // um deny assinado não vira allow
    const s2 = setup();
    const a2 = await s2.ask('Bash', rm);
    const denied = s2.user(a2.approvalRequestId, 'deny');
    expect(await s2.hooks.finalize(s2.ctx, s2.req('Bash', rm), { ...denied, decision: 'allow' })).toMatchObject({ kind: 'deny' });
    // nada disso consumiu a aprovação válida
    expect(await s.hooks.finalize(s.ctx, s.req('Bash', rm), signed)).toEqual({ kind: 'allow' });
  });

  it('reinício do core (nova chave HMAC): decisão assinada antes não vale', async () => {
    const s = setup();
    const a = await s.ask('Bash', rm);
    const signed = s.user(a.approvalRequestId, 'allow');
    const reboot = createPermissionHooks({ store: s.store, approvals: new ApprovalService(s.store), lockHeld: () => true });
    expect(await reboot.finalize(s.ctx, s.req('Bash', rm), signed)).toMatchObject({ kind: 'deny' });
  });

  it('a ferramenta executada tem de ser a aprovada (mudou depois = negada)', async () => {
    const s = setup();
    const a = await s.ask('Bash', rm);
    const signed = s.user(a.approvalRequestId, 'allow');
    expect(await s.hooks.finalize(s.ctx, s.req('Bash', { command: 'rm -rf /' }), signed)).toMatchObject({ kind: 'deny', message: expect.stringMatching(/mudou/) });
  });

  it('fence/lock perdidos entre a aprovação e o uso: deny + interrupt, aprovação não consumida', async () => {
    const s = setup();
    const a = await s.ask('Bash', rm);
    const signed = s.user(a.approvalRequestId, 'allow');
    s.setHeld(false);
    expect(await s.hooks.finalize(s.ctx, s.req('Bash', rm), signed)).toMatchObject({ kind: 'deny', interrupt: true, code: 'LOCK_LOST' });
    expect(s.store.getApproval(a.approvalRequestId)?.consumedAt).toBeNull();
  });

  it('concorrência: duas finalizações simultâneas da mesma aprovação → exatamente um allow', async () => {
    const s = setup();
    const a = await s.ask('Bash', rm);
    const signed = s.user(a.approvalRequestId, 'allow');
    const r: ToolDecision[] = await Promise.all([1, 2, 3, 4, 5].map(() => s.hooks.finalize(s.ctx, s.req('Bash', rm), signed)));
    expect(r.filter((x) => x.kind === 'allow')).toHaveLength(1);
    expect(s.store.effectsOf(s.task.id)).toHaveLength(1);
  });

  it('o sistema nunca produz allow: denyBySystem só nega', async () => {
    const s = setup();
    const a = await s.ask('Bash', rm);
    s.approvals.denyBySystem(a.approvalRequestId);
    expect(s.store.getApproval(a.approvalRequestId)?.decision).toBe('deny');
    expect(() => s.store.decideApproval(a.approvalRequestId, { decision: 'allow', actor: 'system', hmac: 'x' })).toThrow();
  });

  it('gesto de aprovação de outra aprovação/tarefa não serve', async () => {
    const s = setup();
    const a = await s.ask('Bash', rm);
    expect(() => s.approvals.decideByUser(a.approvalRequestId, 'allow', s.store.issueGesture('approval', s.task.id, 'approval:outro'))).toThrow(/propósito/);
    expect(() => s.approvals.decideByUser(a.approvalRequestId, 'allow', s.store.issueGesture('task_action', s.task.id))).toThrow(/mismatch|gesto/);
  });
});

describe('R6: efeitos incertos na retomada', () => {
  it('intenção não resolvida: a mesma ação é negada; outra ação segue normal', async () => {
    const s = setup();
    const input = { file_path: 'src/x.ts', content: 'abc' };
    expect(await s.hooks.decide(s.ctx, s.req('Write', input))).toEqual({ kind: 'allow' });
    s.store.markUnconfirmed(s.task.id); // crash antes do tool_result
    const again = await s.hooks.decide(s.ctx, s.req('Write', input, 'tu2'));
    expect(again).toMatchObject({ kind: 'deny', code: 'POLICY_DENIED' });
    expect(await s.hooks.decide(s.ctx, s.req('Write', { file_path: 'src/y.ts', content: 'abc' }, 'tu3'))).toEqual({ kind: 'allow' });
  });

  it('marcada como "aplicada" → repetir exige NOVA aprovação (não bloqueio permanente); "não aplicada" libera', async () => {
    const s = setup();
    const input = { file_path: 'src/x.ts', content: 'abc' };
    await s.hooks.decide(s.ctx, s.req('Write', input));
    await s.hooks.decide(s.ctx, s.req('Write', { file_path: 'src/z.ts', content: 'z' }, 'tu9'));
    s.store.markUnconfirmed(s.task.id);
    const effs = s.store.effectsOf(s.task.id);
    const e1 = effs.find((e) => e.targetPath?.endsWith('x.ts'));
    const e2 = effs.find((e) => e.targetPath?.endsWith('z.ts'));
    s.store.resolveEffect((e1 as { id: string }).id, 'user_applied', s.store.issueGesture('effect_resolution', s.task.id));
    s.store.resolveEffect((e2 as { id: string }).id, 'user_not_applied', s.store.issueGesture('effect_resolution', s.task.id));
    step(s.store, s.task.id, 'awaiting_approval');
    const d = await s.hooks.decide(s.ctx, s.req('Write', input, 'tu5'));
    expect(d).toMatchObject({ kind: 'ask', classification: 'destructive' });
    expect((d as { summary: string }).summary).toMatch(/REPETIÇÃO/);
    expect(await s.hooks.decide(s.ctx, s.req('Write', { file_path: 'src/z.ts', content: 'z' }, 'tu6'))).toEqual({ kind: 'allow' });
  });
});
