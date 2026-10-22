import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PocketStore } from '../core/store';
import { openCore } from '../open-core';
import { getProcInfo, pidAlive } from '../process/proc-info';
import { init, toolUse, type Scenario } from '../../integrations/claude-code/pocket/fake-sdk';
import { harness, type Harness } from '../../integrations/claude-code/pocket/harness';
import { driveTo, step, tmpDir } from '../testing/helpers';
import { collectEvidence, FsTranscriptProbe, gitStatusProbe, reconcileOnStartup, suggestFor, verifyIntegrity } from './reconcile';

const cleanups: (() => void)[] = [];
const stores: PocketStore[] = [];
const hs: Harness[] = [];
afterEach(async () => {
  while (hs.length) await hs.pop()?.cleanup();
  while (stores.length) stores.pop()?.close();
  while (cleanups.length) cleanups.pop()?.();
});

function env() {
  const t = tmpDir('pocket-rec2-');
  cleanups.push(t.cleanup);
  const projects = path.join(t.dir, 'claude-projects');
  const ws = path.join(t.dir, 'ws');
  mkdirSync(path.join(projects, 'p'), { recursive: true });
  mkdirSync(ws, { recursive: true });
  const store = PocketStore.open(path.join(t.dir, 'p.db'));
  stores.push(store);
  const probe = new FsTranscriptProbe(projects);
  const transcript = (sid: string, lines: unknown[], trunc = '') => {
    const p = path.join(projects, 'p', `${sid}.jsonl`);
    writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + (trunc ? `\n${trunc}` : '\n'));
    return p;
  };
  return { t, store, probe, ws, transcript, deps: { store, probe } };
}
const tu = (id: string) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Write', input: { content: 'CONTEUDO-SECRETO' } }] } });
const tr = (id: string) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'RESULTADO-SECRETO' }] } });
const say = { type: 'assistant', message: { content: [{ type: 'text', text: 'TEXTO-SECRETO' }] } };

describe('R1: banco íntegro e projeção == journal', () => {
  it('banco limpo: sem problemas; projeção adulterada (fora do processo) é detectada e nada é tocado', async () => {
    const e = env();
    const t = driveTo(e.store, 'running', e.ws);
    expect(verifyIntegrity(e.store)).toEqual([]);
    // alguém desarma o trigger e altera a projeção direto no arquivo
    e.store.db.exec('DROP TRIGGER tasks_state_matches_journal');
    e.store.db.exec('DROP TRIGGER tasks_state_guard');
    e.store.db.prepare("UPDATE tasks SET state = 'review' WHERE id = ?").run(t.id);
    const issues = verifyIntegrity(e.store);
    expect(issues.join(' ')).toMatch(/diverge do journal/);
    const rep = await reconcileOnStartup(e.deps);
    expect(rep.integrityIssues.length).toBeGreaterThan(0);
    expect(rep.movedToReconcile).toEqual([]);
  });
});

