// Provider do painel de conversa: dirige o Claude Code pelo Agent SDK oficial.
//
// Decisões:
// - Autenticação: só por ANTHROPIC_API_KEY do ambiente do usuário. A doc do Agent SDK não permite
//   que apps de terceiros ofereçam o login do claude.ai; por isso o provider só fica disponível com a
//   chave definida, e uma sessão que não use a chave é interrompida ao receber o `init`.
//   Este código nunca lê, grava, loga nem repassa o valor da chave.
// - Usa o `claude` que o usuário já instalou (pathToClaudeCodeExecutable), sem embutir binário.
// - Permissões: canUseTool, sempre decisão do usuário; nunca bypassPermissions nem "sempre permitir".
// - settingSources vazio: sem CLAUDE.md, sem regras nem hooks de settings; toda ferramenta sensível
//   passa por canUseTool.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Options, PermissionResult, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ProviderEventBody, SessionSummary } from '../../../shared/bridge';
import type { AgentProvider, ProviderSession, ProviderSink } from '../../bridge/types';
import { toolState } from './adapter';

export type QueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query;

export interface ClaudeCodeProviderDeps {
  loadQuery(): Promise<QueryFn>;
  findExecutable(): Promise<string | null>;
  listSessions(cwd: string): Promise<SessionSummary[]>;
  env: NodeJS.ProcessEnv;
}

export const API_KEY_REASON =
  'Requer ANTHROPIC_API_KEY no ambiente (o login do Claude Code não é suportado para o Agent SDK em apps de terceiros)';
const NO_EXE_REASON = 'O comando "claude" não foi encontrado no PATH.';
const AUTH_ABORT_MESSAGE =
  'A sessão não está usando ANTHROPIC_API_KEY (login da assinatura não é permitido no Agent SDK em apps de terceiros). Sessão interrompida.';
export const MAX_TURNS = 20;
const DETAIL_LIMIT = 2000;
const INTERRUPT_WAIT_MS = 5000;
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Read']);

/** Caminho do `claude` no PATH (no Windows, prefere o .exe) */
export function findClaudeOnPath(): Promise<string | null> {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  return new Promise((resolve) => {
    execFile(cmd, ['claude'], { encoding: 'utf8', timeout: 3000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      resolve((process.platform === 'win32' ? lines.find((l) => /\.exe$/i.test(l)) : undefined) ?? lines[0] ?? null);
    });
  });
}

const defaultDeps: ClaudeCodeProviderDeps = {
  loadQuery: async () => (await import('@anthropic-ai/claude-agent-sdk')).query as QueryFn,
  findExecutable: findClaudeOnPath,
  listSessions: async (cwd) => {
    const { listSessions } = await import('@anthropic-ai/claude-agent-sdk');
    const list = await listSessions({ dir: cwd, limit: 20 });
    return list.map((s) => ({
      id: s.sessionId,
      title: (s.customTitle || s.summary || s.firstPrompt || s.sessionId).slice(0, 120),
      lastModified: s.lastModified,
    }));
  },
  env: process.env,
};

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Texto do pedido de permissão e se mexe fora do projeto */
export function describePermission(toolName: string, input: Record<string, unknown>, cwd: string): { detail: string; outsideCwd: boolean } {
  if (toolName === 'Bash' && typeof input.command === 'string') return { detail: input.command, outsideCwd: false };
  if (FILE_TOOLS.has(toolName)) {
    const p = input.file_path ?? input.notebook_path;
    if (typeof p === 'string' && p) {
      const abs = path.resolve(cwd, p);
      const rel = path.relative(cwd, abs);
      return { detail: abs, outsideCwd: rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) };
    }
  }
  let json: string;
  try {
    json = JSON.stringify(input) ?? '';
  } catch {
    json = '';
  }
  return { detail: truncate(json, DETAIL_LIMIT), outsideCwd: false };
}

function toolSummary(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const i = input as Record<string, unknown>;
  const v = i.command ?? i.file_path ?? i.notebook_path ?? i.pattern ?? i.url ?? i.path;
  return typeof v === 'string' ? truncate(v, 200) : '';
}

