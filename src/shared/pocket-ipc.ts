// Contrato de IPC da Tera Pocket entre o processo principal e a janela de tarefas (via pocket-preload).
// Aditivo: não toca em `IPC`/`CompanionApi` do companion.
import type { TaskView } from './pocket';

export const POCKET_IPC = {
  status: 'pocket:status',
  list: 'pocket:list',
  create: 'pocket:create',
  pickFolder: 'pocket:pick-folder',
  start: 'pocket:start',
  interrupt: 'pocket:interrupt',
  cancel: 'pocket:cancel',
  approval: 'pocket:approval',
  resume: 'pocket:resume',
  approveReview: 'pocket:approve-review',
  acceptAsIs: 'pocket:accept-as-is',
  evidence: 'pocket:evidence',
  evidenceGit: 'pocket:evidence-git',
  resolveEffect: 'pocket:resolve-effect',
  ack: 'pocket:ack',
  resolveReconcile: 'pocket:resolve-reconcile',
  changed: 'pocket:changed',
} as const;

export type PocketChannel = Exclude<(typeof POCKET_IPC)[keyof typeof POCKET_IPC], typeof POCKET_IPC.changed>;

export type PocketResult<T = unknown> = { ok: true; data: T } | { ok: false; code: string; message: string };

export interface PocketStatus {
  ready: boolean;
  /** Motivo de bloqueio (core não abriu, inconsistência, outra instância...). */
  blocked?: string;
  claudeFound: boolean;
  containment: string;
  orphansKilled: number;
}

export interface PocketEvidence {
  taskId: string;
  state: string;
  reason: string | null;
  transcript: { bytes: number; mtimeMs: number; tail: string[]; incompleteTurn: boolean } | null;
  externalActivity: boolean;
  flags: { interruptRequested: boolean; cancelRequested: boolean };
  effects: { id: string; toolName: string; summary: string; status: string; verifiable: boolean; suggestion: 'applied' | 'not_applied' | 'unknown' }[];
  git: { changedFiles: number; files: string[]; truncated: boolean } | null;
}

export interface PocketApi {
  status(): Promise<PocketResult<PocketStatus>>;
  list(): Promise<PocketResult<TaskView[]>>;
  create(i: { title: string; prompt: string; cwd: string }): Promise<PocketResult<TaskView>>;
  pickFolder(): Promise<PocketResult<string | null>>;
  start(taskId: string): Promise<PocketResult<{ runId: string }>>;
  interrupt(taskId: string): Promise<PocketResult<string>>;
  cancel(taskId: string): Promise<PocketResult<null>>;
  approval(approvalRequestId: string, decision: 'allow' | 'deny'): Promise<PocketResult<null>>;
  resume(i: { taskId: string; prompt: string; newSession?: boolean }): Promise<PocketResult<{ runId: string }>>;
  approveReview(taskId: string): Promise<PocketResult<null>>;
  acceptAsIs(taskId: string): Promise<PocketResult<null>>;
  evidence(taskId: string): Promise<PocketResult<PocketEvidence>>;
  /** Executa `git status` no repositório da tarefa (o repositório pode ter sido alterado pelo agente): só por gesto explícito. */
  evidenceGit(taskId: string): Promise<PocketResult<PocketEvidence>>;
  resolveEffect(effectId: string, resolution: 'applied' | 'not_applied' | 'unknown'): Promise<PocketResult<null>>;
  ack(taskId: string): Promise<PocketResult<null>>;
  resolveReconcile(taskId: string, to: 'review' | 'failed' | 'cancelled'): Promise<PocketResult<null>>;
  onChanged(cb: (tasks: TaskView[]) => void): void;
}

declare global {
  interface Window {
    pocket?: PocketApi;
  }
}