describe('R2: running/awaiting_approval sem runner vivo → needs_reconcile, sem replay', () => {
  it('fecha a run, nega aprovação pendente, marca efeitos incertos, sessão idle; idempotente; nada é reexecutado', async () => {
    const e = env();
    const a = driveTo(e.store, 'running', e.ws);
    const sa = e.store.reserveSession(a.id);
    const ra = e.store.beginRun({ taskId: a.id, sessionId: sa.id, kind: 'start' });
    e.store.setSessionState(sa.id, 'active', 't');
    e.store.recordIntent({ taskId: a.id, sessionId: sa.id, runId: ra.id, toolUseId: 'w1', toolName: 'Write', actionKey: 'k1', classification: 'workspace_write', summary: 'Write a', verifiable: false });
    // segunda tarefa: aguardando aprovação no momento da queda
    const b = driveTo(e.store, 'running', e.ws);
    const sb = e.store.reserveSession(b.id);
    const rb = e.store.beginRun({ taskId: b.id, sessionId: sb.id, kind: 'start' });
    e.store.setSessionState(sb.id, 'active', 't');
    e.store.createApprovalRequest({ approvalRequestId: 'ar1', taskId: b.id, sessionId: sb.id, runId: rb.id, toolName: 'Bash', actionKey: 'k2', classification: 'destructive', summary: 'rm', expiresAt: Date.now() + 600_000 });
    step(e.store, b.id, 'awaiting_approval');
    const runsBefore = e.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get() as { n: number };

    const rep = await reconcileOnStartup(e.deps);
    expect(rep.movedToReconcile.map((m) => m.reason)).toEqual(['orchestrator_crash', 'orchestrator_crash']);
    for (const id of [a.id, b.id]) expect(e.store.mustTask(id).state).toBe('needs_reconcile');
    expect(e.store.getRun(ra.id)?.outcome).toBe('crash');
    expect(e.store.effectsOf(a.id)[0]?.status).toBe('unconfirmed');
    expect(e.store.getApproval('ar1')).toMatchObject({ decision: 'deny', actor: 'system' });
    expect(rep.deniedApprovals).toBe(1);
    expect(e.store.mustSession(sa.id).state).toBe('idle');
    expect((e.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get() as { n: number }).n).toBe(runsBefore.n); // nenhuma run nova = nenhum replay
    // segunda passada: nada a fazer
    expect((await reconcileOnStartup(e.deps)).movedToReconcile).toEqual([]);
    // saiu de running/awaiting sem gesto, e a saída de needs_reconcile continua exigindo o usuário
    expect(() => e.store.transition(a.id, 'running', { actor: 'system', reason: 'x' })).toThrow(/transição inválida/);
  });

  it('estados de falha/espera são preservados no restart (nada é "curado" sozinho)', async () => {
    const e = env();
    const ids = (['review', 'interrupted', 'paused', 'failed', 'auth_error', 'usage_limited', 'session_expired', 'completed', 'cancelled'] as const)
      .map((s) => [s, driveTo(e.store, s, e.ws).id] as const);
    await reconcileOnStartup(e.deps);
    for (const [s, id] of ids) expect(e.store.mustTask(id).state, s).toBe(s);
  });
});

describe('R3: queued com transcrito ou intenção no ledger → needs_reconcile (lost_transition)', () => {
  it('transcrito existente para a sessão reservada', async () => {
    const e = env();
    const t = driveTo(e.store, 'queued', e.ws);
    const s = e.store.reserveSession(t.id);
    e.transcript(s.id, [say]);
    const rep = await reconcileOnStartup(e.deps);
    expect(rep.movedToReconcile).toEqual([{ taskId: t.id, reason: 'lost_transition' }]);
    expect(e.store.mustTask(t.id).state).toBe('needs_reconcile');
  });

  it('intenção/execução no ledger de uma tarefa ainda queued (perda da última linha do journal)', async () => {
    const e = env();
    const t = driveTo(e.store, 'running', e.ws);
    const s = e.store.reserveSession(t.id);
    const r = e.store.beginRun({ taskId: t.id, sessionId: s.id, kind: 'start' });
    e.store.recordIntent({ taskId: t.id, sessionId: s.id, runId: r.id, toolUseId: 'w', toolName: 'Write', actionKey: 'k', classification: 'workspace_write', summary: 's', verifiable: false });
    // simula a projeção "atrasada" (journal perdeu a transição): queued com rastros de execução
    e.store.db.exec('DROP TRIGGER tasks_state_matches_journal');
    e.store.db.exec('DROP TRIGGER tasks_state_guard');
    e.store.db.prepare("UPDATE tasks SET state = 'queued'").run();
    e.store.db.prepare("INSERT INTO journal(ts, task_id, kind, from_state, to_state, actor, reason) VALUES (1, ?, 'transition', 'running', 'queued', 'system', 'simulado')").run(t.id);
    e.store.db.exec('CREATE TRIGGER tasks_state_guard BEFORE UPDATE OF state ON tasks BEGIN SELECT 1; END');
    const rep = await reconcileOnStartup(e.deps);
    expect(rep.integrityIssues).toEqual([]);
    expect(rep.movedToReconcile.map((m) => m.reason)).toContain('lost_transition');
  });

  it('queued limpa (sem transcrito nem rastros) não é tocada', async () => {
    const e = env();
    const t = driveTo(e.store, 'queued', e.ws);
    e.store.reserveSession(t.id);
    expect((await reconcileOnStartup(e.deps)).movedToReconcile).toEqual([]);
    expect(e.store.mustTask(t.id).state).toBe('queued');
  });
});

