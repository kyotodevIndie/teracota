// Montagem completa para testes de integração: Core + hooks reais + adapter com SDK falso + orquestrador.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PocketStore } from '../../../pocket/core/store';
import { FsTranscriptProbe, type TranscriptProbe } from '../../../pocket/reconcile/reconcile';
import { PocketOrchestrator } from '../../../pocket/orchestrator/orchestrator';
import { OsExecLocks } from '../../../pocket/process/exec-locks';
import { ClaudeCodeRunner } from './claude-runner';
import { ApprovalService } from '../../../pocket/security/approvals';
import { createPermissionHooks } from '../../../pocket/security/permission-hooks';
import { FakeSdk, type Scenario } from './fake-sdk';
import { tmpDir } from '../../../pocket/testing/helpers';

export interface Harness {
  dir: string;
  ws: string;
  store: PocketStore;
  sdk: FakeSdk;
  runner: ClaudeCodeRunner;
  approvals: ApprovalService;
  orch: PocketOrchestrator;
  locks: OsExecLocks;
  sleeps: number[];
  user: {
    create(title?: string, prompt?: string): string;
    start(id: string): Promise<{ runId: string }>;
    resume(id: string, prompt?: string, opts?: { newSession?: boolean }): Promise<{ runId: string }>;
    interrupt(id: string): Promise<'interrupted' | 'forced_kill'>;
    cancel(id: string): Promise<void>;
    approve(approvalRequestId: string, decision?: 'allow' | 'deny'): Promise<void>;
    approveReview(id: string): void;
    gesture(taskId: string, purpose?: string): string;
  };
  probe: TranscriptProbe;
  cleanup(): Promise<void>;
}

export function harness(opts: { scenarios?: Scenario[]; retryBaseMs?: number; forceAfterMs?: number; sleep?: (ms: number) => Promise<void>; reuseDir?: string; probe?: TranscriptProbe } = {}): Harness {
  const t = opts.reuseDir ? { dir: opts.reuseDir, cleanup: () => undefined } : tmpDir('pocket-h-');
  const ws = path.join(t.dir, 'ws');
  mkdirSync(path.join(ws, 'src'), { recursive: true });
  writeFileSync(path.join(ws, 'src', 'a.ts'), 'x');
  const store = PocketStore.open(path.join(t.dir, 'pocket.db'));
  const probe = opts.probe ?? new FsTranscriptProbe(path.join(t.dir, 'claude-projects'));
  const sdk = new FakeSdk();
  if (opts.scenarios) sdk.next(...opts.scenarios);
  const approvals = new ApprovalService(store);
  const locks = new OsExecLocks(`harness-${t.dir}`, 'teste');
  const sleeps: number[] = [];
  let orchRef: PocketOrchestrator | null = null;
  const hooks = createPermissionHooks({ store, approvals, lockHeld: (ctx) => orchRef?.lockHeld(ctx) ?? false });
  const runner = new ClaudeCodeRunner({
    sdk, hooks, env: { PATH: 'x' },
    sink: ((runId: string, type: never, payload: never) => store.appendEvent(runId, type, payload)) as never,
  });
  const orch = new PocketOrchestrator({
    store, runner, approvals, locks, probe, retryBaseMs: opts.retryBaseMs ?? 1, forceAfterMs: opts.forceAfterMs ?? 300,
    sleep: opts.sleep ?? (async (ms) => { sleeps.push(ms); }),
  });
  orchRef = orch;
  const g = (taskId: string, purpose?: string) => store.issueGesture('task_action', taskId, purpose ?? null);
  const user: Harness['user'] = {
    create: (title = 'tarefa', prompt = 'faça algo') => orch.createTask({ title, prompt, cwd: ws }, store.issueGesture('create_task', null)).id,
    start: (id) => orch.startTask(id, g(id, 'to:running')),
    resume: (id, prompt = 'continue por favor', o) => orch.resumeTask(id, prompt, g(id, 'to:running'), o),
    interrupt: (id) => orch.interruptTask(id, g(id, 'to:interrupted')),
    cancel: (id) => orch.cancelTask(id, g(id, 'to:cancelled')),
    approve: (aid, decision = 'allow') => orch.resolveApproval(aid, decision, store.issueGesture('approval', store.mustApproval(aid).taskId, `approval:${aid}`)),
    approveReview: (id) => orch.approveReview(id, g(id, 'to:completed')),
    gesture: g,
  };
  return {
    dir: t.dir, ws, probe, store, sdk, runner, approvals, orch, locks, sleeps, user,
    cleanup: async () => { await orch.idle().catch(() => undefined); orch.dispose(); store.close(); t.cleanup(); },
  };
}
