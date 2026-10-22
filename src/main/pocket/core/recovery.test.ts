import { spawn, type ChildProcess } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundleWorker } from '../testing/bundle';
import { tmpDir } from '../testing/helpers';
import { PocketStore } from './store';

const tmp = tmpDir('pocket-rec-');
let worker = '';
beforeAll(() => { worker = bundleWorker(path.resolve(__dirname, '../testing/writer-worker.ts'), tmp.dir); });
afterAll(() => tmp.cleanup());

function startWorker(db: string): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [worker, db], { stdio: ['ignore', 'pipe', 'inherit'] });
    p.once('error', reject);
    p.stdout?.on('data', (d: Buffer) => { if (d.toString().includes('ready')) resolve(p); });
    p.once('exit', (c) => reject(new Error(`worker saiu cedo (${c})`)));
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function kill(p: ChildProcess): Promise<void> {
  return new Promise((r) => { p.removeAllListeners('exit'); p.once('exit', () => r()); p.kill('SIGKILL'); });
}

function consistency(db: DatabaseSync): void {
  expect((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check).toBe('ok');
  const cnt = (db.prepare('SELECT COUNT(*) AS n FROM journal').get() as { n: number }).n;
  if (cnt === 0) return;
  const gaps = db.prepare('SELECT COUNT(*) AS n, MAX(seq) AS m, MIN(seq) AS lo FROM journal').get() as { n: number; m: number; lo: number };
  expect(gaps.n).toBe(gaps.m - gaps.lo + 1); // sem buracos no journal
  const tasks = db.prepare('SELECT id, state FROM tasks').all() as { id: string; state: string }[];
  for (const t of tasks) {
    const last = db.prepare(`SELECT to_state FROM journal WHERE task_id = ? AND kind = 'transition' ORDER BY seq DESC LIMIT 1`).get(t.id) as { to_state: string };
    expect(last.to_state, `tarefa ${t.id}`).toBe(t.state); // projeção == último evento
  }
  expect((db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length).toBe(0);
}

describe('recuperação após crash (kill -9 em escrita)', () => {
  it('3 mortes seguidas: banco íntegro, journal sem buracos, estado == journal', async () => {
    const dbPath = path.join(tmp.dir, 'crash.db');
    for (let i = 0; i < 3; i++) {
      const w = await startWorker(dbPath);
      await sleep(400 + i * 150);
      await kill(w);
      const store = PocketStore.open(dbPath); // reabre (e fenceia o morto)
      consistency(store.db);
      expect(store.listTasks().length).toBeGreaterThan(0);
      store.close();
    }
  }, 60_000);

  it('leitor concorrente (WAL) enxerga sempre um snapshot consistente enquanto outro processo escreve', async () => {
    const dbPath = path.join(tmp.dir, 'readers.db');
    const w = await startWorker(dbPath);
    const ro = new DatabaseSync(dbPath, { readOnly: true });
    ro.exec('PRAGMA busy_timeout = 5000');
    const until = Date.now() + 1500;
    let reads = 0;
    while (Date.now() < until) {
      ro.exec('BEGIN');
      consistency(ro);
      ro.exec('COMMIT');
      reads++;
      await sleep(30);
    }
    ro.close();
    await kill(w);
    expect(reads).toBeGreaterThan(5);
  }, 60_000);

  it('o store morto não consegue mais gravar depois que outro processo assumiu (fence)', async () => {
    const dbPath = path.join(tmp.dir, 'fence.db');
    const a = PocketStore.open(dbPath);
    const w = await startWorker(dbPath); // o worker abre e fenceia `a`
    await kill(w); // (parado, para não disputar o lock de escrita com o loop do worker)
    expect(() => a.issueGesture('create_task', null)).toThrow(/fence/);
    a.close();
  }, 60_000);
});