describe('R4: runner órfão do journal é encerrado antes da reconciliação', () => {
  it('openCore mata o runner (pid + tempo de criação) e a tarefa vai a needs_reconcile com a evidência', async () => {
    const e = env();
    const db = path.join(e.t.dir, 'orphan.db');
    const s1 = PocketStore.open(db);
    const t = driveTo(s1, 'running', e.ws);
    const sess = s1.reserveSession(t.id);
    const run = s1.beginRun({ taskId: t.id, sessionId: sess.id, kind: 'start' });
    s1.setSessionState(sess.id, 'active', 't');
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    const info = await getProcInfo(child.pid as number);
    s1.recordProcess({ runId: run.id, pid: child.pid as number, startTime: info?.startTime ?? null, role: 'runner' });
    s1.close();
    const core = await openCore(db);
    try {
      expect(core.orphans.killed.map((k) => k.pid)).toContain(child.pid);
      const rep = await reconcileOnStartup({ store: core.store, probe: e.probe }, core.orphans);
      expect(rep.movedToReconcile).toEqual([{ taskId: t.id, reason: 'orchestrator_crash' }]);
      const tr = core.store.journalSince(0, t.id).filter((x) => x.kind === 'transition').at(-1);
      expect(tr?.payload).toMatchObject({ orphanKilled: true });
      await vi.waitFor(() => expect(pidAlive(child.pid as number)).toBe(false), { timeout: 5000 });
    } finally { await core.close(); }
  }, 60_000);
});

describe('R5: evidência sem conteúdo', () => {
  it('transcrito: turno incompleto (termina em tool_result) vs completo; linha final truncada é ignorada', async () => {
    const e = env();
    const t = driveTo(e.store, 'running', e.ws);
    const s = e.store.reserveSession(t.id);
    e.transcript(s.id, [say, tu('w1'), tr('w1')], '{"type":"assistant","message":{"content":[{"type":"te');
    let info = await e.probe.probe(s.id, e.ws);
    expect(info?.tail).toEqual(['assistant:text', 'assistant:tool_use', 'user:tool_result']);
    expect(info?.incompleteTurn).toBe(true);
    e.transcript(s.id, [say, tu('w1'), tr('w1'), say]);
    info = await e.probe.probe(s.id, e.ws);
    expect(info?.incompleteTurn).toBe(false);
    expect(await e.probe.probe('nao-e-uuid/../x', e.ws)).toBeNull();
    expect(await e.probe.probe('99999999-2222-4333-8444-555555555555', e.ws)).toBeNull();
  });

  it('verificação de efeitos: hash igual = aplicado; arquivo ausente = não aplicado; resto = desconhecido', () => {
    const e = env();
    const f = path.join(e.ws, 'a.txt');
    writeFileSync(f, 'conteudo');
    const hash = execFileSync(process.execPath, ['-e', "process.stdout.write(require('crypto').createHash('sha256').update('conteudo').digest('hex'))"]).toString();
    expect(suggestFor({ verifiable: true, targetPath: f, expectedHash: hash, toolName: 'Write' })).toBe('applied');
    expect(suggestFor({ verifiable: true, targetPath: f, expectedHash: 'outro', toolName: 'Write' })).toBe('unknown');
    rmSync(f);
    expect(suggestFor({ verifiable: true, targetPath: f, expectedHash: hash, toolName: 'Write' })).toBe('not_applied');
    expect(suggestFor({ verifiable: false, targetPath: f, expectedHash: hash, toolName: 'Edit' })).toBe('unknown');
    expect(suggestFor({ verifiable: false, targetPath: null, expectedHash: null, toolName: 'Bash' })).toBe('unknown');
  });

  it('collectEvidence: efeitos + git + atividade externa; nada de conteúdo no journal', async () => {
    const e = env();
    execFileSync('git', ['init', '-q'], { cwd: e.ws });
    writeFileSync(path.join(e.ws, 'novo.txt'), 'x');
    const task = driveTo(e.store, 'running', e.ws);
    const sess = e.store.reserveSession(task.id);
    const run = e.store.beginRun({ taskId: task.id, sessionId: sess.id, kind: 'start' });
    e.store.setSessionState(sess.id, 'active', 't');
    const hash = execFileSync(process.execPath, ['-e', "process.stdout.write(require('crypto').createHash('sha256').update('x').digest('hex'))"]).toString();
    e.store.recordIntent({ taskId: task.id, sessionId: sess.id, runId: run.id, toolUseId: 'w1', toolName: 'Write', actionKey: 'k1', classification: 'workspace_write', summary: 'Write novo.txt', targetPath: path.join(e.ws, 'novo.txt'), expectedHash: hash, verifiable: true });
    e.store.recordIntent({ taskId: task.id, sessionId: sess.id, runId: run.id, toolUseId: 'b1', toolName: 'Bash', actionKey: 'k2', classification: 'destructive', summary: 'Bash git', verifiable: false });
    await reconcileOnStartup(e.deps);
    const p = e.transcript(sess.id, [say, tu('b1'), tr('b1')]);
    const future = new Date(Date.now() + 60_000);
    utimesSync(p, future, future); // cresceu depois do fim da última execução nossa
    const ev = await collectEvidence({ ...e.deps, git: gitStatusProbe }, task.id, { includeGit: true });
    expect(ev.state).toBe('needs_reconcile');
    expect(ev.reason).toBe('orchestrator_crash');
    expect(ev.transcript?.incompleteTurn).toBe(true);
    expect(ev.externalActivity).toBe(true);
    expect(e.store.mustSession(sess.id).externalActivity).toBe(true);
    expect(Object.fromEntries(ev.effects.map((x) => [x.toolName, x.suggestion]))).toEqual({ Write: 'applied', Bash: 'unknown' });
    expect(ev.git?.files.join(' ')).toContain('novo.txt');
    const journal = JSON.stringify(e.store.journalSince(0, task.id));
    for (const secret of ['CONTEUDO-SECRETO', 'RESULTADO-SECRETO', 'TEXTO-SECRETO']) expect(journal).not.toContain(secret);
  }, 30_000);
});

