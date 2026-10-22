// Montagem da Tera Pocket para o app real: Core (lock → banco → órfãos → reconciliação), runner Claude Code
// (SDK oficial, processo `claude` oficial do próprio usuário), permissões, locks e orquestrador.
// Sem Electron aqui: recebe o diretório de dados e funções de UI por parâmetro (testável em Node).
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { PocketStatus } from '../../shared/pocket-ipc';
import { openCore, type OpenedCore } from './open-core';
import { PocketOrchestrator } from './orchestrator/orchestrator';
import type { Containment } from './process/containment';
import { OsExecLocks } from './process/exec-locks';
import { JobObjectContainment } from './process/job-object';
import { type ManagedProcess, ProcessSupervisor } from './process/supervisor';
import { FsTranscriptProbe, gitStatusProbe, reconcileOnStartup, type TranscriptProbe, type GitProbe } from './reconcile/reconcile';
import { ClaudeCodeRunner, loadClaudeSdk, type SdkApi } from '../integrations';
import { ApprovalService } from './security/approvals';
import { setProtectedPaths } from './security/paths';
import { createPermissionHooks } from './security/permission-hooks';
import os from 'node:os';
import type { ForbiddenDir, PocketBackend } from './ipc';

/** Procura o `claude` oficial instalado pelo usuário no PATH (nunca um binário nosso nem do SDK empacotado). */
export function resolveClaudeExecutable(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const names = process.platform === 'win32' ? ['claude.exe'] : ['claude'];
  for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue; // entradas relativas ('.', 'bin') seriam resolvidas contra a pasta atual
    for (const n of names) {
      const p = path.join(dir, n);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

export interface ServiceOptions {
  dataDir: string;
  pickFolder: () => Promise<string | null>;
  onChanged: () => void;
  /** Injeção para testes/diagnóstico; por padrão usa o SDK real. */
  sdk?: SdkApi;
  claudePath?: string;
  probe?: TranscriptProbe;
  git?: GitProbe;
  model?: string;
  /** Injeção para testes; produção = Job Object (falha segura se não puder ser criado). */
  containmentFactory?: () => Containment;
  /** Pastas do app (instalação, userData, executável): protegidas contra escrita do agente e proibidas como pasta de trabalho. */
  extraProtected?: string[];
}

export class PocketService implements PocketBackend {
  private constructor(
    readonly core: OpenedCore,
    readonly orch: PocketOrchestrator,
    readonly runner: ClaudeCodeRunner,
    readonly claudeFound: boolean,
    private readonly opts: ServiceOptions,
    readonly blocked?: string,
  ) {}

  get store() { return this.core.store; }

  static async start(opts: ServiceOptions): Promise<PocketService> {
    const claudePathEarly = opts.claudePath ?? resolveClaudeExecutable();
    const protectedDirs = [opts.dataDir, ...(opts.extraProtected ?? []), ...(claudePathEarly ? [path.dirname(claudePathEarly)] : [])];
    setProtectedPaths(protectedDirs); // o agente nunca toca no banco/journal, no app instalado nem no binário do claude
    // falha segura: sem Job Object não há execução (lança antes de tomar o lock ou abrir o banco)
    const containment = (opts.containmentFactory ?? (() => JobObjectContainment.create()))();
    const core = await openCore(path.join(opts.dataDir, 'pocket.db'), { label: 'teracota-pocket', containment });
    const probe = opts.probe ?? new FsTranscriptProbe();
    const git = opts.git ?? gitStatusProbe;
    const store = core.store;
    const report = await reconcileOnStartup({ store, probe, git }, core.orphans);
    const approvals = new ApprovalService(store);
    const supervisor = new ProcessSupervisor(store, core.containment);
    let orchRef: PocketOrchestrator | null = null;
    const hooks = createPermissionHooks({ store, approvals, lockHeld: (ctx) => orchRef?.lockHeld(ctx) ?? false });
    const claudePath = claudePathEarly;
    const sdk = opts.sdk ?? await loadClaudeSdk();
    const runner = new ClaudeCodeRunner({
      sdk, hooks, claudePath, model: opts.model,
      sink: ((runId: string, type: never, payload: never) => store.appendEvent(runId, type, payload)) as never,
      spawn: (r) => supervisor.spawn({ command: r.command, args: r.args, cwd: r.cwd ?? (() => { throw new Error('runner sem cwd: recusado'); })(), env: r.env as NodeJS.ProcessEnv, runId: r.runId }),
      killTree: (p) => supervisor.killTree(p as ManagedProcess, 'abort'),
    });
    const orch = new PocketOrchestrator({ store, runner, approvals, locks: new OsExecLocks(opts.dataDir), probe, git });
    orchRef = orch;
    orch.onChange(() => opts.onChanged());
    const blocked = report.integrityIssues.length > 0 ? `inconsistência no banco: ${report.integrityIssues[0]}` : undefined;
    const svc = new PocketService(core, orch, runner, claudePath !== undefined, opts, blocked);
    svc.supervisor = supervisor;
    return svc;
  }

  private supervisor: ProcessSupervisor | null = null;

  status(): PocketStatus {
    return {
      ready: !this.blocked, blocked: this.blocked, claudeFound: this.claudeFound,
      containment: this.core.containment.kind, orphansKilled: this.core.orphans.killed.length,
    };
  }

  pickFolder(): Promise<string | null> { return this.opts.pickFolder(); }

  forbiddenWorkdirs(): ForbiddenDir[] {
    const out: ForbiddenDir[] = [{ dir: os.homedir(), kind: 'exact' }];
    for (const d of [process.env.APPDATA, process.env.LOCALAPPDATA, process.env.ProgramData, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432, process.env.SystemRoot, this.opts.dataDir, ...(this.opts.extraProtected ?? [])]) {
      if (d) out.push({ dir: d, kind: 'tree' });
    }
    const claude = this.opts.claudePath ?? resolveClaudeExecutable();
    if (claude) out.push({ dir: path.dirname(claude), kind: 'tree' });
    return out;
  }

  /** Fechar o app: interrompe com limpeza, encerra o que sobrou, solta o lock. */
  async shutdown(): Promise<void> {
    try { await this.orch.shutdown(); } catch { /* o próximo boot reconcilia */ }
    try { await this.supervisor?.shutdown(2000); } catch { /* idem */ }
    this.orch.dispose();
    await this.core.close();
  }
}