/** Fila assíncrona: o SDK consome as mensagens do usuário à medida que chegam */
class Inbox implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private done = false;
  push(m: SDKUserMessage): void { this.items.push(m); this.wake?.(); }
  end(): void { this.done = true; this.wake?.(); }
  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (true) {
      while (this.items.length) yield this.items.shift()!;
      if (this.done) return;
      await new Promise<void>((r) => { this.wake = r; });
      this.wake = null;
    }
  }
}

class ClaudeSession implements ProviderSession {
  private readonly inbox = new Inbox();
  private q: Query | null = null;
  private readonly pending = new Map<string, (r: PermissionResult) => void>();
  private running = false;
  private closed = false;
  private dead = false;
  private interrupting = false;
  private emittedText = false;
  private turnText = '';
  private onTurnEnded: (() => void) | null = null;

  constructor(
    private readonly cwd: string,
    private readonly sink: ProviderSink,
  ) {}

  start(query: QueryFn, executable: string, resumeId: string | undefined): void {
    const options: Options = {
      cwd: this.cwd,
      pathToClaudeCodeExecutable: executable,
      permissionMode: 'default',
      settingSources: [],
      includePartialMessages: true,
      maxTurns: MAX_TURNS,
      canUseTool: (toolName, input, { signal }) => this.askPermission(toolName, input, signal),
      ...(resumeId ? { resume: resumeId } : {}),
    };
    this.q = query({ prompt: this.inbox, options });
    void this.pump(this.q);
  }

  send(text: string): void {
    if (this.dead || this.closed) {
      this.sink({ type: 'turn-end', outcome: 'error', message: 'A sessão do agente foi encerrada.' });
      return;
    }
    this.running = true;
    this.emittedText = false;
    this.turnText = '';
    this.inbox.push({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, parent_tool_use_id: null });
  }

  respondPermission(id: string, allow: boolean): void {
    const resolve = this.pending.get(id);
    if (!resolve) return;
    this.pending.delete(id);
    resolve(allow ? { behavior: 'allow' } : { behavior: 'deny', message: 'O usuário recusou pela interface da Teracota.' });
  }

