// Supervisor de processos do runner: spawn registrado no banco (pid + tempo de criação), encerramento
// limpo/forçado da árvore, rastreio de descendentes e varredura de órfãos após crash.
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, type Readable, type Writable } from 'node:stream';
import type { PocketStore } from '../core/store';
import type { Containment } from './containment';
import { descendantsOf, getProcInfo, listProcesses, pidAlive, type ProcInfo } from './proc-info';

export interface SpawnSpec {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  runId: string | null;
  role?: string;
}

export interface ProcInfoApi {
  get(pid: number): Promise<ProcInfo | null>;
  list(): Promise<ProcInfo[]>;
}
const defaultInfo: ProcInfoApi = { get: getProcInfo, list: listProcesses };

export interface SupervisorOptions {
  /** Intervalo do rastreio de descendentes (0 desliga). */
  trackIntervalMs?: number;
  info?: ProcInfoApi;
}

/** Estruturalmente compatível com `SpawnedProcess` do Agent SDK. */
export class ManagedProcess extends EventEmitter {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly pid: number;
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  startTime: string | null = null;
  runId: string | null = null;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  private tail = '';
  /** @internal */ dbId = 0;
  /** @internal */ timer: NodeJS.Timeout | null = null;
  /** @internal */ tracking = false;

  /** Associação ao mecanismo de contenção concluída (Job Object)? */
  contained = false;
  containNote: string | null = null;
  /** Falha segura: a associação falhou e o processo foi encerrado sem receber entrada. */
  containFailure: string | null = null;
  /** Resolve quando a associação terminou (com sucesso ou falha). */
  ready: Promise<void> = Promise.resolve();
  /** @internal */ readonly child: ChildProcess;
  /** @internal */ gate: PassThrough | null = null;

  constructor(child: ChildProcess, private readonly onKill: (p: ManagedProcess) => Promise<void>, gate: PassThrough | null = null) {
    super();
    this.child = child;
    this.pid = child.pid as number;
    // com contenção obrigatória o stdin é um portão: nada chega ao runner antes da associação ao Job Object
    this.gate = gate;
    this.stdin = gate ?? (child.stdin as Writable);
    this.stdout = child.stdout as Readable;
    this.stderr = child.stderr as Readable;
    child.stderr?.on('data', (d: Buffer) => { this.tail = (this.tail + d.toString()).slice(-4096); });
    this.exited = new Promise((resolve) => {
      child.once('exit', (code, signal) => {
        this.exitCode = code;
        this.signalCode = signal;
        resolve({ code, signal });
        this.emit('exit', code, signal);
      });
    });
    child.once('error', (e) => this.emit('error', e));
  }

  /** Cauda do stderr (só em memória, para classificar erros; nunca persistida). */
  stderrTail(): string { return this.tail; }

  /** No Windows qualquer kill é TerminateProcess só da raiz: a árvore cai ANTES, senão o /T não acha o pai. */
  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    if (!this.alive) return false;
    this.killed = true;
    if (process.platform === 'win32' || signal === 'SIGKILL') {
      void this.onKill(this).finally(() => { if (this.alive) this.child.kill(signal); });
      return true;
    }
    return this.child.kill(signal);
  }

  /** Fecha o stdin e espera a saída por até `ms`; devolve true se saiu sozinho. */
  async closeAndWait(ms: number): Promise<boolean> {
    try { this.stdin.end(); } catch { /* já fechado */ }
    if (this.exitCode !== null || this.signalCode !== null) return true;
    let t: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((r) => { t = setTimeout(() => r(false), ms); });
    const ok = await Promise.race([this.exited.then(() => true as const), timeout]);
    if (t) clearTimeout(t);
    return ok;
  }

  get alive(): boolean { return this.exitCode === null && this.signalCode === null; }
}

export class ProcessSupervisor {
  private readonly procs = new Set<ManagedProcess>();
  private readonly info: ProcInfoApi;
  private readonly trackMs: number;

  constructor(readonly store: PocketStore, readonly containment: Containment, opts: SupervisorOptions = {}) {
    this.info = opts.info ?? defaultInfo;
    this.trackMs = opts.trackIntervalMs ?? 15_000;
  }

  get running(): readonly ManagedProcess[] { return [...this.procs]; }

