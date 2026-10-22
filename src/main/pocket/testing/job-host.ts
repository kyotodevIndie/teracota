// Host de teste do Job Object: supervisor real + JobObjectContainment. O runner falso cria, via cmd.exe (intermediário
// que NÃO é Node/libuv), um processo em segundo plano — o cenário do Bash do agente. O host imprime a árvore e
// espera ser morto com kill -9.
import { PocketStore } from '../core/store';
import { JobObjectContainment } from '../process/job-object';
import { descendantsOf, listProcesses } from '../process/proc-info';
import { ProcessSupervisor } from '../process/supervisor';
import { driveTo } from './helpers';

const [dbPath] = process.argv.slice(2) as [string];
const store = PocketStore.open(dbPath);
const t = driveTo(store, 'running');
const sess = store.reserveSession(t.id);
const run = store.beginRun({ taskId: t.id, sessionId: sess.id, kind: 'start' });
const sup = new ProcessSupervisor(store, JobObjectContainment.create(), { trackIntervalMs: 0 });
const runner = "require('child_process').spawn('cmd',['/c','ping','-n','300','127.0.0.1'],{stdio:'ignore',detached:true}).unref();setInterval(()=>{},1000)";
const p = sup.spawn({ command: process.execPath, args: ['-e', runner], cwd: process.cwd(), runId: run.id });
void p.ready.then(async () => {
  await new Promise((r) => setTimeout(r, 2500));
  const tree = descendantsOf(await listProcesses(), p.pid).map((d) => ({ pid: d.pid, startTime: d.startTime, name: d.name }));
  console.log(JSON.stringify({ ready: true, contained: p.contained, child: p.pid, tree }));
});
setInterval(() => undefined, 1000);
