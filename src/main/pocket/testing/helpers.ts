// Utilitários só de teste (não entram no bundle do app: ninguém os importa fora de *.test.ts).
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PocketStore, TransitionOpts } from '../core/store';
import { allowedActors, TASK_TRANSITIONS } from '../core/states';
import { TASK_STATES, type TaskRow, type TaskState } from '../../../shared/pocket';

export function tmpDir(prefix = 'pocket-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* Windows pode segurar o WAL por instantes */ } } };
}

export function clock(start = 1_000_000) {
  let t = start;
  const fn = () => t;
  fn.advance = (ms: number) => { t += ms; };
  fn.set = (v: number) => { t = v; };
  return fn;
}

/** Caminho mais curto queued → alvo segundo a tabela. */
export function pathTo(target: TaskState): TaskState[] {
  if (target === 'queued') return [];
  const prev = new Map<TaskState, TaskState | null>([['queued', null]]);
  const q: TaskState[] = ['queued'];
  while (q.length) {
    const cur = q.shift() as TaskState;
    for (const nxt of Object.keys(TASK_TRANSITIONS[cur]) as TaskState[]) {
      if (prev.has(nxt)) continue;
      prev.set(nxt, cur);
      q.push(nxt);
    }
  }
  const out: TaskState[] = [];
  for (let s: TaskState | null | undefined = target; s && s !== 'queued'; s = prev.get(s)) out.unshift(s);
  return out;
}

export function step(store: PocketStore, taskId: string, to: TaskState, over: Partial<TransitionOpts> = {}): TaskRow {
  const from = store.mustTask(taskId).state;
  const actors = allowedActors(from, to) ?? ['system'];
  const actor = over.actor ?? (actors.includes('user') ? 'user' : actors[0] as 'system' | 'policy');
  const gestureId = actor === 'user' ? (over.gestureId ?? store.issueGesture('task_action', taskId)) : undefined;
  const evidence = over.evidence ?? ((from === 'running' || from === 'awaiting_approval') && to === 'cancelled' ? { cleanExit: true } : undefined);
  return store.transition(taskId, to, { actor, reason: over.reason ?? 'test', gestureId, runId: over.runId, evidence });
}

export function newTask(store: PocketStore, cwd = 'C:/ws'): TaskRow {
  return store.createTask({ title: 'tarefa', prompt: 'faça algo', cwd, gestureId: store.issueGesture('create_task', null) });
}

export function driveTo(store: PocketStore, target: TaskState, cwd?: string): TaskRow {
  const t = newTask(store, cwd);
  for (const s of pathTo(target)) step(store, t.id, s);
  return store.mustTask(t.id);
}

export const ALL_STATES = TASK_STATES;
