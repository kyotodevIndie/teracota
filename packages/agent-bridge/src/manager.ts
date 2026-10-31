// BridgeManager: sessões de conversa com agentes, só em memória.
// Regras: um turno por vez; o estado é derivado dos eventos; logs só com transições e handle,
// nunca com o texto das conversas.
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  BridgeEvent, BridgeEventBody, BridgeState, HistoryEntry, PendingPermission, ProviderDescriptor,
  ProviderEventBody, SessionSnapshot, SessionSummary,
} from './contract';
import type { AgentProvider, ProviderSession } from './types';

export const MAX_HISTORY = 200;
const SENDABLE: ReadonlySet<BridgeState> = new Set(['idle', 'done', 'error', 'cancelled']);
const ACTIVE: ReadonlySet<BridgeState> = new Set(['running', 'waiting-permission']);

/** Erro com mensagem segura pra mostrar ao usuário */
export class BridgeError extends Error {}

interface Entry {
  providerId: string;
  cwdLabel: string;
  model?: string;
  state: BridgeState;
  history: HistoryEntry[];
  partial: string;
  permissions: Map<string, PendingPermission>;
  session: ProviderSession | null;
  interrupting: boolean;
}

export interface BridgeManagerOptions {
  log?: (line: string) => void;
}

export class BridgeManager {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<(e: BridgeEvent) => void>();
  private readonly log: (line: string) => void;

  constructor(private readonly providers: readonly AgentProvider[], opts: BridgeManagerOptions = {}) {
    this.log = opts.log ?? ((line) => console.info(`[bridge] ${line}`));
  }

