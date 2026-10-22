import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PocketStore } from '../core/store';
import { bundleWorker } from '../testing/bundle';
import { driveTo, tmpDir } from '../testing/helpers';
import { TaskkillContainment } from './containment';
import { lockName, LockBusyError, OsLock } from './os-lock';
import { descendantsOf, getProcInfo, pidAlive } from './proc-info';
import { ProcessSupervisor, sweepOrphans } from './supervisor';

const tmp = tmpDir('pocket-proc-');
let lockWorker = '';
let hostWorker = '';
const alive: ChildProcess[] = [];
beforeAll(() => {
  lockWorker = bundleWorker(path.resolve(__dirname, '../testing/lock-worker.ts'), tmp.dir);
  hostWorker = bundleWorker(path.resolve(__dirname, '../testing/host-worker.ts'), tmp.dir);
});
afterAll(() => {
  for (const p of alive) { try { p.kill('SIGKILL'); } catch { /* já morreu */ } }
  tmp.cleanup();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uniq = (k: string) => lockName('session', `${k}-${Date.now()}-${Math.random()}`);

function lines(p: ChildProcess): { next(match: RegExp, ms?: number): Promise<string> } {
  let buf = '';
  const waiters: { re: RegExp; res: (s: string) => void }[] = [];
  p.stdout?.on('data', (d: Buffer) => {
    buf += d.toString();
    for (const w of [...waiters]) { const m = w.re.exec(buf); if (m) { waiters.splice(waiters.indexOf(w), 1); w.res(m[0]); } }
  });
  return {
    next: (re, ms = 20_000) => new Promise((res, rej) => {
      const m = re.exec(buf);
      if (m) return res(m[0]);
      const t = setTimeout(() => rej(new Error(`timeout esperando ${re}; saída: ${buf}`)), ms);
      waiters.push({ re, res: (s) => { clearTimeout(t); res(s); } });
    }),
  };
}
function launch(file: string, args: string[]): { p: ChildProcess; out: ReturnType<typeof lines> } {
  const p = spawn(process.execPath, [file, ...args], { stdio: ['pipe', 'pipe', 'inherit'] });
  alive.push(p);
  return { p, out: lines(p) };
}
const waitExit = (p: ChildProcess) => new Promise<void>((r) => { if (p.exitCode !== null) r(); else p.once('exit', () => r()); });

describe('lock nativo (exclusividade de execução)', () => {
  it('no mesmo processo: o 2º recebe LOCK_BUSY com a identidade do dono; liberar permite readquirir', async () => {
    const name = uniq('inproc');
    const a = await OsLock.acquire(name, 'dono-a');
    expect(a.held).toBe(true);
    const err = await OsLock.acquire(name, 'dono-b').catch((e) => e);
    expect(err).toBeInstanceOf(LockBusyError);
    expect((err as LockBusyError).owner?.pid).toBe(process.pid);
    expect((err as LockBusyError).owner?.label).toBe('dono-a');
    await a.release();
    expect(a.held).toBe(false);
    const b = await OsLock.acquire(name, 'dono-b');
    await b.release();
  });

  it('chaves diferentes não se bloqueiam; o nome é estável e não diferencia caixa no Windows', async () => {
    const a = await OsLock.acquire(uniq('k1'), 'a');
    const b = await OsLock.acquire(uniq('k2'), 'b');
    await a.release(); await b.release();
    if (process.platform === 'win32') expect(lockName('core', 'C:\\Dados\\x.db')).toBe(lockName('core', 'c:\\dados\\X.DB'));
    expect(lockName('slot', 'a')).not.toBe(lockName('session', 'a'));
  });

  it('6 processos disputando ao mesmo tempo: exatamente 1 vence (3 rodadas)', async () => {
    for (let round = 0; round < 3; round++) {
      const name = uniq(`race${round}`);
      const startAt = Date.now() + 2500;
      const ws = Array.from({ length: 6 }, () => launch(lockWorker, [name, String(startAt), 'try']));
      const results = await Promise.all(ws.map((w) => w.out.next(/WON|BUSY|ERR.*/)));
      expect(results.filter((r) => r === 'WON')).toHaveLength(1);
      expect(results.filter((r) => r === 'BUSY')).toHaveLength(5);
      for (const w of ws) w.p.kill('SIGKILL');
      await Promise.all(ws.map((w) => waitExit(w.p)));
    }
  }, 60_000);

  it('dono morto com kill -9: o lock é liberado na hora, sem lock obsoleto nem espera', async () => {
    const name = uniq('kill9');
    const w = launch(lockWorker, [name, String(Date.now()), 'try']);
    await w.out.next(/WON/);
    await expect(OsLock.acquire(name, 'x')).rejects.toBeInstanceOf(LockBusyError);
    w.p.kill('SIGKILL');
    await waitExit(w.p);
    const t0 = Date.now();
    const l = await OsLock.acquire(name, 'novo');
    expect(Date.now() - t0).toBeLessThan(1500);
    await l.release();
  }, 30_000);

  it('dono com event loop bloqueado por 3 s continua dono (sem janela de duplo dono)', async () => {
    const name = uniq('block');
    const w = launch(lockWorker, [name, String(Date.now()), 'block', '3000']);
    await w.out.next(/WON/);
    // o dono está bloqueado: não responde à sonda, mas o kernel ainda segura o nome
    await expect(OsLock.acquire(name, 'intruso')).rejects.toBeInstanceOf(LockBusyError);
    await w.out.next(/UNBLOCKED/);
    await expect(OsLock.acquire(name, 'intruso2')).rejects.toBeInstanceOf(LockBusyError);
    w.p.kill('SIGKILL');
    await waitExit(w.p);
  }, 30_000);
});

describe('informação de processos', () => {
  it('lê pid/ppid/tempo de criação do próprio processo e calcula descendentes', async () => {
    const me = await getProcInfo(process.pid);
    expect(me?.pid).toBe(process.pid);
    expect(me?.startTime).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(await getProcInfo(2_000_000_000)).toBeNull();
    const all = [
      { pid: 1, ppid: 0, startTime: '2024-01-01T00:00:10Z', name: 'a' },
      { pid: 2, ppid: 1, startTime: '2024-01-01T00:00:11Z', name: 'b' },
      { pid: 3, ppid: 2, startTime: '2024-01-01T00:00:12Z', name: 'c' },
      { pid: 4, ppid: 1, startTime: '2024-01-01T00:00:01Z', name: 'ppid-reaproveitado' },
    ];
    expect(descendantsOf(all, 1).map((p) => p.pid)).toEqual([2, 3]);
  }, 60_000);
});

describe('supervisor e encerramento da árvore', () => {
  it('spawn registra o processo; killTree mata filho e neto; exit é registrado', async () => {
    const store = PocketStore.open(':memory:');
    const t = driveTo(store, 'running');
    const sess = store.reserveSession(t.id);
    const run = store.beginRun({ taskId: t.id, sessionId: sess.id, kind: 'start' });
    const sup = new ProcessSupervisor(store, new TaskkillContainment(), { trackIntervalMs: 0 });
    const gc = "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log('GC '+c.pid);setInterval(()=>{},1000)";
    const p = sup.spawn({ command: process.execPath, args: ['-e', gc], cwd: process.cwd(), runId: run.id });
    const gcPid = await new Promise<number>((res) => p.stdout.on('data', (d: Buffer) => { const m = /GC (\d+)/.exec(String(d)); if (m) res(Number(m[1])); }));
    expect(store.liveProcesses().map((r) => r.pid)).toContain(p.pid);
    await sup.killTree(p, 'teste');
    await p.exited;
    await sleep(300);
    expect(pidAlive(p.pid)).toBe(false);
    expect(pidAlive(gcPid)).toBe(false);
    expect(store.liveProcesses().filter((r) => r.pid === p.pid)).toHaveLength(0);
    store.close();
  }, 30_000);

  it('encerramento limpo: fechar o stdin faz um filho cooperativo sair sozinho', async () => {
    const store = PocketStore.open(':memory:');
    const sup = new ProcessSupervisor(store, new TaskkillContainment(), { trackIntervalMs: 0 });
    const p = sup.spawn({ command: process.execPath, args: ['-e', "process.stdin.resume();process.stdin.on('end',()=>process.exit(0))"], cwd: process.cwd(), runId: null });
    expect(await p.closeAndWait(5000)).toBe(true);
    expect(p.exitCode).toBe(0);
    const q = sup.spawn({ command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: process.cwd(), runId: null });
    expect(await q.closeAndWait(300)).toBe(false); // não coopera: precisa de kill forçado
    await sup.killTree(q, 'teste');
    await q.exited;
    store.close();
  }, 30_000);
});

describe('processos órfãos após crash do host (R4)', () => {
  it('runner normal morre junto com o host (Job Object do libuv); a varredura não encontra nada vivo', async () => {
    const dbPath = path.join(tmp.dir, 'joined.db');
    const h = launch(hostWorker, [dbPath, 'supervised']);
    const ready = JSON.parse(await h.out.next(/{"ready".*}/, 40_000)) as { child: number; gc: number };
    expect(pidAlive(ready.child)).toBe(true);
    expect(pidAlive(ready.gc)).toBe(true);
    h.p.kill('SIGKILL');
    await waitExit(h.p);
    await sleep(1500);
    if (process.platform === 'win32') {
      expect(pidAlive(ready.child)).toBe(false);
      expect(pidAlive(ready.gc)).toBe(false);
    }
    const store = PocketStore.open(dbPath);
    const report = await sweepOrphans(store, new TaskkillContainment(), { held: true });
    expect(report.killed).toHaveLength(0);
    expect(store.liveProcesses()).toHaveLength(0);
    store.close();
  }, 90_000);

  it('runner com breakaway (detached) sobrevive ao host: a próxima inicialização mata runner e neto por pid + tempo de criação', async () => {
    const dbPath = path.join(tmp.dir, 'orphans.db');
    const h = launch(hostWorker, [dbPath, 'detached']);
    const ready = JSON.parse(await h.out.next(/\{"ready".*\}/, 40_000)) as { child: number; gc: number };
    expect(pidAlive(ready.child)).toBe(true);
    expect(pidAlive(ready.gc)).toBe(true);
    await sleep(1500); // dá tempo ao rastreio de descendentes
    h.p.kill('SIGKILL');
    await waitExit(h.p);
    // o runner escapou do job: é exatamente o cenário a limpar
    expect(pidAlive(ready.child)).toBe(true);

    const store = PocketStore.open(dbPath);
    const report = await sweepOrphans(store, new TaskkillContainment(), { held: true });
    expect(report.killed.map((k) => k.pid)).toContain(ready.child);
    await sleep(500);
    expect(pidAlive(ready.child)).toBe(false);
    expect(pidAlive(ready.gc)).toBe(false);
    expect(store.liveProcesses()).toHaveLength(0);
    // 2ª varredura: nada a fazer
    const again = await sweepOrphans(store, new TaskkillContainment(), { held: true });
    expect(again.killed).toHaveLength(0);
    store.close();
  }, 90_000);

  it('pid vivo mas com tempo de criação diferente (PID reaproveitado) NÃO é morto', async () => {
    const store = PocketStore.open(':memory:');
    const bystander = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    alive.push(bystander);
    const info = await getProcInfo(bystander.pid as number);
    store.recordProcess({ runId: null, pid: bystander.pid as number, startTime: '2001-01-01T00:00:00.0000000Z', role: 'runner' });
    store.recordProcess({ runId: null, pid: bystander.pid as number, startTime: null, role: 'runner' });
    store.db.prepare('UPDATE processes SET spawned_at = spawned_at - 3600000').run(); // nasceu muito depois do registro: não é o nosso
    const report = await sweepOrphans(store, new TaskkillContainment(), { held: true });
    expect(report.killed).toHaveLength(0);
    expect(report.unverified.map((u) => u.why).sort()).toEqual(['start_time_mismatch', 'start_time_unknown']);
    expect(pidAlive(bystander.pid as number)).toBe(true);
    expect(info?.startTime).toBeTruthy();
    bystander.kill('SIGKILL');
    store.close();
  }, 30_000);

  it('processo registrado que já morreu apenas é encerrado no registro', async () => {
    const store = PocketStore.open(':memory:');
    store.recordProcess({ runId: null, pid: 1_999_999_999, startTime: 'x', role: 'runner' });
    const report = await sweepOrphans(store, new TaskkillContainment(), { held: true });
    expect(report.gone).toBe(1);
    expect(store.liveProcesses()).toHaveLength(0);
    store.close();
  });
});