  async interrupt(): Promise<void> {
    if (!this.running || !this.q) return;
    this.interrupting = true;
    this.denyAll('interrompido');
    const ended = new Promise<void>((resolve) => { this.onTurnEnded = resolve; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let failed = false;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => { timedOut = true; resolve(); }, INTERRUPT_WAIT_MS);
      timer.unref?.();
    });
    // interrupt() que nunca resolve não trava: vale o que vier primeiro (fim do turno, timeout ou falha)
    const failedP = new Promise<void>((resolve) => {
      void this.q!.interrupt().catch(() => { failed = true; resolve(); });
    });
    try {
      await Promise.race([ended, timeout, failedP]);
    } finally {
      clearTimeout(timer);
      this.onTurnEnded = null;
      if (this.running) this.endTurn({ type: 'turn-end', outcome: 'cancelled' });
      this.interrupting = false;
      if (timedOut || failed) {
        // o agente não parou: a sessão fica inutilizável
        this.dead = true;
        this.close();
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.denyAll('sessão encerrada');
    this.inbox.end();
    this.q?.close();
  }

  // ---------- internos ----------

  private denyAll(message: string): void {
    for (const [id, resolve] of [...this.pending]) {
      this.pending.delete(id);
      resolve({ behavior: 'deny', message });
    }
  }

  private askPermission(toolName: string, input: Record<string, unknown>, signal: AbortSignal): Promise<PermissionResult> {
    if (signal.aborted || this.closed) return Promise.resolve({ behavior: 'deny', message: 'cancelado' });
    return new Promise<PermissionResult>((resolve) => {
      const id = randomUUID();
      this.pending.set(id, resolve);
      signal.addEventListener('abort', () => {
        if (!this.pending.delete(id)) return;
        resolve({ behavior: 'deny', message: 'cancelado' });
        this.sink({ type: 'permission-resolved', id, allow: false });
      }, { once: true });
      const { detail, outsideCwd } = describePermission(toolName, input, this.cwd);
      this.sink({ type: 'permission-request', id, toolName, detail, outsideCwd });
    });
  }

  private endTurn(ev: Extract<ProviderEventBody, { type: 'turn-end' }>): void {
    this.running = false;
    this.sink(ev);
    this.onTurnEnded?.();
  }

  private async pump(q: Query): Promise<void> {
    try {
      for await (const m of q) {
        if (this.closed) break;
        if (!this.handle(m)) break;
      }
      if (!this.closed) {
        this.dead = true;
        if (this.running) this.endTurn({ type: 'turn-end', outcome: 'error', message: 'O agente encerrou inesperadamente.' });
      }
    } catch (err) {
      if (this.closed) return;
      this.dead = true;
      const detail = err instanceof Error && err.message ? `: ${truncate(err.message, 200)}` : '';
      this.endTurn({ type: 'turn-end', outcome: 'error', message: `Falha na conexão com o agente${detail}` });
    }
  }

  /** @returns false quando a sessão foi abortada e o laço deve parar */
  private handle(m: SDKMessage): boolean {
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init') {
          if (m.apiKeySource !== 'ANTHROPIC_API_KEY') {
            // caiu no login da assinatura (ou origem desconhecida): não segue
            this.dead = true;
            this.closed = true;
            this.denyAll('autenticação não suportada');
            this.inbox.end();
            this.q?.close();
            this.endTurn({ type: 'turn-end', outcome: 'error', message: AUTH_ABORT_MESSAGE });
            return false;
          }
          this.sink({ type: 'session', sessionId: m.session_id, cwdLabel: path.basename(this.cwd) || this.cwd, model: m.model });
        }
        return true;
      case 'stream_event': {
        const ev = m.event;
        if (!m.parent_tool_use_id && ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          this.turnText += ev.delta.text;
          this.sink({ type: 'text-delta', text: ev.delta.text });
        }
        return true;
      }
      case 'assistant': {
        if (m.parent_tool_use_id) return true;
        const text = m.message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
        for (const b of m.message.content) {
          if (b.type === 'tool_use') this.sink({ type: 'tool', name: b.name, summary: toolSummary(b.input), activity: toolState(b.name) ?? undefined });
        }
        if (text.trim()) {
          this.emittedText = true;
          this.sink({ type: 'message', role: 'assistant', text });
        }
        return true;
      }
      case 'result': {
        if (!this.running) return true;
        if (this.interrupting) {
          this.endTurn({ type: 'turn-end', outcome: 'cancelled' });
        } else if (m.subtype === 'success' && !m.is_error) {
          const text = m.result || this.turnText;
          if (!this.emittedText && text.trim()) this.sink({ type: 'message', role: 'assistant', text });
          this.endTurn({ type: 'turn-end', outcome: 'done' });
        } else {
          this.endTurn({ type: 'turn-end', outcome: 'error', message: `O agente terminou com erro (${m.subtype}).` });
        }
        return true;
      }
      default:
        return true;
    }
  }
}

export function createClaudeCodeProvider(overrides: Partial<ClaudeCodeProviderDeps> = {}): AgentProvider {
  const deps: ClaudeCodeProviderDeps = { ...defaultDeps, ...overrides };
  return {
    id: 'claude-code',
    displayName: 'Claude Code',

    async checkAvailability() {
      if (!deps.env.ANTHROPIC_API_KEY?.trim()) return { available: false, reason: API_KEY_REASON };
      const exe = await deps.findExecutable().catch(() => null);
      if (!exe) return { available: false, reason: NO_EXE_REASON };
      return { available: true };
    },

    listSessions: (cwd) => deps.listSessions(cwd),

    async start({ cwd, resumeId }, sink) {
      if (!deps.env.ANTHROPIC_API_KEY?.trim()) throw new Error(API_KEY_REASON);
      const exe = await deps.findExecutable();
      if (!exe) throw new Error(NO_EXE_REASON);
      const query = await deps.loadQuery();
      const session = new ClaudeSession(cwd, sink);
      session.start(query, exe, resumeId);
      return session;
    },
  };
}