  onEvent(cb: (e: BridgeEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async listProviders(): Promise<ProviderDescriptor[]> {
    return Promise.all(this.providers.map(async (p): Promise<ProviderDescriptor> => {
      const sim = p.simulated ? { simulated: true } : {};
      try {
        const a = await p.checkAvailability();
        return { id: p.id, displayName: p.displayName, available: a.available, ...(a.reason ? { reason: a.reason } : {}), ...sim };
      } catch {
        return { id: p.id, displayName: p.displayName, available: false, reason: 'Não foi possível verificar a disponibilidade.', ...sim };
      }
    }));
  }

  async listSessions(providerId: string, cwd: string): Promise<SessionSummary[]> {
    const provider = this.provider(providerId);
    try {
      return await provider.listSessions(cwd);
    } catch {
      return [];
    }
  }

  async start(providerId: string, opts: { cwd: string; resumeId?: string }): Promise<string> {
    const provider = this.provider(providerId);
    const avail = await provider.checkAvailability();
    if (!avail.available) throw new BridgeError(avail.reason ?? 'Agente indisponível.');

    const handle = randomUUID();
    const entry: Entry = {
      providerId, cwdLabel: path.basename(opts.cwd) || opts.cwd, state: 'starting', history: [], partial: '',
      permissions: new Map(), session: null, interrupting: false,
    };
    this.entries.set(handle, entry);
    this.emit(handle, { type: 'state', state: 'starting' });
    try {
      entry.session = await provider.start(opts, (ev) => this.onProviderEvent(handle, ev));
    } catch {
      this.entries.delete(handle);
      this.emit(handle, { type: 'state', state: 'closed' });
      throw new BridgeError('Não foi possível iniciar a sessão do agente.');
    }
    if (this.entries.get(handle) !== entry) {
      // fechada (closeAll) enquanto iniciava
      entry.session.close();
      throw new BridgeError('Sessão encerrada.');
    }
    this.setState(handle, entry, 'idle');
    return handle;
  }

  send(handle: string, text: string): void {
    const entry = this.get(handle);
    if (!SENDABLE.has(entry.state) || entry.interrupting) throw new BridgeError('A sessão não pode receber mensagens agora.');
    entry.partial = '';
    this.pushHistory(entry, { role: 'user', text });
    this.emit(handle, { type: 'message', role: 'user', text });
    this.setState(handle, entry, 'running');
    try {
      const r = entry.session?.send(text);
      if (r) r.catch(() => this.failTurn(handle, entry));
    } catch {
      this.failTurn(handle, entry);
    }
  }

  respondPermission(handle: string, requestId: string, allow: boolean): void {
    const entry = this.get(handle);
    if (!entry.permissions.has(requestId)) throw new BridgeError('Pedido de permissão desconhecido.');
    this.resolvePermission(handle, entry, requestId, allow);
    entry.session?.respondPermission(requestId, allow);
  }

  async interrupt(handle: string): Promise<void> {
    const entry = this.get(handle);
    if (!ACTIVE.has(entry.state) || entry.interrupting) throw new BridgeError('Não há turno em andamento.');
    entry.interrupting = true;
    try {
      for (const id of [...entry.permissions.keys()]) {
        this.resolvePermission(handle, entry, id, false);
        entry.session?.respondPermission(id, false);
      }
      try {
        await entry.session?.interrupt();
      } catch {
        // segue pra cancelar do nosso lado
      }
      if (this.entries.get(handle) === entry && ACTIVE.has(entry.state)) {
        this.endTurn(handle, entry, { type: 'turn-end', outcome: 'cancelled' });
      }
    } finally {
      entry.interrupting = false;
    }
  }

  close(handle: string): void {
    const entry = this.entries.get(handle);
    if (!entry) return;
    this.entries.delete(handle);
    entry.permissions.clear();
    try {
      entry.session?.close();
    } catch {
      // já encerrada
    }
    entry.state = 'closed';
    this.log(`${handle} closed`);
    this.emit(handle, { type: 'state', state: 'closed' });
  }

  closeAll(): void {
    for (const handle of [...this.entries.keys()]) this.close(handle);
  }

  /** Origem de uma sessão aberta (só metadados, nunca conteúdo) */
  describe(handle: string): { providerId: string; cwdLabel: string } | undefined {
    const e = this.entries.get(handle);
    return e ? { providerId: e.providerId, cwdLabel: e.cwdLabel } : undefined;
  }

  snapshot(): SessionSnapshot[] {
    return [...this.entries].map(([handle, e]) => ({
      handle, providerId: e.providerId, state: e.state, cwdLabel: e.cwdLabel, model: e.model,
      history: [...e.history], partial: e.partial, permissions: [...e.permissions.values()],
    }));
  }

  // ---------- internos ----------

  private provider(id: string): AgentProvider {
    const p = this.providers.find((x) => x.id === id);
    if (!p) throw new BridgeError('Agente desconhecido.');
    return p;
  }

  private get(handle: string): Entry {
    const e = this.entries.get(handle);
    if (!e) throw new BridgeError('Sessão não encontrada.');
    return e;
  }

  private emit(handle: string, body: BridgeEventBody): void {
    const event = { ...body, handle } as BridgeEvent;
    for (const cb of this.listeners) {
      try {
        cb(event);
      } catch {
        // um ouvinte com defeito não derruba os outros
      }
    }
  }

  private setState(handle: string, entry: Entry, state: BridgeState): void {
    if (entry.state === state) return;
    entry.state = state;
    this.log(`${handle} ${state}`);
    this.emit(handle, { type: 'state', state });
  }

  private pushHistory(entry: Entry, item: HistoryEntry): void {
    entry.history.push(item);
    if (entry.history.length > MAX_HISTORY) entry.history.splice(0, entry.history.length - MAX_HISTORY);
  }

  private resolvePermission(handle: string, entry: Entry, id: string, allow: boolean): void {
    if (!entry.permissions.delete(id)) return;
    this.emit(handle, { type: 'permission-resolved', id, allow });
    if (entry.state === 'waiting-permission' && entry.permissions.size === 0) this.setState(handle, entry, 'running');
  }

  private failTurn(handle: string, entry: Entry): void {
    if (this.entries.get(handle) !== entry || !ACTIVE.has(entry.state)) return;
    this.endTurn(handle, entry, { type: 'turn-end', outcome: 'error', message: 'Falha ao enviar a mensagem ao agente.' });
  }

  private endTurn(handle: string, entry: Entry, ev: Extract<ProviderEventBody, { type: 'turn-end' }>): void {
    for (const id of [...entry.permissions.keys()]) this.resolvePermission(handle, entry, id, false);
    entry.partial = '';
    if (ev.outcome === 'error' && ev.message) this.pushHistory(entry, { role: 'system', text: ev.message });
    this.emit(handle, ev);
    this.setState(handle, entry, ev.outcome);
  }

  private onProviderEvent(handle: string, ev: ProviderEventBody): void {
    const entry = this.entries.get(handle);
    if (!entry) return;
    if (ev.type === 'session') {
      entry.model = ev.model;
      this.emit(handle, ev);
      return;
    }
    // eventos tardios de um turno já encerrado (cancelado, por exemplo) são descartados
    if (!ACTIVE.has(entry.state)) return;
    switch (ev.type) {
      case 'text-delta':
        entry.partial += ev.text;
        this.emit(handle, ev);
        return;
      case 'message':
        if (ev.role === 'assistant') {
          entry.partial = '';
          this.pushHistory(entry, { role: 'assistant', text: ev.text });
        }
        this.emit(handle, ev);
        return;
      case 'tool':
        this.pushHistory(entry, { role: 'tool', text: ev.summary ? `${ev.name}: ${ev.summary}` : ev.name });
        this.emit(handle, ev);
        return;
      case 'permission-request':
        entry.permissions.set(ev.id, { id: ev.id, toolName: ev.toolName, detail: ev.detail, outsideCwd: ev.outsideCwd });
        this.emit(handle, ev);
        this.setState(handle, entry, 'waiting-permission');
        return;
      case 'permission-resolved':
        this.resolvePermission(handle, entry, ev.id, ev.allow);
        return;
      case 'turn-end':
        this.endTurn(handle, entry, ev);
        return;
    }
  }
}
