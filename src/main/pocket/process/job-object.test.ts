import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PocketStore } from '../core/store';
import { bundleWorker } from '../testing/bundle';
import { driveTo, tmpDir } from '../testing/helpers';
import { JobObjectContainment, JobObjectError, loadWin32Jobs, type Win32Jobs } from './job-object';
import { lockName, coreLockKey, OsLock } from './os-lock';
import { getProcInfo, pidAlive } from './proc-info';
import { ProcessSupervisor, sweepOrphans } from './supervisor';
import { PocketService } from '../service';

const win = process.platform === 'win32';
const tmp = tmpDir('pocket-job-');
let jobHost = '';
const alive: ChildProcess[] = [];
beforeAll(() => { if (win) jobHost = bundleWorker(path.resolve(__dirname, '../testing/job-host.ts'), tmp.dir); });
afterAll(() => { for (const p of alive) { try { p.kill('SIGKILL'); } catch { /* já morreu */ } } tmp.cleanup(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** identidade = pid + tempo de criação (o pid pode ser reaproveitado) */
async function stillThere(x: { pid: number; startTime: string | null }): Promise<boolean> {
  if (!pidAlive(x.pid)) return false;
  const cur = await getProcInfo(x.pid).catch(() => null);
  return !!cur && cur.startTime === x.startTime;
}

function running() {
  const store = PocketStore.open(':memory:');
  const t = driveTo(store, 'running');
  const sess = store.reserveSession(t.id);
  const run = store.beginRun({ taskId: t.id, sessionId: sess.id, kind: 'start' });
  return { store, run };
}
const BG = "require('child_process').spawn('cmd',['/c','ping','-n','300','127.0.0.1'],{stdio:'ignore',detached:true}).unref();console.log('UP');setInterval(()=>{},1000)";

async function treeOf(p: { pid: number }) {
  const { descendantsOf, listProcesses } = await import('./proc-info');
  return descendantsOf(await listProcesses(), p.pid).map((d) => ({ pid: d.pid, startTime: d.startTime }));
}

describe.runIf(win)('Job Object (KILL_ON_JOB_CLOSE) com processos reais', () => {
  it('cria; associa o runner antes de abrir o stdin; descendente via cmd.exe entra no mesmo job', async () => {
    const { store, run } = running();
    const jobs = JobObjectContainment.create();
    const sup = new ProcessSupervisor(store, jobs, { trackIntervalMs: 0 });
    const p = sup.spawn({ command: process.execPath, args: ['-e', "process.stdin.on('data',d=>process.stdout.write('ECO:'+d));console.log('PRONTO');setInterval(()=>{},1000)"], cwd: process.cwd(), runId: run.id });
    let out = '';
    p.stdout.on('data', (d: Buffer) => { out += d; });
    p.stdin.write('antes-da-associacao\n'); // entra no portão
    await p.ready;
    expect(p.contained).toBe(true);
    expect(jobs.activeJobs).toBe(1);
    await vi.waitFor(() => expect(out).toContain('ECO:antes-da-associacao'), { timeout: 10_000 }); // o portão abriu só depois
    p.kill('SIGKILL');
    await p.exited;
    await sleep(300);
    expect(jobs.activeJobs).toBe(0);
    store.close();
  }, 30_000);

  it('encerramento normal: o que o runner deixou em segundo plano morre com o fim da execução', async () => {
    const { store, run } = running();
    const jobs = JobObjectContainment.create();
    const sup = new ProcessSupervisor(store, jobs, { trackIntervalMs: 0 });
    const p = sup.spawn({ command: process.execPath, args: ['-e', BG], cwd: process.cwd(), runId: run.id });
    await p.ready;
    await new Promise<void>((res) => p.stdout.on('data', () => res()));
    await sleep(2500);
    const tree = await treeOf(p);
    expect(tree.length).toBeGreaterThan(0); // cmd + ping
    expect(await Promise.all(tree.map(stillThere))).toContain(true);
    p.stdin.end(); // fim "normal": o runner sai quando o stdin fecha? (não: setInterval) → matamos limpo
    await sup.killTree(p, 'fim-normal');
    await p.exited;
    await sleep(1500);
    for (const x of tree) expect(await stillThere(x), `descendente ${x.pid}`).toBe(false);
    store.close();
  }, 60_000);

  it('interrupção forçada (kill) derruba runner e a árvore inteira', async () => {
    const { store, run } = running();
    const jobs = JobObjectContainment.create();
    const sup = new ProcessSupervisor(store, jobs, { trackIntervalMs: 0 });
    const p = sup.spawn({ command: process.execPath, args: ['-e', BG], cwd: process.cwd(), runId: run.id });
    await p.ready;
    await sleep(3000);
    const tree = await treeOf(p);
    p.kill('SIGKILL');
    await p.exited;
    await sleep(1500);
    expect(pidAlive(p.pid)).toBe(false);
    for (const x of tree) expect(await stillThere(x), `descendente ${x.pid}`).toBe(false);
    store.close();
  }, 60_000);

  it('CRASH do host (kill -9): runner e processos em segundo plano morrem sem depender de código nosso; recuperação não acha órfãos', async () => {
    const dbPath = path.join(tmp.dir, 'crash-job.db');
    const h = spawn(process.execPath, [jobHost, dbPath], { stdio: ['ignore', 'pipe', 'inherit'] });
    alive.push(h);
    let buf = '';
    h.stdout?.on('data', (d: Buffer) => { buf += d; });
    for (let i = 0; i < 160 && !buf.includes('"ready"'); i++) await sleep(250);
    const info = JSON.parse(/\{"ready".*\}/.exec(buf)?.[0] ?? '{}') as { contained: boolean; child: number; tree: { pid: number; startTime: string | null; name: string }[] };
    expect(info.contained).toBe(true);
    expect(info.tree.some((x) => /ping/i.test(x.name))).toBe(true); // o processo em segundo plano existe
    h.kill('SIGKILL');
    await new Promise<void>((r) => h.once('exit', () => r()));
    await sleep(2000);
    for (const x of info.tree) expect(await stillThere(x), `${x.name} ${x.pid}`).toBe(false);
    expect(pidAlive(info.child)).toBe(false);
    // recuperação: a varredura do próximo boot não encontra nada vivo
    const store = PocketStore.open(dbPath);
    const report = await sweepOrphans(store, JobObjectContainment.create(), { held: true });
    expect(report.killed).toHaveLength(0);
    expect(store.liveProcesses()).toHaveLength(0);
    store.close();
  }, 90_000);
});

describe.runIf(win)('fim da execução e corridas', () => {
  it('fim NORMAL: o runner sai sozinho e o que ficou em segundo plano morre (exit → release)', async () => {
    const { store, run } = running();
    const jobs = JobObjectContainment.create();
    const sup = new ProcessSupervisor(store, jobs, { trackIntervalMs: 0 });
    const script = "require('child_process').spawn('cmd',['/c','ping','-n','300','127.0.0.1'],{stdio:'ignore',detached:true}).unref();console.log('UP');setTimeout(()=>process.exit(0),9000)";
    const p = sup.spawn({ command: process.execPath, args: ['-e', script], cwd: process.cwd(), runId: run.id });
    await p.ready;
    await new Promise<void>((res) => p.stdout.on('data', () => res()));
    await sleep(2500);
    const tree = await treeOf(p);
    expect(tree.length).toBeGreaterThan(0);
    await p.exited; // saiu sozinho
    await vi.waitFor(async () => { for (const x of tree) expect(await stillThere(x), `descendente ${x.pid}`).toBe(false); }, { timeout: 15_000, interval: 500 });
    expect(jobs.activeJobs).toBe(0);
    store.close();
  }, 60_000);

  it('exit ANTES de a associação terminar: nenhum job vazado, nenhum taskkill em pid reaproveitado', async () => {
    const { store, run } = running();
    const jobs = JobObjectContainment.create();
    const killed: number[] = [];
    const orig = jobs.killTree.bind(jobs);
    jobs.killTree = (pid) => { killed.push(pid); return orig(pid); };
    const sup = new ProcessSupervisor(store, jobs, { trackIntervalMs: 0 });
    for (let i = 0; i < 5; i++) {
      const p = sup.spawn({ command: process.execPath, args: ['-e', 'process.exit(0)'], cwd: process.cwd(), runId: run.id });
      await p.ready;
      await p.exited;
    }
    await sleep(500);
    expect(jobs.activeJobs).toBe(0);
    expect(killed).toEqual([]);
    store.close();
  }, 60_000);
});

describe('falha segura', () => {
  const failing = (over: Partial<Win32Jobs>): Win32Jobs => ({
    createJob: () => ({}), setKillOnClose: () => true, openProcess: () => ({}), assign: () => true, isInJob: () => true, closeHandle: () => undefined, ...over,
  });

  it('não cria o containment se CreateJobObject ou KILL_ON_JOB_CLOSE falharem', () => {
    expect(() => JobObjectContainment.create(failing({ createJob: () => null }))).toThrow(JobObjectError);
    expect(() => JobObjectContainment.create(failing({ setKillOnClose: () => false }))).toThrow(/KILL_ON_JOB_CLOSE/);
  });

  it('associação falha: o runner NÃO recebe entrada, é encerrado e o erro é registrado', async () => {
    const { store, run } = running();
    const sup = new ProcessSupervisor(store, JobObjectContainment.create(failing({ assign: () => false })), { trackIntervalMs: 0 });
    const p = sup.spawn({ command: process.execPath, args: ['-e', "process.stdin.on('data',d=>process.stdout.write('RECEBEU:'+d));setInterval(()=>{},1000)"], cwd: process.cwd(), runId: run.id });
    let out = '';
    let err: Error | null = null;
    p.stdout.on('data', (d: Buffer) => { out += d; });
    p.on('error', (e: Error) => { err = e; });
    p.stdin.write('prompt-que-nao-pode-chegar\n');
    await p.ready;
    await p.exited;
    expect(p.contained).toBe(false);
    expect(p.containFailure).toMatch(/Assign/i);
    expect(out).not.toContain('RECEBEU');
    expect((err as Error | null)?.message).toMatch(/contenção/);
    expect(store.journalSince(0).some((e) => e.reason === 'containment_failed')).toBe(true);
    store.close();
  }, 30_000);

  it('OpenProcess/IsProcessInJob falham: mesma recusa', async () => {
    for (const over of [{ openProcess: () => null }, { isInJob: () => false }] as Partial<Win32Jobs>[]) {
      const { store, run } = running();
      const sup = new ProcessSupervisor(store, JobObjectContainment.create(failing(over)), { trackIntervalMs: 0 });
      const p = sup.spawn({ command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: process.cwd(), runId: run.id });
      await p.ready;
      await p.exited;
      expect(p.containFailure).toBeTruthy();
      store.close();
    }
  }, 30_000);

  it('PocketService não sobe sem Job Object: lança antes de abrir o banco ou tomar o lock do core', async () => {
    const dir = path.join(tmp.dir, 'svc-sem-job');
    await expect(PocketService.start({
      dataDir: dir, pickFolder: async () => null, onChanged: () => undefined,
      containmentFactory: () => { throw new JobObjectError('koffi indisponível (simulado)'); },
    })).rejects.toThrow(JobObjectError);
    expect(existsSync(path.join(dir, 'pocket.db'))).toBe(false);
    const lock = await OsLock.acquire(lockName('core', coreLockKey(path.join(dir, 'pocket.db'))), 'depois'); // o lock não ficou preso
    await lock.release();
  });

  it.runIf(win)('loadWin32Jobs carrega a API real e cria um job de verdade', () => {
    const api = loadWin32Jobs();
    const j = api.createJob();
    expect(j).toBeTruthy();
    expect(api.setKillOnClose(j)).toBe(true);
    api.closeHandle(j);
  });
});
