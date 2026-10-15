// Fila central de notificações do Mini Companion.
//
// Regras:
// - Solicitações (permissão, pergunta) ficam até serem resolvidas ou encaminhadas.
//   Nunca somem porque outra notificação chegou.
// - Informativas (erro, conclusão, info) expiram sozinhas.
// - Eventos repetidos (mesmo tipo, sessão e texto em pouco tempo) viram um só, com contador.
// - Ordem de destaque: solicitações primeiro (a mais antiga antes), depois erro, conclusão, info.
import type { NotificationKind } from '../../shared/companion';

export interface CompanionNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  message: string;
  /** Chave da sessão (provider:sessionId), quando houver */
  sessionKey: string | null;
  /** "Agente · projeto" */
  origin: string | null;
  at: number;
  count: number;
  resolved: boolean;
}

export type NewNotification = Pick<CompanionNotification, 'kind' | 'title' | 'message'> &
  Partial<Pick<CompanionNotification, 'sessionKey' | 'origin'>>;

/** Prioridade (menor = mais importante) */
export const PRIORITY: Record<NotificationKind, number> = {
  permission: 0,
  question: 0,
  error: 1,
  completion: 2,
  info: 3,
};

/** Precisa de resposta do usuário: fica até ser resolvida */
export const isRequest = (kind: NotificationKind): boolean => kind === 'permission' || kind === 'question';

/** Quanto tempo uma notificação informativa fica na fila */
export const INFO_TTL_MS: Record<NotificationKind, number> = {
  permission: Infinity,
  question: Infinity,
  error: 8000,
  completion: 5000,
  info: 5000,
};

/** Mesmo evento dentro dessa janela vira um só (contador) */
export const GROUP_WINDOW_MS = 10_000;
/** Limite de segurança: as informativas mais antigas saem primeiro */
export const MAX_ITEMS = 50;

export class NotificationQueue {
  private items: CompanionNotification[] = [];
  private seq = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Adiciona (ou agrupa com uma igual recente). Devolve a notificação e se é nova. */
  push(input: NewNotification): { item: CompanionNotification; isNew: boolean } {
    const at = this.now();
    const sessionKey = input.sessionKey ?? null;
    const same = this.items.find((n) =>
      !n.resolved && n.kind === input.kind && n.sessionKey === sessionKey && n.message === input.message &&
      (isRequest(n.kind) || at - n.at < GROUP_WINDOW_MS));
    if (same) {
      same.count++;
      // informativa repetida renova o prazo; solicitação mantém o lugar na fila
      if (!isRequest(same.kind)) same.at = at;
      return { item: same, isNew: false };
    }
    const item: CompanionNotification = {
      id: `n${++this.seq}`, kind: input.kind, title: input.title, message: input.message,
      sessionKey, origin: input.origin ?? null, at, count: 1, resolved: false,
    };
    this.items.push(item);
    this.trim();
    return { item, isNew: true };
  }

  resolve(id: string): boolean {
    const n = this.items.find((i) => i.id === id && !i.resolved);
    if (!n) return false;
    n.resolved = true;
    return true;
  }

  /** Resolve as solicitações de uma sessão (ex.: ela voltou a trabalhar, então alguém respondeu) */
  resolveSession(sessionKey: string, kinds: NotificationKind[] = ['permission', 'question']): number {
    let count = 0;
    for (const n of this.items) {
      if (!n.resolved && n.sessionKey === sessionKey && kinds.includes(n.kind)) {
        n.resolved = true;
        count++;
      }
    }
    return count;
  }

  /** Remove resolvidas e informativas vencidas */
  prune(): boolean {
    const now = this.now();
    const before = this.items.length;
    this.items = this.items.filter((n) => !n.resolved && now - n.at < INFO_TTL_MS[n.kind]);
    return this.items.length !== before;
  }

  /** Ativas, na ordem de destaque */
  active(): CompanionNotification[] {
    const now = this.now();
    return this.items
      .filter((n) => !n.resolved && now - n.at < INFO_TTL_MS[n.kind])
      .sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || (isRequest(a.kind) ? a.at - b.at : b.at - a.at));
  }

  pending(): CompanionNotification[] {
    return this.active().filter((n) => isRequest(n.kind));
  }

  get(id: string): CompanionNotification | undefined {
    return this.items.find((n) => n.id === id);
  }

  private trim(): void {
    while (this.items.length > MAX_ITEMS) {
      const i = this.items.findIndex((n) => !isRequest(n.kind) || n.resolved);
      if (i < 0) return; // só solicitações pendentes: não descarta nenhuma
      this.items.splice(i, 1);
    }
  }
}
