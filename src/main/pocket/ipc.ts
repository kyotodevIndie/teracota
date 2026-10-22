// Handlers de IPC da Tera Pocket. Este é o "caminho de comando da UI" do contrato §4: um clique do usuário
// na janela de tarefas vira um gesto (`issueGesture`) consumido pelo Core; runner e agente não passam por aqui.
// Toda entrada é validada (tipos, tamanho, enum) porque o renderer é tratado como não confiável.
import { statSync } from 'node:fs';
import path from 'node:path';
import type { TaskView } from '../../shared/pocket';
import { POCKET_IPC, type PocketChannel, type PocketEvidence, type PocketResult, type PocketStatus } from '../../shared/pocket-ipc';
import type { PocketStore } from './core/store';
import { CommandError, type PocketOrchestrator } from './orchestrator/orchestrator';
import { isCredentialPath, isInsideExact, workspaceRealpath } from './security/paths';

/** Pastas que não podem ser pasta de trabalho: 'exact' = ela e seus ancestrais; 'tree' = também tudo dentro dela. */
export interface ForbiddenDir { dir: string; kind: 'exact' | 'tree' }

export interface PocketBackend {
  forbiddenWorkdirs(): ForbiddenDir[];
  orch: PocketOrchestrator;
  store: PocketStore;
  status(): PocketStatus;
  pickFolder(): Promise<string | null>;
}

class BadArg extends Error {}

const ID = /^[\w.:-]{1,120}$/;
const id = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || !ID.test(v)) throw new BadArg(`${what} inválido`);
  return v;
};
const text = (v: unknown, what: string, max: number, min = 1): string => {
  if (typeof v !== 'string') throw new BadArg(`${what} inválido`);
  const t = v.trim();
  if (t.length < min || t.length > max) throw new BadArg(`${what}: de ${min} a ${max} caracteres`);
  return t;
};
const oneOf = <T extends string>(v: unknown, set: readonly T[], what: string): T => {
  if (typeof v !== 'string' || !(set as readonly string[]).includes(v)) throw new BadArg(`${what} inválido`);
  return v as T;
};
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new BadArg('argumentos inválidos');
  return v as Record<string, unknown>;
};

/** Pasta de trabalho: absoluta, existente, diretório, não é raiz de disco, não é pasta de credenciais/dados do Teracota. */
export function validateCwd(v: unknown, forbidden: readonly ForbiddenDir[] = []): string {
  const raw = text(v, 'pasta', 1000);
  if (!path.isAbsolute(raw)) throw new BadArg('a pasta precisa ser um caminho absoluto');
  let real: string;
  try {
    if (!statSync(raw).isDirectory()) throw new BadArg('não é uma pasta');
    real = workspaceRealpath(raw);
  } catch (e) {
    if (e instanceof BadArg) throw e;
    throw new BadArg('pasta inexistente ou inacessível');
  }
  if (path.parse(real).root === real) throw new BadArg('não use a raiz do disco como pasta de trabalho');
  if (isCredentialPath(real)) throw new BadArg('esta pasta é protegida');
  for (const f of forbidden) {
    let fr = f.dir;
    try { fr = workspaceRealpath(f.dir); } catch { /* ainda não existe: compara o caminho cru */ }
    // a pasta de trabalho não pode ser a proibida nem um ANCESTRAL dela (escrita automática alcançaria a proibida)
    if (isInsideExact(real, fr) || isInsideExact(real, path.resolve(f.dir))) throw new BadArg('esta pasta contém ou é uma área protegida (perfil do usuário, AppData, dados ou instalação do app)');
    if (f.kind === 'tree' && (isInsideExact(fr, real) || isInsideExact(path.resolve(f.dir), real))) throw new BadArg('esta pasta fica dentro de uma área protegida');
  }
  return real;
}

type Handler = (arg: unknown) => Promise<unknown> | unknown;

