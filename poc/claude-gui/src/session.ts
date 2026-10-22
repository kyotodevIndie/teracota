// Núcleo da POC: uma sessão do Claude Code dirigida pelo Agent SDK oficial.
//
// Decisões que importam pro relatório:
// - Usa o `claude` que o usuário já instalou (pathToClaudeCodeExecutable), sem modificar e sem
//   embutir binário. A autenticação é a que o próprio Claude Code já tem (login do usuário ou
//   ANTHROPIC_API_KEY); este código nunca lê nem toca em credenciais.
// - Modo "streaming input": a sessão fica viva entre mensagens, o que permite interrupt(),
//   imagens e respostas de permissão.
// - Permissões chegam por canUseTool e ficam pendentes até a interface responder.

import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import type {
  CanUseTool,
  HookCallback,
  Options,
  PermissionResult,
  PermissionUpdate,
  Query,
  SDKMessage,
  SDKSessionInfo,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

// O SDK é ESM; o bundle é CJS (igual ao app), então carrega sob demanda.
type Sdk = typeof import('@anthropic-ai/claude-agent-sdk');
let sdkPromise: Promise<Sdk> | null = null;
export const loadSdk = (): Promise<Sdk> => (sdkPromise ??= import('@anthropic-ai/claude-agent-sdk'));

/** Caminho do `claude` instalado pelo usuário (o SDK foi instalado sem o binário embutido). */
export function findClaude(): string {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const out = execFileSync(cmd, ['claude'], { encoding: 'utf8' });
  const first = out.split(/\r?\n/).find((l) => l.trim());
  if (!first) throw new Error('claude não encontrado no PATH');
  return first.trim();
}

export interface ImageInput { mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; base64: string }

export interface PermissionRequest {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  /** Regras sugeridas pelo Claude Code pra "sempre permitir" (podem não vir). */
  suggestions: unknown[];
}

export type SessionState = 'starting' | 'idle' | 'running' | 'waiting-permission' | 'closed' | 'error';

export interface SessionEvents {
  state: [SessionState];
  init: [{ sessionId: string; model: string; cwd: string; apiKeySource: string; claudeCodeVersion: string; tools: string[] }];
  text: [string];                                   // pedaço de texto em streaming
  tool: [{ id: string; name: string; input: unknown }];
  toolResult: [{ id: string; isError: boolean; preview: string }];
  fileChanged: [{ tool: string; path: string }];
  permission: [PermissionRequest];
  result: [{ subtype: string; costUsd: number; durationMs: number; turns: number; text: string }];
  raw: [SDKMessage];
  error: [Error];
}

export interface StartOptions {
  cwd: string;
  resume?: string;
  model?: string;
  claudePath?: string;
  /** Repassado ao SDK como está (pra testes isolarem configurações, etc.). */
  extra?: Partial<Options>;
}

/** Fila assíncrona: o SDK consome mensagens do usuário à medida que chegam. */
class Inbox implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private done = false;
  push(m: SDKUserMessage) { this.items.push(m); this.wake?.(); }
  end() { this.done = true; this.wake?.(); }
  async *[Symbol.asyncIterator]() {
    while (true) {
      while (this.items.length) yield this.items.shift()!;
      if (this.done) return;
      await new Promise<void>((r) => (this.wake = r));
      this.wake = null;
    }
  }
}

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

export class AgentSession extends EventEmitter<SessionEvents> {
  sessionId: string | null;
  state: SessionState = 'starting';
  private inbox = new Inbox();
  private q: Query | null = null;
  private pending = new Map<string, { resolve: (r: PermissionResult) => void; suggestions: PermissionUpdate[] }>();
  private seq = 0;
  private turnText = '';

  constructor(private readonly opts: StartOptions) {
    super();
    this.sessionId = opts.resume ?? null;
  }

