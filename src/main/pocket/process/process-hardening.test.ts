import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PocketStore } from '../core/store';
import { bundleWorker } from '../testing/bundle';
import { driveTo, tmpDir } from '../testing/helpers';
import { TaskkillContainment } from './containment';
import { coreLockKey, lockName, LockBusyError, OsLock } from './os-lock';
import { getProcInfo, pidAlive } from './proc-info';
import { ProcessSupervisor, sweepOrphans, type ProcInfoApi } from './supervisor';

const tmp = tmpDir('pocket-proc2-');
const alive: ChildProcess[] = [];
let lockWorker = '';
beforeAll(() => { lockWorker = bundleWorker(path.resolve(__dirname, '../testing/lock-worker.ts'), tmp.dir); });
afterAll(() => { for (const p of alive) { try { p.kill('SIGKILL'); } catch { /* já morreu */ } } tmp.cleanup(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const GC = "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log('GC '+c.pid);setInterval(()=>{},1000)";
async function runningStore() {
  const store = PocketStore.open(':memory:');
  const t = driveTo(store, 'running');
  const sess = store.reserveSession(t.id);
  const run = store.beginRun({ taskId: t.id, sessionId: sess.id, kind: 'start' });
  return { store, run };
}
function grandchildPid(p: { stdout: NodeJS.ReadableStream }): Promise<number> {
  return new Promise((res) => p.stdout.on('data', (d: Buffer) => { const m = /GC (\d+)/.exec(String(d)); if (m) res(Number(m[1])); }));
}

describe('kill() derruba a árvore (o TerminateProcess da raiz não pode vir antes do /T)', () => {
  for (const sig of ['SIGKILL', 'SIGTERM'] as const) {
    it(`p.kill('${sig}') mata filho e neto`, async () => {
      const { store, run } = await runningStore();
      const sup = new ProcessSupervisor(store, new TaskkillContainment(), { trackIntervalMs: 0 });
      const p = sup.spawn({ command: process.execPath, args: ['-e', GC], cwd: process.cwd(), runId: run.id });
      const gc = await grandchildPid(p);
      p.kill(sig);
      await p.exited;
      await sleep(700);
      expect(pidAlive(p.pid)).toBe(false);
      expect(pidAlive(gc)).toBe(false);
      store.close();
    }, 30_000);
  }

  it('killTree em processo que já saiu não dispara taskkill no pid (reaproveitável)', async () => {
    const { store, run } = await runningStore();
    const calls: number[] = [];
    const spy = new TaskkillContainment();
    const orig = spy.killTree.bind(spy);
    spy.killTree = (pid) => { calls.push(pid); return orig(pid); };
    const sup = new ProcessSupervisor(store, spy, { trackIntervalMs: 0 });
    const p = sup.spawn({ command: process.execPath, args: ['-e', 'process.exit(0)'], cwd: process.cwd(), runId: run.id });
    await p.exited;
    await sup.killTree(p, 'teste');
    expect(calls).toEqual([]);
    store.close();
  }, 20_000);

  it('spawn recusado quando o fence foi perdido', async () => {
    const { store } = await runningStore();
    store.db.prepare('UPDATE core_owner SET fence = fence + 1').run();
    const sup = new ProcessSupervisor(store, new TaskkillContainment(), { trackIntervalMs: 0 });
    expect(() => sup.spawn({ command: process.execPath, args: ['-e', '0'], cwd: process.cwd(), runId: null })).toThrow(/fence/);
    store.close();
  });

  it('descendentes rastreados morrem quando o runner sai sozinho', async () => {
    const { store, run } = await runningStore();
    const sup = new ProcessSupervisor(store, new TaskkillContainment(), { trackIntervalMs: 250 });
    // runner que cria um neto "solto" (cmd /c) e sai depois de ser rastreado
    const script = "require('child_process').spawn('cmd',['/c','ping','-n','60','127.0.0.1'],{stdio:'ignore'});setTimeout(()=>process.exit(0),25000)";
    const p = sup.spawn({ command: process.execPath, args: ['-e', script], cwd: process.cwd(), runId: run.id });
    await vi.waitFor(() => expect(store.liveProcesses().filter((r) => r.role === 'descendant').length).toBeGreaterThan(0), { timeout: 20_000, interval: 250 });
    const tracked = store.liveProcesses().filter((r) => r.role === 'descendant');
    await p.exited;
    // a limpeza consulta o SO por descendente (centenas de ms cada): espera convergir
    await vi.waitFor(async () => {
      for (const r of tracked) {
        const cur = await getProcInfo(r.pid); // identidade = pid + tempo de criação (pid pode ser reaproveitado)
        expect(cur?.startTime === r.startTime, `descendente ${r.pid}`).toBe(false);
      }
    }, { timeout: 15_000, interval: 500 });
    expect(store.liveProcesses().filter((r) => r.role === 'descendant')).toHaveLength(0);
    store.close();
  }, 90_000);
});

describe('varredura de órfãos: salvaguardas', () => {
  it('exige o lock do core e o fence vigente', async () => {
    const { store } = await runningStore();
    await expect(sweepOrphans(store, new TaskkillContainment(), { held: false })).rejects.toThrow(/lock do core/);
    store.db.prepare('UPDATE core_owner SET fence = fence + 1').run();
    await expect(sweepOrphans(store, new TaskkillContainment(), { held: true })).rejects.toThrow(/fence/);
    store.close();
  });

  it('falha de consulta NÃO fecha a linha nem mata: fica para a próxima varredura', async () => {
    const { store } = await runningStore();
    const bystander = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    alive.push(bystander);
    store.recordProcess({ runId: null, pid: bystander.pid as number, startTime: 'qualquer', role: 'runner' });
    const failing: ProcInfoApi = { get: () => Promise.reject(new Error('powershell estourou o tempo')), list: () => Promise.resolve([]) };
    const report = await sweepOrphans(store, new TaskkillContainment(), { held: true }, failing);
    expect(report.unverified.map((u) => u.why)).toEqual(['query_failed']);
    expect(report.gone).toBe(0);
    expect(store.liveProcesses()).toHaveLength(1);
    expect(pidAlive(bystander.pid as number)).toBe(true);
    bystander.kill('SIGKILL');
    store.close();
  }, 20_000);
});

describe('lock: salvaguardas', () => {
  it('o nome depende do usuário e do caminho real; caminho inexistente cai no resolve', () => {
    const a = lockName('core', coreLockKey(path.join(tmp.dir, 'a.db')));
    const b = lockName('core', coreLockKey(path.join(tmp.dir, 'b.db')));
    expect(a).not.toBe(b);
    expect(a).toMatch(/^teracota-pocket-core-[0-9a-f]{24}$/);
  });

  it('a sonda não expõe nonce; só pid/label/since', async () => {
    const name = lockName('session', `probe-${Date.now()}`);
    const l = await OsLock.acquire(name, 'dono');
    const err = await OsLock.acquire(name, 'x').catch((e) => e);
    expect(err).toBeInstanceOf(LockBusyError);
    expect(Object.keys((err as LockBusyError).owner ?? {}).sort()).toEqual(['label', 'pid', 'since']);
    await l.release();
  });

  it('filho detached de longa duração do dono NÃO herda o handle: matar o dono libera o lock', async () => {
    const name = lockName('session', `inherit-${Date.now()}`);
    const w = spawn(process.execPath, [lockWorker, name, String(Date.now()), 'try'], { stdio: ['pipe', 'pipe', 'inherit'] });
    alive.push(w);
    await new Promise<void>((res) => w.stdout?.on('data', (d: Buffer) => { if (String(d).includes('WON')) res(); }));
    // o dono cria um filho detached que sobrevive a ele
    const sib = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
    alive.push(sib);
    w.kill('SIGKILL');
    await new Promise<void>((r) => w.once('exit', () => r()));
    const l = await OsLock.acquire(name, 'novo');
    expect(l.held).toBe(true);
    await l.release();
    sib.kill('SIGKILL');
  }, 30_000);
});

describe('caracterização: alcance do Job Object do libuv (não é garantia de árvore)', () => {
  it('neto criado via cmd.exe: registra o que acontece quando o host cai', async () => {
    if (process.platform !== 'win32') return;
    const { store, run } = await runningStore();
    const sup = new ProcessSupervisor(store, new TaskkillContainment(), { trackIntervalMs: 0 });
    const script = "require('child_process').spawn('cmd',['/c','ping','-n','120','127.0.0.1'],{stdio:'ignore'});setInterval(()=>{},1000)";
    const p = sup.spawn({ command: process.execPath, args: ['-e', script], cwd: process.cwd(), runId: run.id });
    await sleep(1500);
    // o filho direto é Node: o neto dele (cmd) é do job do filho, que morre com ele via cascata
    await sup.killTree(p, 'teste');
    await sleep(700);
    expect(pidAlive(p.pid)).toBe(false);
    store.close();
  }, 20_000);
});