export function createPocketHandlers(b: PocketBackend): Record<PocketChannel, Handler> {
  const { orch, store } = b;
  const g = (taskId: string, to: string) => store.issueGesture('task_action', taskId, `to:${to}`);
  const taskArg = (a: unknown): string => id(obj(a).taskId, 'tarefa');

  return {
    [POCKET_IPC.status]: () => b.status(),
    [POCKET_IPC.list]: (): TaskView[] => orch.listViews(),
    [POCKET_IPC.create]: (a) => {
      const o = obj(a);
      const gesture = store.issueGesture('create_task', null, 'create_task');
      const t = orch.createTask({ title: text(o.title, 'título', 120), prompt: text(o.prompt, 'prompt', 20_000), cwd: validateCwd(o.cwd, b.forbiddenWorkdirs()) }, gesture);
      return orch.view(t.id);
    },
    [POCKET_IPC.pickFolder]: () => b.pickFolder(),
    [POCKET_IPC.start]: (a) => { const t = taskArg(a); return orch.startTask(t, g(t, 'running')); },
    [POCKET_IPC.interrupt]: (a) => { const t = taskArg(a); return orch.interruptTask(t, g(t, 'interrupted')); },
    [POCKET_IPC.cancel]: async (a) => { const t = taskArg(a); await orch.cancelTask(t, g(t, 'cancelled')); return null; },
    [POCKET_IPC.approval]: async (a) => {
      const o = obj(a);
      const aid = id(o.approvalRequestId, 'aprovação');
      const decision = oneOf(o.decision, ['allow', 'deny'] as const, 'decisão');
      const row = store.getApproval(aid);
      if (!row) throw new BadArg('aprovação inexistente');
      await orch.resolveApproval(aid, decision, store.issueGesture('approval', row.taskId, `approval:${aid}`));
      return null;
    },
    [POCKET_IPC.resume]: (a) => {
      const o = obj(a);
      const t = id(o.taskId, 'tarefa');
      return orch.resumeTask(t, text(o.prompt, 'prompt', 20_000), g(t, 'running'), { newSession: o.newSession === true });
    },
    [POCKET_IPC.approveReview]: (a) => { const t = taskArg(a); orch.approveReview(t, g(t, 'completed')); return null; },
    [POCKET_IPC.acceptAsIs]: (a) => { const t = taskArg(a); orch.acceptAsIs(t, g(t, 'review')); return null; },
    [POCKET_IPC.evidence]: (a): Promise<PocketEvidence> => orch.evidence(taskArg(a)),
    // git só sob gesto: o repositório pode conter configuração que executa código (filter drivers)
    [POCKET_IPC.evidenceGit]: (a): Promise<PocketEvidence> => { const t = taskArg(a); store.useGesture(store.issueGesture('task_action', t, 'evidence_git'), t, 'task_action', 'evidence_git'); return orch.evidence(t, { includeGit: true }); },
    [POCKET_IPC.resolveEffect]: (a) => {
      const o = obj(a);
      const eid = id(o.effectId, 'efeito');
      const e = store.getEffect(eid);
      if (!e) throw new BadArg('efeito inexistente');
      orch.resolveEffect(eid, oneOf(o.resolution, ['applied', 'not_applied', 'unknown'] as const, 'decisão'), store.issueGesture('effect_resolution', e.taskId, `effect:${eid}`));
      return null;
    },
    [POCKET_IPC.ack]: (a) => { const t = taskArg(a); orch.acknowledgeReconcile(t, store.issueGesture('task_action', t, 'reconcile_ack')); return null; },
    [POCKET_IPC.resolveReconcile]: (a) => {
      const o = obj(a);
      const t = id(o.taskId, 'tarefa');
      const to = oneOf(o.to, ['review', 'failed', 'cancelled'] as const, 'destino');
      orch.resolveReconcile(t, to, g(t, to));
      return null;
    },
  };
}

/** Executa um handler e converte exceções em resultado tipado (nunca vaza stack nem caminho interno). */
export async function runHandler(h: Handler, arg: unknown): Promise<PocketResult> {
  try {
    return { ok: true, data: await h(arg) };
  } catch (e) {
    if (e instanceof BadArg) return { ok: false, code: 'BAD_INPUT', message: e.message };
    if (e instanceof CommandError) return { ok: false, code: e.code, message: e.message };
    const name = e instanceof Error ? e.name : 'Error';
    const code = name === 'GestureError' ? 'GESTURE' : name === 'InvalidTransitionError' ? 'INVALID_STATE' : name === 'ApprovalError' ? 'APPROVAL' : 'INTERNAL';
    return { ok: false, code, message: e instanceof Error ? e.message.slice(0, 300) : 'erro interno' };
  }
}
