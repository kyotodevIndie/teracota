// Controller do Mini Companion: junta interações, fila de notificações e atividade dos
// agentes num contexto, deriva o estado visual e manda o CompanionView pra janela.
// Não conhece Electron nem Claude Code: recebe uma "superfície" e notificações normalizadas.
import type {
  Anchor, CompanionAction, CompanionInput, CompanionView, NotificationKind, NotificationView, VisualState,
} from '../../shared/companion';
import type { Pose } from '../../shared/skin';
import { NotificationQueue, isRequest, type CompanionNotification, type NewNotification } from './notifications';
import { INITIAL_CONTEXT, deriveVisualState, type CompanionContext } from './visual-state';

/** O que o controller precisa da janela */
export interface CompanionSurface {
  readonly anchor: Anchor;
  render(view: CompanionView): void;
  openMenu(): void;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

/** Espera antes de abrir no hover (passar o mouse por cima de passagem não abre) */
export const HOVER_OPEN_MS = 120;
/** Espera antes de recolher quando o mouse sai */
export const HOVER_CLOSE_MS = 500;

const TITLES: Record<NotificationKind, string> = {
  permission: 'Precisa de permissão',
  question: 'Pergunta do agente',
  error: 'Deu erro',
  completion: 'Tarefa concluída',
  info: 'Aviso',
};

export interface ControllerOptions {
  muted?: boolean;
  onMutedChange?: (muted: boolean) => void;
  clock?: Clock;
}

export class CompanionController {
  private ctx: CompanionContext;
  private readonly queue: NotificationQueue;
  private readonly clock: Clock;
  private focusId: string | null = null;
  private hoverTimer: unknown = null;
  private pruneTimer: unknown = null;
  private lastView = '';

  constructor(private readonly surface: CompanionSurface, private readonly opts: ControllerOptions = {}) {
    this.clock = opts.clock ?? realClock;
    this.queue = new NotificationQueue(() => this.clock.now());
    this.ctx = { ...INITIAL_CONTEXT, muted: opts.muted ?? false };
  }

  get state(): VisualState {
    return deriveVisualState(this.ctx);
  }

  get context(): Readonly<CompanionContext> {
    return this.ctx;
  }

  // ---------- entradas ----------

  input(i: CompanionInput): void {
    switch (i.type) {
      case 'hover':
        this.clock.clearTimeout(this.hoverTimer);
        this.hoverTimer = this.clock.setTimeout(() => this.update({ hovering: i.over }), i.over ? HOVER_OPEN_MS : HOVER_CLOSE_MS);
        break;
      case 'click':
        this.click();
        break;
      case 'drag-files':
        this.update({ draggingFiles: i.over });
        break;
      case 'drop-files':
        this.drop(i.names);
        break;
      case 'navigate':
        this.navigate(i.delta);
        break;
      case 'action':
        this.action(i.id, i.notificationId);
        break;
    }
  }

  /** Nova notificação vinda dos agentes (ou do simulador) */
  notify(n: NewNotification): CompanionNotification {
    const { item, isNew } = this.queue.push(n);
    if (isNew && isRequest(item.kind)) {
      // solicitação nova sempre chama atenção, mesmo se o usuário tinha recolhido as anteriores
      this.ctx.attentionCollapsed = false;
      if (!this.focusId || !isRequest(this.queue.get(this.focusId)?.kind ?? 'info')) this.focusId = item.id;
    }
    this.refresh();
    return item;
  }

  resolve(id: string): void {
    if (this.queue.resolve(id)) this.refresh();
  }

  /** A sessão seguiu em frente (ex.: voltou a usar ferramentas): as solicitações dela foram respondidas */
  resolveSession(sessionKey: string): void {
    if (this.queue.resolveSession(sessionKey)) this.refresh();
  }

  setWorking(working: boolean): void {
    this.update({ working });
  }

  setPanelOpen(open: boolean): void {
    this.update({ panelOpen: open });
  }

  setMuted(muted: boolean): void {
    this.update({ muted });
    this.opts.onMutedChange?.(muted);
  }

  /** Reenvia o view (ex.: a janela recarregou ou mudou de lado) */
  render(force = false): void {
    const view = this.view();
    const key = JSON.stringify(view);
    if (!force && key === this.lastView) return;
    this.lastView = key;
    this.surface.render(view);
  }

  // ---------- internos ----------

  private update(patch: Partial<CompanionContext>): void {
    Object.assign(this.ctx, patch);
    this.render();
  }

