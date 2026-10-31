// Acompanha as sessões dos agentes que estão mandando eventos (de qualquer provider).

export interface Session {
  /** Chave única: provider + id da sessão no agente */
  key: string;
  provider: string;
  project: string;
  working: boolean;
  lastSeen: number;
  /** O agente avisa quando termina? Se não, o "trabalhando" expira rápido */
  reportsCompletion: boolean;
}

/** Sem eventos por esse tempo → sessão considerada encerrada (terminal fechado à força) */
export const SESSION_TIMEOUT_MS = 45 * 60 * 1000;
/** "Trabalhando" sem eventos por esse tempo → provavelmente foi interrompido (Esc) */
const WORKING_STALE_MS = 10 * 60 * 1000;
/** Idem, pra agentes que não avisam quando terminam */
export const WORKING_STALE_NO_COMPLETION_MS = 60 * 1000;

export function sessionKey(provider: string, sessionId: string): string {
  return `${provider}:${sessionId}`;
}

/** Nome da pasta do projeto; undefined sem caminho */
export function projectName(cwd: string | undefined): string | undefined {
  // divide nas duas barras: path.basename só entende a do sistema atual
  return cwd?.split(/[\\/]+/).filter(Boolean).pop() || undefined;
}

export interface SessionInfo {
  provider: string;
  project: string;
  reportsCompletion: boolean;
}

export class SessionTracker {
  private readonly sessions = new Map<string, Session>();

  get size(): number {
    return this.sessions.size;
  }

  get(key: string): Session | undefined {
    return this.sessions.get(key);
  }

  touch(key: string, info: SessionInfo): Session {
    let s = this.sessions.get(key);
    if (!s) {
      s = { key, ...info, working: false, lastSeen: 0 };
      this.sessions.set(key, s);
    }
    Object.assign(s, info);
    s.lastSeen = Date.now();
    return s;
  }

  remove(key: string): void {
    this.sessions.delete(key);
  }

  anyWorking(): boolean {
    return [...this.sessions.values()].some((s) => s.working);
  }

  /** Quantos agentes diferentes têm sessão aberta */
  providerCount(): number {
    return new Set([...this.sessions.values()].map((s) => s.provider)).size;
  }

  /** Mais recentes primeiro */
  list(): Session[] {
    return [...this.sessions.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  }

  /**
   * Expira sessões sumidas e "trabalhando" travados.
   * Retorna as chaves removidas e se algum estado de trabalho mudou.
   */
  prune(now = Date.now()): { removed: string[]; workingChanged: boolean } {
    const removed: string[] = [];
    let workingChanged = false;
    for (const s of this.sessions.values()) {
      const idle = now - s.lastSeen;
      const staleAfter = s.reportsCompletion ? WORKING_STALE_MS : WORKING_STALE_NO_COMPLETION_MS;
      if (idle > SESSION_TIMEOUT_MS) {
        this.sessions.delete(s.key);
        removed.push(s.key);
        if (s.working) workingChanged = true;
      } else if (s.working && idle > staleAfter) {
        s.working = false;
        workingChanged = true;
      }
    }
    return { removed, workingChanged };
  }
}
