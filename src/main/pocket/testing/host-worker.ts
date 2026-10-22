// "Host" de teste: abre o store, spawna um runner falso (que cria um neto) e fica vivo até ser morto (kill -9).
//   modo "supervised": usa o ProcessSupervisor (filho normal → morre junto com o host via Job Object do libuv)
//   modo "detached"  : filho com breakaway (escapa do job) registrado no banco → caso da varredura de órfãos
import { spawn } from 'node:child_process';
import { PocketStore } from '../core/store';
import { TaskkillContainment } from '../process/containment';
import { getProcInfo } from '../process/proc-info';
import { ProcessSupervisor } from '../process/supervisor';
import { driveTo } from './helpers';

const [dbPath, mode] = process.argv.slice(2) as [string, 'supervised' | 'detached'];
const store = PocketStore.open(dbPath);
const t = driveTo(store, 'running');
const sess = store.reserveSession(t.id);
const run = store.beginRun({ taskId: t.id, sessionId: sess.id, kind: 'start' });
const grandchild = "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log('GC '+c.pid);setInterval(()=>{},1000)";
let pid = 0;
let gc = 0;
if (mode === 'supervised') {
  const sup = new ProcessSupervisor(store, new TaskkillContainment(), { trackIntervalMs: 300 });
  const p = sup.spawn({ command: process.execPath, args: ['-e', grandchild], cwd: process.cwd(), runId: run.id });
  pid = p.pid;
  p.stdout.on('data', (d: Buffer) => { const m = /GC (\d+)/.exec(String(d)); if (m) gc = Number(m[1]); });
} else {
  const c = spawn(process.execPath, ['-e', grandchild], { detached: true, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  pid = c.pid as number;
  c.unref();
  c.stdout?.on('data', (d: Buffer) => { const m = /GC (\d+)/.exec(String(d)); if (m) gc = Number(m[1]); });
  void getProcInfo(pid).then((i) => store.recordProcess({ runId: run.id, pid, startTime: i?.startTime ?? null, role: 'runner' }));
}
setTimeout(() => {
  void getProcInfo(gc).then((i) => {
    if (mode === 'detached') store.recordProcess({ runId: run.id, pid: gc, startTime: i?.startTime ?? null, role: 'descendant' });
    console.log(JSON.stringify({ ready: true, child: pid, gc, runId: run.id }));
  });
}, 2500);
setInterval(() => undefined, 1000);