  /** Recalcula o que vem da fila e agenda a próxima expiração */
  private refresh(): void {
    this.queue.prune();
    const active = this.queue.active();
    const pending = active.some((n) => isRequest(n.kind));
    if (!pending) this.ctx.attentionCollapsed = false;
    if (this.focusId && !active.some((n) => n.id === this.focusId)) this.focusId = null;
    this.ctx.topKind = active[0]?.kind ?? null;
    this.ctx.pending = pending;
    this.render();
    this.clock.clearTimeout(this.pruneTimer);
    this.pruneTimer = active.length ? this.clock.setTimeout(() => this.refresh(), 1000) : null;
  }

  private click(): void {
    if (this.state === 'ATTENTION') {
      // atenção aberta → recolhe (a solicitação continua na fila, com badge)
      this.update({ attentionCollapsed: true, pinned: false });
    } else if (this.ctx.pending && this.ctx.attentionCollapsed) {
      // recolhida com pendência → reabre a atenção
      this.update({ attentionCollapsed: false });
    } else {
      this.update({ pinned: !this.ctx.pinned });
    }
  }

  private navigate(delta: 1 | -1): void {
    const active = this.queue.active();
    if (active.length < 2) return;
    const i = Math.max(0, active.findIndex((n) => n.id === this.current()?.id));
    this.focusId = active[(i + delta + active.length) % active.length]!.id;
    this.render();
  }

  private action(id: CompanionAction['id'], notificationId?: string): void {
    switch (id) {
      case 'acknowledge':
      case 'dismiss':
        if (notificationId) this.queue.resolve(notificationId);
        if (!this.queue.pending().length) this.ctx.pinned = false;
        this.refresh();
        break;
      case 'mute':
        this.setMuted(true);
        break;
      case 'unmute':
        this.setMuted(false);
        break;
      case 'open-menu':
        this.surface.openMenu();
        break;
    }
  }

  private drop(names: string[]): void {
    // Nenhuma integração atual recebe arquivos: avisa com clareza e não envia nada.
    const list = names.length > 3 ? `${names.slice(0, 3).join(', ')} e mais ${names.length - 3}` : names.join(', ');
    this.ctx.draggingFiles = false;
    this.queue.push({
      kind: 'info',
      title: 'Arquivos não enviados',
      message: `Ainda não dá pra enviar arquivos pra uma sessão. Nada foi enviado${list ? ` (${list})` : ''}.`,
    });
    this.refresh();
  }

  /** Notificação em destaque: a escolhida na navegação, senão a mais importante */
  private current(): CompanionNotification | null {
    const active = this.queue.active();
    return active.find((n) => n.id === this.focusId) ?? active[0] ?? null;
  }

  private view(): CompanionView {
    const state = this.state;
    const active = this.queue.active();
    const current = state === 'MINI' || state === 'WORKING' ? null : this.current();
    const index = current ? active.findIndex((n) => n.id === current.id) : -1;
    return {
      state,
      anchor: this.surface.anchor,
      pose: poseFor(state, current?.kind ?? null, this.ctx.working),
      working: this.ctx.working,
      pendingCount: this.queue.pending().length,
      notification: current && notificationView(current),
      queue: { index: Math.max(0, index), total: active.length },
      context: this.ctx.working
        ? { title: 'Trabalhando', detail: 'Um agente está trabalhando. Eu aviso quando precisar de você.' }
        : { title: 'Tudo tranquilo', detail: 'Nenhum agente pedindo nada agora.' },
      actions: [
        this.ctx.muted ? { id: 'unmute', label: 'Reativar avisos' } : { id: 'mute', label: 'Silenciar avisos' },
        { id: 'open-menu', label: 'Menu' },
      ],
      muted: this.ctx.muted,
      drop: state === 'DRAGGING'
        ? { hint: 'Solte os arquivos aqui', note: 'O envio pra sessão ainda não está disponível' }
        : null,
    };
  }
}

function notificationView(n: CompanionNotification): NotificationView {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title || TITLES[n.kind],
    message: n.message,
    origin: n.origin,
    count: n.count,
    at: n.at,
    // Com os hooks, a Teracota não consegue responder ao agente: a resposta é no terminal.
    actions: isRequest(n.kind)
      ? [{ id: 'acknowledge', label: 'Vou ver no terminal' }]
      : [{ id: 'dismiss', label: 'Ok' }],
  };
}

function poseFor(state: VisualState, kind: NotificationKind | null, working: boolean): Pose {
  switch (state) {
    case 'ATTENTION': return 'surprised';
    case 'DRAGGING': return 'happy';
    case 'NOTIFICATION': return kind === 'error' ? 'error' : kind === 'completion' ? 'happy' : 'idle';
    case 'EXPANDED':
    case 'PANEL': return working ? 'work' : 'wave';
    case 'WORKING': return 'work';
    default: return 'idle';
  }
}