  async start(): Promise<void> {
    const { query } = await loadSdk();
    const canUseTool: CanUseTool = (toolName, input, { signal, suggestions }) =>
      new Promise<PermissionResult>((resolve) => {
        const id = `perm-${++this.seq}`;
        this.pending.set(id, { resolve, suggestions: suggestions ?? [] });
        signal.addEventListener('abort', () => {
          this.pending.delete(id);
          resolve({ behavior: 'deny', message: 'cancelado' });
        });
        this.setState('waiting-permission');
        this.emit('permission', { id, toolName, input, suggestions: suggestions ?? [] });
      });

    const postToolUse: HookCallback = async (input) => {
      if (input.hook_event_name === 'PostToolUse' && FILE_TOOLS.has(input.tool_name)) {
        const ti = input.tool_input as { file_path?: string; notebook_path?: string };
        const path = ti.file_path ?? ti.notebook_path;
        if (path) this.emit('fileChanged', { tool: input.tool_name, path });
      }
      return {};
    };

    this.q = query({
      prompt: this.inbox,
      options: {
        cwd: this.opts.cwd,
        resume: this.opts.resume,
        model: this.opts.model,
        pathToClaudeCodeExecutable: this.opts.claudePath ?? findClaude(),
        includePartialMessages: true,
        canUseTool,
        hooks: { PostToolUse: [{ hooks: [postToolUse] }] },
        ...this.opts.extra,
      },
    });
    void this.pump();
  }

  send(text: string, images: ImageInput[] = []): void {
    const content = [
      ...images.map((img) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64 } })),
      { type: 'text' as const, text },
    ];
    this.turnText = '';
    this.setState('running');
    this.inbox.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null });
  }

  respond(id: string, allow: boolean, opts: { always?: boolean; reason?: string } = {}): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    this.setState('running');
    p.resolve(allow
      ? { behavior: 'allow', updatedPermissions: opts.always ? p.suggestions : undefined }
      : { behavior: 'deny', message: opts.reason ?? 'O usuário recusou pela interface da Teracota.' });
  }

  async interrupt(): Promise<void> {
    for (const id of [...this.pending.keys()]) this.respond(id, false, { reason: 'interrompido' });
    await this.q?.interrupt();
  }

  close(): void {
    this.inbox.end();
    this.q?.close();
    this.setState('closed');
  }

  private setState(s: SessionState) {
    if (this.state === s) return;
    this.state = s;
    this.emit('state', s);
  }

  private async pump() {
    try {
      for await (const m of this.q!) {
        this.emit('raw', m);
        this.handle(m);
      }
      if (this.state !== 'closed') this.setState('closed');
    } catch (err) {
      this.setState('error');
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  private handle(m: SDKMessage) {
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init') {
          this.sessionId = m.session_id;
          this.emit('init', {
            sessionId: m.session_id, model: m.model, cwd: m.cwd, apiKeySource: m.apiKeySource,
            claudeCodeVersion: m.claude_code_version, tools: m.tools,
          });
          if (this.state === 'starting') this.setState('idle');
        }
        break;
      case 'stream_event': {
        const ev = m.event;
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          this.turnText += ev.delta.text;
          this.emit('text', ev.delta.text);
        }
        break;
      }
      case 'assistant':
        for (const block of m.message.content) {
          if (block.type === 'tool_use') this.emit('tool', { id: block.id, name: block.name, input: block.input });
        }
        break;
      case 'user': {
        const content = m.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block === 'object' && block.type === 'tool_result') {
              const c = block.content;
              const preview = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => ('text' in x ? x.text : `[${x.type}]`)).join(' ') : '';
              this.emit('toolResult', { id: block.tool_use_id, isError: !!block.is_error, preview: preview.slice(0, 200) });
            }
          }
        }
        break;
      }
      case 'result':
        this.emit('result', {
          subtype: m.subtype, costUsd: m.total_cost_usd, durationMs: m.duration_ms, turns: m.num_turns,
          text: m.subtype === 'success' ? m.result : this.turnText,
        });
        this.setState('idle');
        break;
    }
  }
}

export async function listProjectSessions(dir: string, limit = 20): Promise<SDKSessionInfo[]> {
  const { listSessions } = await loadSdk();
  return listSessions({ dir, limit });
}
