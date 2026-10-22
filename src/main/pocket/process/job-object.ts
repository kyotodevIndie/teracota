// Windows Job Object com JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE via `koffi` (FFI N-API; dependência aprovada).
// Um job POR execução: todo processo do runner e TODOS os seus descendentes (inclusive os que o Bash do agente
// lança em segundo plano) entram no mesmo job, sem flags de breakaway. Fechar o handle (fim da execução, kill
// da árvore, queda do host) encerra tudo que está nele — o SO faz isso, não código nosso.
//
// Limites (não declarar isolamento absoluto):
//  - o processo é associado DEPOIS de nascer (o stdin do runner só abre após a associação, então ele não
//    recebe prompt nem executa comando antes); código do próprio `claude` rodando no intervalo de
//    inicialização pode criar filhos antes da associação — a varredura posterior os traz ao job, mas isso
//    não é garantia estrita;
//  - um processo pode sair do job se o SO/ele próprio tiver privilégio para tal (ex.: CREATE_BREAKAWAY_FROM_JOB
//    com o job configurado para permiti-lo — o nosso não permite); processos de serviço do Windows (WMI, Task
//    Scheduler, `schtasks`/`sc start`, `wmic process call create`), pedidos a processos já em execução (explorer.exe, associação
//    de arquivos/DDE) e servidores COM/DCOM executam fora do job por natureza;
//  - não substitui sandbox: o job não limita leitura/escrita/rede.
import { createRequire } from 'node:module';
import path from 'node:path';
import type { AdoptResult, Containment } from './containment';
import { TaskkillContainment } from './containment';
import { descendantsOf, listProcesses } from './proc-info';

export class JobObjectError extends Error {
  constructor(message: string) { super(message); this.name = 'JobObjectError'; }
}

const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9;
const PROCESS_SET_QUOTA = 0x0100;
const PROCESS_TERMINATE = 0x0001;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

/** API do Win32 usada (injetável nos testes para simular falhas). */
export interface Win32Jobs {
  createJob(): unknown;
  setKillOnClose(job: unknown): boolean;
  openProcess(pid: number): unknown;
  assign(job: unknown, proc: unknown): boolean;
  isInJob(proc: unknown, job: unknown): boolean;
  closeHandle(h: unknown): void;
}

interface Koffi {
  load(lib: string): { func(sig: string): (...a: unknown[]) => unknown };
  struct(name: string, def: Record<string, unknown>): unknown;
  sizeof(t: unknown): number;
}

let cachedApi: Win32Jobs | null = null; // os nomes de tipo do koffi são globais: declarar uma vez só

export function loadWin32Jobs(requireFrom: string = __filename): Win32Jobs {
  if (cachedApi) return cachedApi;
  if (process.platform !== 'win32') throw new JobObjectError('Job Objects só existem no Windows');
  let koffi: Koffi | null = null;
  let lastErr = '';
  // __filename (app empacotado: dist/main.js → node_modules do app) e, como reserva, a pasta de trabalho (testes)
  for (const from of [requireFrom, path.join(process.cwd(), 'noop.js')]) {
    try { koffi = createRequire(from)('koffi') as Koffi; break; } catch (e) { lastErr = (e as Error).message; }
  }
  if (!koffi) throw new JobObjectError(`koffi indisponível: ${lastErr.slice(0, 120)}`);
  try {
    const k32 = koffi.load('kernel32.dll');
    const basic = koffi.struct('JOBOBJECT_BASIC_LIMIT_INFORMATION', {
      PerProcessUserTimeLimit: 'int64', PerJobUserTimeLimit: 'int64', LimitFlags: 'uint32',
      MinimumWorkingSetSize: 'size_t', MaximumWorkingSetSize: 'size_t', ActiveProcessLimit: 'uint32',
      Affinity: 'uintptr_t', PriorityClass: 'uint32', SchedulingClass: 'uint32',
    });
    const io = koffi.struct('IO_COUNTERS', { a: 'uint64', b: 'uint64', c: 'uint64', d: 'uint64', e: 'uint64', f: 'uint64' });
    const ext = koffi.struct('JOBOBJECT_EXTENDED_LIMIT_INFORMATION', {
      BasicLimitInformation: basic, IoInfo: io, ProcessMemoryLimit: 'size_t', JobMemoryLimit: 'size_t',
      PeakProcessMemoryUsed: 'size_t', PeakJobMemoryUsed: 'size_t',
    });
    const create = k32.func('void* __stdcall CreateJobObjectW(void*, str16)');
    const setInfo = k32.func('int __stdcall SetInformationJobObject(void*, int, _In_ JOBOBJECT_EXTENDED_LIMIT_INFORMATION*, uint32)');
    const assign = k32.func('int __stdcall AssignProcessToJobObject(void*, void*)');
    const inJob = k32.func('int __stdcall IsProcessInJob(void*, void*, _Out_ int*)');
    const open = k32.func('void* __stdcall OpenProcess(uint32, int, uint32)');
    const close = k32.func('int __stdcall CloseHandle(void*)');
    const size = koffi.sizeof(ext);
    cachedApi = {
      createJob: () => create(null, null),
      setKillOnClose: (job) => setInfo(job, JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
        { BasicLimitInformation: { LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE }, IoInfo: {} }, size) !== 0,
      openProcess: (pid) => open(PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid),
      assign: (job, proc) => assign(job, proc) !== 0,
      isInJob: (proc, job) => { const out = [0]; return inJob(proc, job, out) !== 0 && out[0] !== 0; },
      closeHandle: (h) => { close(h); },
    };
    return cachedApi;
  } catch (e) {
    throw new JobObjectError(`falha ao preparar a API do Win32: ${(e as Error).message.slice(0, 120)}`);
  }
}