  spawn(spec: SpawnSpec): ManagedProcess {
    if (!this.store.fenceIsCurrent()) throw new Error('fence perdido: outro dono assumiu o banco; não vou criar processos');
    const child = nodeSpawn(spec.command, spec.args, {
      cwd: spec.cwd, env: spec.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true, detached: process.platform !== 'win32',
    });
    if (!child.pid) {
      child.once('error', () => undefined);
      throw new Error(`falha ao iniciar ${spec.command}`);
    }
    child.stdin?.on('error', () => undefined); // EPIPE/ECONNRESET quando o runner morre com escrita pendente
    const gate = this.containment.required ? new PassThrough() : null;
    const p = new ManagedProcess(child, (m) => this.killTree(m, 'kill_requested'), gate);
    p.runId = spec.runId;
    this.procs.add(p);
    const role = spec.role ?? 'runner';
    try {
      p.dbId = this.store.recordProcess({ runId: spec.runId, pid: p.pid, startTime: null, role });
    } catch (e) {
      this.procs.delete(p);
      void this.containment.killTree(p.pid);
      throw e; // processo sem registro não pode ficar vivo
    }
    void this.captureStartTime(p);
    p.ready = this.containment.adopt(p.pid).then((r) => {
      p.contained = r.assigned;
      p.containNote = r.note ?? null;
      // o runner já saiu antes de a associação terminar: o release do exit passou em branco; fecha o job agora
      if (r.assigned && !p.alive) { this.containment.release(p.pid); return; }
      if (!gate) return;
      if (r.assigned) { gate.on('error', () => undefined); gate.pipe(child.stdin as Writable); return; }
      return this.failSafe(p, r.note ?? 'associação ao Job Object falhou');
    }, (e: unknown) => (gate ? this.failSafe(p, (e as Error).message) : undefined));
    p.once('exit', () => {
      this.procs.delete(p);
      if (p.timer) clearInterval(p.timer);
      this.containment.release(p.pid); // Job Object: fecha o handle → o SO encerra o que o runner deixou em segundo plano
      try { this.store.endProcess(p.dbId, p.signalCode ? `signal:${p.signalCode}` : `exit:${p.exitCode}`); } catch { /* store fechado no shutdown */ }
      void this.reapDescendants(p, 'runner_exited'); // política: descendentes verificados morrem com o runner
    });
    if (this.trackMs > 0) {
      const known = new Set<string>();
      p.timer = setInterval(() => { void this.trackDescendants(p, spec.runId, known); }, this.trackMs);
      p.timer.unref();
    }
    return p;
  }

  /** Contenção obrigatória que falhou: o runner nunca recebeu entrada; encerra tudo e avisa. */
  private async failSafe(p: ManagedProcess, why: string): Promise<void> {
    p.containFailure = why;
    try { this.store.note(null, 'containment_failed', { pid: p.pid, why: why.slice(0, 120) }, p.runId); } catch { /* store fechado */ }
    // pid de processo que já saiu pode ter sido reaproveitado: só mata a árvore se ele ainda está vivo
    if (p.alive) {
      await this.containment.killTree(p.pid);
      try { p.child.kill('SIGKILL'); } catch { /* já morreu */ }
    }
    p.gate?.destroy(); // escritas pendentes do SDK não ficam sem callback
    if (p.listenerCount('error') > 0) p.emit('error', new Error(`contenção do processo falhou (${why}); execução recusada`));
  }

  private async captureStartTime(p: ManagedProcess): Promise<void> {
    for (let i = 0; i < 3 && p.alive; i++) {
      try {
        const info = await this.info.get(p.pid);
        if (info?.startTime) {
          p.startTime = info.startTime;
          this.store.updateProcessStartTime(p.dbId, info.startTime);
          return;
        }
      } catch { /* tenta de novo */ }
    }
  }

  private async trackDescendants(p: ManagedProcess, runId: string | null, known: Set<string>): Promise<void> {
    if (!p.alive || p.tracking) return; // sem consultas sobrepostas (cada uma abre um PowerShell)
    p.tracking = true;
    try {
      for (const d of descendantsOf(await this.info.list(), p.pid)) {
        const key = `${d.pid}@${d.startTime}`;
        if (known.has(key) || !d.startTime) continue;
        known.add(key);
        this.store.recordProcess({ runId, pid: d.pid, startTime: d.startTime, role: 'descendant' });
      }
    } catch { /* rastreio é best-effort */ } finally { p.tracking = false; }
  }

  /** Encerramento forçado da árvore e dos descendentes registrados. */
  async killTree(p: ManagedProcess, reason: string): Promise<void> {
    if (p.alive) await this.containment.killTree(p.pid); // pid de processo já morto pode ter sido reaproveitado
    await this.reapDescendants(p, reason);
  }

