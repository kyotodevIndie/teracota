// Processo-filho de teste: escreve no store em loop até ser morto (kill -9).
import { PocketStore } from '../core/store';
import { newTask, step } from './helpers';

const dbPath = process.argv[2] as string;
const store = PocketStore.open(dbPath);
console.log('ready');
let n = 0;
for (;;) {
  const t = newTask(store);
  step(store, t.id, 'running');
  const sess = store.reserveSession(t.id);
  const run = store.beginRun({ taskId: t.id, sessionId: sess.id, kind: 'start' });
  store.appendEvent(run.id, 'activity', { kind: 'status' });
  step(store, t.id, 'interrupted');
  step(store, t.id, 'running');
  step(store, t.id, 'review');
  if (++n % 5 === 0) console.log(`iter ${n}`);
}
