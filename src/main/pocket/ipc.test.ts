import { afterEach, describe, expect, it, vi } from 'vitest';
import { POCKET_IPC, type PocketChannel } from '../../shared/pocket-ipc';
import { actionsFor, secondsLeft, STATE_LABEL } from '../../shared/pocket-ui';
import { TASK_STATES, type TaskView } from '../../shared/pocket';
import { createPocketHandlers, runHandler, validateCwd } from './ipc';
import { happy } from '../integrations/claude-code/pocket/fake-sdk';
import { harness, type Harness } from '../integrations/claude-code/pocket/harness';

const hs: Harness[] = [];
afterEach(async () => { while (hs.length) await hs.pop()?.cleanup(); });

const sep = process.platform === 'win32' ? '\\' : '/';
const diskRoot = (): string => (process.platform === 'win32' ? 'C:\\' : '/');

function ui() {
  const h = harness({ scenarios: [happy([{ id: 'b1', name: 'Bash', input: { command: 'rm -rf build' } }])] });
  hs.push(h);
  const handlers = createPocketHandlers({
    forbiddenWorkdirs: () => [], orch: h.orch, store: h.store, status: () => ({ ready: true, claudeFound: true, containment: 'taskkill', orphansKilled: 0 }), pickFolder: async () => h.ws,
  });
  const call = (ch: PocketChannel, arg?: unknown) => runHandler(handlers[ch], arg);
  return { h, call };
}

describe('IPC da Pocket (caminho de comando da UI)', () => {
  it('fluxo completo pelos handlers: criar → iniciar → aprovar → review → concluir', async () => {
    const { h, call } = ui();
    const created = await call(POCKET_IPC.create, { title: 'Limpar build', prompt: 'apague a pasta build', cwd: h.ws });
    expect(created.ok).toBe(true);
    const id = (created as { data: TaskView }).data.id;
    expect(((await call(POCKET_IPC.list)) as { data: TaskView[] }).data[0]?.state).toBe('queued');
    expect((await call(POCKET_IPC.start, { taskId: id })).ok).toBe(true);
    await vi.waitFor(() => expect(h.store.mustTask(id).state).toBe('awaiting_approval'));
    const pending = h.orch.view(id).pendingApprovals[0]!;
    expect((await call(POCKET_IPC.approval, { approvalRequestId: pending.approvalRequestId, decision: 'allow' })).ok).toBe(true);
    await vi.waitFor(() => expect(h.store.mustTask(id).state).toBe('review'));
    await h.orch.idle();
    expect((await call(POCKET_IPC.approveReview, { taskId: id })).ok).toBe(true);
    expect(h.store.mustTask(id).state).toBe('completed');
  });

  it('cada clique vira UM gesto: nenhum gesto sobra nem é reaproveitado', async () => {
    const { h, call } = ui();
    const id = ((await call(POCKET_IPC.create, { title: 't', prompt: 'p', cwd: h.ws })) as { data: TaskView }).data.id;
    await call(POCKET_IPC.cancel, { taskId: id });
    const unused = h.store.db.prepare('SELECT COUNT(*) AS n FROM gestures WHERE consumed_at IS NULL').get() as { n: number };
    expect(unused.n).toBe(0);
    expect(h.store.mustTask(id).state).toBe('cancelled');
  });

  it('entradas inválidas são recusadas com BAD_INPUT, sem tocar no Core', async () => {
    const { h, call } = ui();
    const bad: [PocketChannel, unknown][] = [
      [POCKET_IPC.create, { title: '', prompt: 'p', cwd: h.ws }],
      [POCKET_IPC.create, { title: 't', prompt: 'x'.repeat(20_001), cwd: h.ws }],
      [POCKET_IPC.create, { title: 't', prompt: 'p', cwd: 'relativo/pasta' }],
      [POCKET_IPC.create, { title: 't', prompt: 'p', cwd: 'C:\\pasta\\que\\nao\\existe\\mesmo' }],
      [POCKET_IPC.create, { title: 't', prompt: 'p', cwd: diskRoot() }],
      [POCKET_IPC.create, 'string'],
      [POCKET_IPC.create, null],
      [POCKET_IPC.create, [1]],
      [POCKET_IPC.start, { taskId: '../../x' }],
      [POCKET_IPC.start, {}],
      [POCKET_IPC.start, { taskId: 5 }],
      [POCKET_IPC.approval, { approvalRequestId: 'x', decision: 'talvez' }],
      [POCKET_IPC.resolveEffect, { effectId: 'nao-existe', resolution: 'applied' }],
      [POCKET_IPC.resolveReconcile, { taskId: 'a', to: 'completed' }],
    ];
    for (const [ch, arg] of bad) {
      const r = await call(ch, arg);
      expect(r, `${ch} ${JSON.stringify(arg).slice(0, 40)}`).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    }
    expect(h.store.listTasks()).toHaveLength(0);
  });

  it('erros do Core viram resultado tipado (sem stack): estado inválido e tarefa inexistente', async () => {
    const { h, call } = ui();
    const id = ((await call(POCKET_IPC.create, { title: 't', prompt: 'p', cwd: h.ws })) as { data: TaskView }).data.id;
    expect(await call(POCKET_IPC.approveReview, { taskId: id })).toMatchObject({ ok: false, code: 'INVALID_STATE' });
    expect(await call(POCKET_IPC.resume, { taskId: id, prompt: 'x' })).toMatchObject({ ok: false, code: 'INVALID_STATE' });
    expect(await call(POCKET_IPC.start, { taskId: 'task_inexistente' })).toMatchObject({ ok: false });
  });

  it('validateCwd: absoluta, existente, diretório, não raiz', () => {
    const { h } = ui();
    expect(validateCwd(h.ws)).toBeTruthy();
    expect(() => validateCwd(`${h.ws}${sep}src${sep}a.ts`)).toThrow(/pasta/);
    expect(() => validateCwd(diskRoot())).toThrow(/raiz/);
  });
});