  /** Mata os descendentes rastreados do run que ainda têm pid + tempo de criação idênticos. */
  private async reapDescendants(p: ManagedProcess, reason: string): Promise<void> {
    if (p.runId === null) return;
    let live: ReturnType<PocketStore['liveProcesses']> = [];
    try { live = this.store.liveProcesses().filter((r) => r.role === 'descendant' && r.runId === p.runId); } catch { return; }
    for (const r of live) {
      try {
        if (await this.matches(r.pid, r.startTime)) await this.containment.killPid(r.pid);
        this.store.endProcess(r.id, `killed:${reason}`);
      } catch { /* mantém a linha aberta: a varredura do próximo boot tenta de novo */ }
    }
  }

  private async matches(pid: number, startTime: string | null): Promise<boolean> {
    if (!startTime || !pidAlive(pid)) return false;
    const i = await this.info.get(pid).catch(() => null);
    return i?.startTime === startTime;
  }

  /** Encerra tudo (fechar o app). Limpo primeiro, forçado depois. */
  async shutdown(graceMs = 3000): Promise<void> {
    const all = [...this.procs];
    await Promise.all(all.map(async (p) => {
      if (!(await p.closeAndWait(graceMs))) await this.killTree(p, 'shutdown');
    }));
    for (const p of all) if (p.timer) clearInterval(p.timer);
  }
}

export interface OrphanReport {
  killed: { pid: number; runId: string | null; role: string }[];
  /** Vivos mas sem identidade comprovada (pid reaproveitado ou tempo de criação ausente): NÃO foram mortos. */
  unverified: { pid: number; runId: string | null; role: string; why: 'start_time_mismatch' | 'start_time_unknown' | 'query_failed' }[];
  gone: number;
}

/**
 * R4: processos registrados como vivos no banco que não pertencem a este supervisor (host anterior
 * morreu). Mata só com identidade exata (pid + tempo de criação). Nunca mata por pid isolado.
 */
export async function sweepOrphans(
  store: PocketStore, containment: Containment, coreLock: { readonly held: boolean }, info: ProcInfoApi = defaultInfo,
): Promise<OrphanReport> {
  // sem ser o dono do core, "órfão" pode ser o runner VIVO de outra instância
  if (!coreLock.held || !store.fenceIsCurrent()) throw new Error('sweepOrphans exige o lock do core e o fence vigente');
  const report: OrphanReport = { killed: [], unverified: [], gone: 0 };
  const rows = store.liveProcesses();
  // runners primeiro: o kill da árvore já leva os descendentes
  rows.sort((a, b) => (a.role === 'runner' ? -1 : 1) - (b.role === 'runner' ? -1 : 1));
  for (const r of rows) {
    if (r.pid === process.pid) { store.endProcess(r.id, 'self'); continue; }
    let cur: ProcInfo | null = null;
    if (pidAlive(r.pid)) {
      try { cur = await info.get(r.pid); } catch {
        // falha de consulta não é processo ausente: mantém a linha aberta para a próxima varredura
        report.unverified.push({ pid: r.pid, runId: r.runId, role: r.role, why: 'query_failed' });
        continue;
      }
    }
    if (!cur) { store.endProcess(r.id, 'gone'); report.gone++; continue; }
    // sem tempo registrado (host caiu antes da captura assíncrona): só vale se o processo nasceu na janela do spawn
    const bornAt = cur.startTime ? Date.parse(cur.startTime) : Number.NaN;
    const windowOk = r.role === 'runner' && !r.startTime && Number.isFinite(bornAt) && bornAt >= r.spawnedAt - 2000 && bornAt <= r.spawnedAt + 10_000;
    if (!r.startTime && !windowOk) {
      store.endProcess(r.id, 'unverified:start_time_unknown');
      report.unverified.push({ pid: r.pid, runId: r.runId, role: r.role, why: 'start_time_unknown' });
    } else if (r.startTime && cur.startTime !== r.startTime) {
      store.endProcess(r.id, 'pid_reused');
      report.unverified.push({ pid: r.pid, runId: r.runId, role: r.role, why: 'start_time_mismatch' });
    } else {
      // árvore montada com verificação de tempo de criação (nunca /T por ppid cru)
      try {
        for (const d of descendantsOf(await info.list(), r.pid)) await containment.killPid(d.pid);
      } catch { /* os descendentes registrados são o plano B */ }
      await containment.killPid(r.pid);
      store.endProcess(r.id, 'orphan_killed');
      report.killed.push({ pid: r.pid, runId: r.runId, role: r.role });
    }
  }
  return report;
}
