// Provider de simulação (dev): roteiro local para homologar o painel sem agente e sem custo.
// Node puro — nada de electron, rede ou SDK. O texto do usuário só escolhe o roteiro
// (comando exato); nunca é ecoado nem registrado.
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ProviderEventBody } from '../../shared/bridge';
import type { AgentProvider, ProviderSession, ProviderSink } from './types';

export const SIM_PROVIDER_ID = 'simulado';

export const SIM_REPLY =
  '[SIMULAÇÃO] Resposta de teste gerada localmente; nenhum agente real foi chamado. Comandos: /permissao /erro /lento /desconectar';
const SIM_ALLOWED = '[simulado] permitido; nenhuma ação real executada';
const SIM_DENIED = '[simulado] recusado';
const SIM_ERROR = '[simulado] erro sob comando';
const SIM_DISCONNECTED = '[simulado] agente desconectado';
const SIM_ENDED = '[simulado] sessão simulada encerrada';
const DEFAULT_CHUNKS = 8;
const SLOW_CHUNKS = 60;
const SLOW_TICK_MS = 250;

export interface SimulatedProviderOptions {
  /** Intervalo entre os passos do roteiro padrão */
  tickMs?: number;
}

/** Divide o texto em n partes (aproximadamente) iguais */
function chunks(text: string, n: number): string[] {
  const size = Math.ceil(text.length / n);
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

class SimulatedSession implements ProviderSession {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private pending = new Set<string>();
  private running = false;
  private dead = false;
  private closed = false;

  constructor(private readonly sink: ProviderSink, private readonly tickMs: number) {}

  send(text: string): void {
    if (this.dead || this.closed) {
      this.sink({ type: 'turn-end', outcome: 'error', message: SIM_ENDED });
      return;
    }
    this.clearTimers();
    this.running = true;
    const command = text.trim();
    if (command === '/permissao') {
      this.permission();
    } else if (command === '/erro') {
      this.after(this.tickMs, () => this.end({ type: 'turn-end', outcome: 'error', message: SIM_ERROR }));
    } else if (command === '/lento') {
      this.stream(Array.from({ length: SLOW_CHUNKS }, (_, i) => `[simulado] parte ${i + 1}. `), SLOW_TICK_MS);
    } else if (command === '/desconectar') {
      this.after(this.tickMs, () => {
        this.dead = true;
        this.end({ type: 'turn-end', outcome: 'error', message: SIM_DISCONNECTED });
      });
    } else {
      this.sink({ type: 'tool', name: 'Simulação', summary: '[simulado] etapa fictícia', activity: 'reading' });
      this.stream(chunks(SIM_REPLY, DEFAULT_CHUNKS), this.tickMs);
    }
  }

  respondPermission(id: string, allow: boolean): void {
    if (!this.pending.delete(id) || !this.running) return;
    this.reply(allow ? SIM_ALLOWED : SIM_DENIED);
  }

  async interrupt(): Promise<void> {
    this.stop();
    if (this.running) this.end({ type: 'turn-end', outcome: 'cancelled' });
  }

  close(): void {
    this.closed = true;
    this.stop();
  }

  // ---------- roteiros ----------

  private permission(): void {
    this.after(this.tickMs, () => {
      const id = randomUUID();
      this.pending.add(id);
      this.sink({ type: 'permission-request', id, toolName: 'Simulação', detail: '[simulado] pedido fictício — nada será executado', outsideCwd: false });
    });
  }

  private reply(text: string): void {
    this.after(this.tickMs, () => this.stream([text], this.tickMs));
  }

  /** Emite os pedaços um a um e fecha o turno com a mensagem completa */
  private stream(parts: string[], tick: number): void {
    let i = 0;
    const step = (): void => {
      if (i < parts.length) {
        this.sink({ type: 'text-delta', text: parts[i++]! });
        this.after(tick, step);
        return;
      }
      this.sink({ type: 'message', role: 'assistant', text: parts.join('') });
      this.end({ type: 'turn-end', outcome: 'done' });
    };
    this.after(tick, step);
  }

  // ---------- internos ----------

  private after(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    t.unref?.();
    this.timers.add(t);
  }

  private end(ev: Extract<ProviderEventBody, { type: 'turn-end' }>): void {
    this.running = false;
    this.sink(ev);
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private stop(): void {
    this.clearTimers();
    this.pending.clear();
  }
}

export function createSimulatedProvider(opts: SimulatedProviderOptions = {}): AgentProvider {
  const tickMs = opts.tickMs ?? 150;
  return {
    id: SIM_PROVIDER_ID,
    displayName: 'Simulação (sem agente)',
    simulated: true,
    async checkAvailability() {
      return { available: true };
    },
    async listSessions() {
      return [];
    },
    async start({ cwd }, sink) {
      sink({ type: 'session', sessionId: `sim-${randomUUID()}`, cwdLabel: path.basename(cwd) || cwd, model: 'simulado' });
      return new SimulatedSession(sink, tickMs);
    },
  };
}