describe('R6 + retomada explícita (integração com orquestrador e runner falso)', () => {
  /** run 1: escreve e "morre" antes do tool_result; restart; reconcilia; decide; retoma. */
  async function crashAfterWrite(): Promise<{ h2: Harness; id: string; dir: string; eff: string }> {
    const writeThenDie: Scenario = async function* (ctl) {
      yield init(ctl);
      yield toolUse('w1', 'Write', { file_path: 'src/x.ts', content: 'abc' });
      await ctl.canUse('Write', { file_path: 'src/x.ts', content: 'abc' }, 'w1');
      await new Promise<never>(() => undefined);
    };
    const h1 = harness({ scenarios: [writeThenDie] });
    const id = h1.user.create();
    await h1.user.start(id);
    await vi.waitFor(() => expect(h1.store.effectsOf(id)).toHaveLength(1));
    const dir = h1.dir;
    h1.store.close(); // host "morre": sem endRun, sem transição; o fake continua preso (processo morto)
    h1.orch.dispose();
    hs.push({ cleanup: async () => { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } } as Harness); // h2 reutiliza o diretório (cleanup nulo): limpa no fim
    // a morte do processo libera os locks do kernel; aqui, no mesmo processo de teste, soltamos à mão
    for (const l of (h1.orch as unknown as { live: Map<string, { lease: { release(): Promise<void> } }> }).live.values()) await l.lease.release();
    const h2 = harness({ reuseDir: dir });
    hs.push(h2);
    const rep = await reconcileOnStartup({ store: h2.store, probe: h2.probe });
    expect(rep.movedToReconcile).toEqual([{ taskId: id, reason: 'orchestrator_crash' }]);
    expect(h2.sdk.calls).toHaveLength(0); // crash NÃO provoca replay automático
    return { h2, id, dir, eff: h2.store.effectsOf(id)[0]!.id };
  }

  it('retomar exige decidir cada efeito incerto e reconhecer; a mesma ação marcada "não aplicada" volta a ser permitida', async () => {
    const { h2, id, eff } = await crashAfterWrite();
    await expect(h2.user.resume(id)).rejects.toMatchObject({ code: 'RECONCILE_REQUIRED' });
    expect(h2.orch.view(id).unconfirmedEffects.map((x) => x.status)).toEqual(['unconfirmed']);
    h2.orch.resolveEffect(eff, 'not_applied', h2.store.issueGesture('effect_resolution', id));
    await expect(h2.user.resume(id)).rejects.toMatchObject({ code: 'RECONCILE_REQUIRED' }); // falta o reconhecimento
    h2.orch.acknowledgeReconcile(id, h2.user.gesture(id, 'reconcile_ack'));
    const retry: Scenario = async function* (ctl) {
      const { init: i0 } = await import('../../integrations/claude-code/pocket/fake-sdk');
      yield i0(ctl);
      const r = await ctl.canUse('Write', { file_path: 'src/x.ts', content: 'abc' }, 'w2');
      expect(r.behavior).toBe('allow'); // não aplicada: pode repetir
      yield { type: 'result', subtype: 'success', is_error: false, duration_ms: 1, errors: [] };
      await ctl.promptClosed;
    };
    h2.sdk.next(retry);
    await h2.user.resume(id, 'tente de novo a escrita');
    await vi.waitFor(() => expect(h2.store.mustTask(id).state).toBe('review'), { timeout: 5000 });
    // só uma execução nova, iniciada por gesto do usuário
    const last = h2.store.journalSince(0, id).filter((e) => e.kind === 'transition' && e.toState === 'running').at(-1);
    expect(last).toMatchObject({ actor: 'user' });
    expect(last?.gestureId).toBeTruthy();
  }, 30_000);

  it('marcada "já aplicada": repetir a MESMA ação exige nova aprovação; outra ação segue normal', async () => {
    const { h2, id, eff } = await crashAfterWrite();
    h2.orch.resolveEffect(eff, 'applied', h2.store.issueGesture('effect_resolution', id));
    h2.orch.acknowledgeReconcile(id, h2.user.gesture(id, 'reconcile_ack'));
    const retry: Scenario = async function* (ctl) {
      const { init: i0 } = await import('../../integrations/claude-code/pocket/fake-sdk');
      yield i0(ctl);
      const other = await ctl.canUse('Write', { file_path: 'src/outro.ts', content: 'z' }, 'w3');
      expect(other.behavior).toBe('allow');
      await ctl.canUse('Write', { file_path: 'src/x.ts', content: 'abc' }, 'w4'); // pede aprovação e fica esperando
      await new Promise<never>(() => undefined);
    };
    h2.sdk.next(retry);
    await h2.user.resume(id, 'continue');
    await vi.waitFor(() => expect(h2.store.mustTask(id).state).toBe('awaiting_approval'), { timeout: 5000 });
    const pending = h2.orch.view(id).pendingApprovals[0]!;
    expect(pending.summary).toMatch(/REPETIÇÃO/);
    expect(pending.classification).toBe('destructive');
    await h2.user.interrupt(id).catch(() => undefined);
  }, 30_000);

  it('sair de needs_reconcile sem retomar: aceitar como está (review), falha ou cancelamento — sempre por gesto', async () => {
    const { h2, id, eff } = await crashAfterWrite();
    expect(() => h2.orch.resolveReconcile(id, 'review', 'g_inexistente')).toThrow();
    h2.orch.resolveEffect(eff, 'unknown', h2.store.issueGesture('effect_resolution', id));
    h2.orch.resolveReconcile(id, 'review', h2.user.gesture(id, 'to:review'));
    expect(h2.store.mustTask(id).state).toBe('review');
  }, 30_000);

  it('sessão expirada nunca é recriada em silêncio (retomada recusa; nova sessão só com consentimento)', async () => {
    const h = harness();
    hs.push(h);
    const id = h.user.create();
    const t = h.store.mustTask(id);
    h.store.transition(id, 'running', { actor: 'user', reason: 't', gestureId: h.user.gesture(id, 'to:running') });
    const s = h.store.reserveSession(id);
    h.store.setSessionState(s.id, 'active', 't');
    h.store.setSessionState(s.id, 'expired', 'resume recusado');
    h.store.transition(id, 'session_expired', { actor: 'system', reason: 'SESSION_NOT_FOUND' });
    expect(t.id).toBe(id);
    await expect(h.user.resume(id)).rejects.toMatchObject({ code: 'NEW_SESSION_REQUIRED' });
    expect(h.sdk.calls).toHaveLength(0);
  });
});