describe('lógica de apresentação (por estado)', () => {
  const view = (state: TaskView['state'], effects: TaskView['unconfirmedEffects'] = []) => ({ state, unconfirmedEffects: effects });
  it('todo estado tem rótulo; terminais não têm ações', () => {
    for (const s of TASK_STATES) expect(STATE_LABEL[s]).toBeTruthy();
    for (const s of ['completed', 'failed', 'cancelled'] as const) expect(Object.values(actionsFor(view(s))).some((v) => v === true)).toBe(false);
  });
  it('só queued inicia; só running/awaiting interrompem; review aprova e pede ajuste', () => {
    expect(actionsFor(view('queued')).start).toBe(true);
    expect(actionsFor(view('running'))).toMatchObject({ start: false, interrupt: true, resume: false });
    expect(actionsFor(view('awaiting_approval'))).toMatchObject({ approvals: true, interrupt: true });
    expect(actionsFor(view('review'))).toMatchObject({ approveReview: true, resume: true });
    expect(actionsFor(view('session_expired'))).toMatchObject({ resume: true, newSession: true });
    expect(actionsFor(view('interrupted'))).toMatchObject({ resume: true, acceptAsIs: true });
  });
  it('needs_reconcile: retomar bloqueado até decidir efeitos e reconhecer', () => {
    const eff = { id: 'e', taskId: 't', toolName: 'Write', actionKey: 'k', summary: 's', verifiable: true, suggestion: 'unknown' as const, status: 'unconfirmed' };
    expect(actionsFor(view('needs_reconcile', [eff])).resumeBlockedReason).toMatch(/1 efeito/);
    expect(actionsFor(view('needs_reconcile')).resumeBlockedReason).toMatch(/revisou/);
    expect(actionsFor({ ...view('needs_reconcile'), reconcileAcked: true }).resumeBlockedReason).toBeNull();
  });
  it('contagem regressiva nunca fica negativa', () => {
    expect(secondsLeft(10_000, 4_000)).toBe(6);
    expect(secondsLeft(1_000, 4_000)).toBe(0);
  });
});
