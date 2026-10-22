// Lógica de apresentação da janela de tarefas (pura, testável): rótulos e ações permitidas por estado.
import type { TaskState, TaskView } from './pocket';

export const STATE_LABEL: Record<TaskState, string> = {
  queued: 'Na fila', running: 'Executando', awaiting_approval: 'Aguardando aprovação', paused: 'Pausada',
  interrupted: 'Interrompida', needs_reconcile: 'Precisa de reconciliação', review: 'Em revisão',
  completed: 'Concluída', failed: 'Falhou', cancelled: 'Cancelada', session_expired: 'Sessão expirada',
  auth_error: 'Login necessário', usage_limited: 'Limite de uso',
};

export const CLASS_LABEL: Record<string, string> = {
  safe_read: 'leitura', workspace_write: 'escrita no workspace', external_read: 'leitura fora do workspace',
  external_write: 'escrita fora do workspace', destructive: 'ação destrutiva', compound_shell: 'comando composto/não classificado',
  unknown: 'ferramenta não classificada',
};

export interface Actions {
  start: boolean;
  interrupt: boolean;
  cancel: boolean;
  resume: boolean;
  /** Retomar exige uma NOVA sessão (a anterior expirou). */
  newSession: boolean;
  approveReview: boolean;
  acceptAsIs: boolean;
  markFailed: boolean;
  reconcile: boolean;
  approvals: boolean;
  /** Retomar bloqueado até reconhecer a reconciliação (mostra o porquê). */
  resumeBlockedReason: string | null;
}

const NONE: Actions = {
  start: false, interrupt: false, cancel: false, resume: false, newSession: false, approveReview: false,
  acceptAsIs: false, markFailed: false, reconcile: false, approvals: false, resumeBlockedReason: null,
};

export function actionsFor(t: Pick<TaskView, 'state' | 'unconfirmedEffects'> & { reconcileAcked?: boolean }): Actions {
  switch (t.state) {
    case 'queued': return { ...NONE, start: true, cancel: true };
    case 'running': return { ...NONE, interrupt: true, cancel: true };
    case 'awaiting_approval': return { ...NONE, interrupt: true, cancel: true, approvals: true };
    case 'paused': case 'usage_limited': case 'auth_error': return { ...NONE, resume: true, cancel: true };
    case 'interrupted': return { ...NONE, resume: true, acceptAsIs: true, cancel: true };
    case 'review': return { ...NONE, approveReview: true, resume: true, cancel: true };
    case 'session_expired': return { ...NONE, resume: true, newSession: true, markFailed: true, cancel: true };
    case 'needs_reconcile': {
      const open = t.unconfirmedEffects.filter((e) => e.status === 'unconfirmed').length;
      const blocked = open > 0 ? `decida os ${open} efeito(s) incerto(s) acima` : t.reconcileAcked ? null : 'confirme que revisou a evidência';
      return { ...NONE, reconcile: true, resume: true, acceptAsIs: true, markFailed: true, cancel: true, resumeBlockedReason: blocked };
    }
    default: return NONE; // completed / failed / cancelled: terminais
  }
}

export function defaultResumePrompt(state: TaskState): string {
  switch (state) {
    case 'review': return 'Ajuste: ';
    case 'needs_reconcile': return 'Continue verificando primeiro o que já foi feito (arquivos e comandos) antes de repetir qualquer ação.';
    case 'session_expired': return 'Recomece a tarefa do início, verificando o estado atual dos arquivos.';
    default: return 'Continue de onde parou.';
  }
}

export function secondsLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}