export class JobObjectContainment implements Containment {
  readonly kind = 'job-object' as const;
  readonly required = true;
  private readonly jobs = new Map<number, unknown>();
  private readonly fallback = new TaskkillContainment();

  private constructor(private readonly api: Win32Jobs) {}

  /** Falha (JobObjectError) se a API ou um job de teste não puderem ser criados: o chamador NÃO deve executar comandos. */
  static create(api: Win32Jobs = loadWin32Jobs()): JobObjectContainment {
    const probe = api.createJob();
    if (!probe) throw new JobObjectError('CreateJobObject falhou');
    const ok = api.setKillOnClose(probe);
    api.closeHandle(probe);
    if (!ok) throw new JobObjectError('SetInformationJobObject(KILL_ON_JOB_CLOSE) falhou');
    return new JobObjectContainment(api);
  }

  async adopt(pid: number): Promise<AdoptResult> {
    const job = this.api.createJob();
    if (!job) return { assigned: false, guaranteed: false, note: 'CreateJobObject falhou' };
    if (!this.api.setKillOnClose(job)) { this.api.closeHandle(job); return { assigned: false, guaranteed: false, note: 'KILL_ON_JOB_CLOSE não aplicado' }; }
    const h = this.api.openProcess(pid);
    if (!h) { this.api.closeHandle(job); return { assigned: false, guaranteed: false, note: 'OpenProcess falhou' }; }
    try {
      if (!this.api.assign(job, h) || !this.api.isInJob(h, job)) {
        this.api.closeHandle(job);
        return { assigned: false, guaranteed: false, note: 'AssignProcessToJobObject falhou' };
      }
    } finally { this.api.closeHandle(h); }
    this.jobs.set(pid, job);
    // mitiga a corrida: descendentes nascidos antes da associação também entram (sem bloquear a liberação do stdin)
    void this.sweepDescendants(pid, job);
    return { assigned: true, guaranteed: false, note: 'job ativo (KILL_ON_JOB_CLOSE); corrida de inicialização mitigada, não eliminada' };
  }

  private async sweepDescendants(pid: number, job: unknown): Promise<void> {
    try {
      for (const d of descendantsOf(await listProcesses(), pid)) {
        if (this.jobs.get(pid) !== job) return; // o job foi fechado enquanto a consulta rodava: o handle pode ter sido reciclado
        const h = this.api.openProcess(d.pid);
        if (!h) continue;
        try { if (!this.api.isInJob(h, job)) this.api.assign(job, h); } finally { this.api.closeHandle(h); }
      }
    } catch { /* best-effort */ }
  }

  /** Fecha o job do pid: o SO encerra o runner e todos os descendentes que ainda estiverem nele. */
  release(pid: number): void {
    const job = this.jobs.get(pid);
    if (job === undefined) return;
    this.jobs.delete(pid);
    this.api.closeHandle(job);
  }

  async killTree(pid: number): Promise<void> {
    this.release(pid);
    await this.fallback.killTree(pid); // cinto e suspensório se a associação falhou ou o pid já saiu do job
  }

  killPid(pid: number): Promise<void> { return this.fallback.killPid(pid); }

  dispose(): void {
    for (const pid of [...this.jobs.keys()]) this.release(pid);
  }

  get activeJobs(): number { return this.jobs.size; }
}
