// SDK falso, determinístico e roteirizável (testes do adapter e do orquestrador). Nunca chama o Claude real.
import type { SdkApi, SdkMessageLike, SdkQuery } from './claude-runner';

export interface FakeCtl {
  // biome-ignore lint/suspicious/noExplicitAny: opções do SDK são livres nos testes
  options: Record<string, any>;
  prompt: unknown[];
  /** Resolve quando o runner chamar `query.interrupt()`. */
  interrupted: Promise<void>;
  /** Resolve quando o runner fechar a entrada (fim do turno) — o "CLI" deve sair. */
  promptClosed: Promise<void>;
  closed: boolean;
  /** Chama o canUseTool do runner como o CLI faria. */
  // biome-ignore lint/suspicious/noExplicitAny: resposta do canUseTool
  canUse(toolName: string, input: Record<string, unknown>, toolUseID?: string): Promise<Record<string, any>>;
  /** Chama o hook PreToolUse como o CLI faria (antes do canUseTool). */
  preToolUse(toolName: string, input: Record<string, unknown>, toolUseID: string): Promise<Record<string, unknown>>;
  sessionId(): string;
}
export type Scenario = (ctl: FakeCtl) => AsyncGenerator<SdkMessageLike>;

export const init = (ctl: FakeCtl): SdkMessageLike => ({
  type: 'system', subtype: 'init', session_id: ctl.sessionId(), model: 'fake-model', claude_code_version: '0.0.0-fake', cwd: ctl.options.cwd,
});
export const result = (over: Record<string, unknown> = {}): SdkMessageLike => ({
  type: 'result', subtype: 'success', is_error: false, duration_ms: 12, errors: [], ...over,
});
export const toolUse = (id: string, name: string, input: Record<string, unknown>): SdkMessageLike => ({
  type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] },
});
export const toolResultMsg = (id: string): SdkMessageLike => ({
  type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
});

/** Conclui com sucesso depois de opcionalmente executar ferramentas (respeitando canUseTool). */
export function happy(tools: { id: string; name: string; input: Record<string, unknown> }[] = []): Scenario {
  return async function* (ctl) {
    yield init(ctl);
    for (const t of tools) {
      yield toolUse(t.id, t.name, t.input);
      const r = await ctl.canUse(t.name, t.input, t.id);
      if (r.behavior === 'allow') yield toolResultMsg(t.id);
      else if (r.interrupt) { yield result({ subtype: 'error_during_execution', is_error: true }); return; }
    }
    yield { type: 'assistant', message: { content: [{ type: 'text', text: 'pronto' }] } };
    yield result();
    await ctl.promptClosed;
  };
}

export class FakeSdk implements SdkApi {
  readonly calls: FakeCtl[] = [];
  private readonly queue: Scenario[] = [];
  constructor(private readonly fallback: Scenario = happy()) {}

  next(...s: Scenario[]): this { this.queue.push(...s); return this; }

  query(p: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }): SdkQuery {
    let resolveInt!: () => void;
    const interrupted = new Promise<void>((r) => { resolveInt = r; });
    let resolveClosed!: () => void;
    const promptClosed = new Promise<void>((r) => { resolveClosed = r; });
    // biome-ignore lint/suspicious/noExplicitAny: opções do SDK são livres nos testes
    const options = p.options as Record<string, any>;
    const ctl: FakeCtl = {
      options, prompt: [], interrupted, promptClosed, closed: false,
      canUse: (n, i, id) => options.canUseTool(n, i, { signal: new AbortController().signal, toolUseID: id }),
      preToolUse: (n, i, id) => options.hooks.PreToolUse[0].hooks[0]({ hook_event_name: 'PreToolUse', tool_name: n, tool_input: i, tool_use_id: id }, id, { signal: new AbortController().signal }),
      sessionId: () => String(options.sessionId ?? options.resume),
    };
    this.calls.push(ctl);
    (async () => {
      for await (const m of p.prompt) ctl.prompt.push(m);
      resolveClosed();
    })().catch(() => resolveClosed());
    const gen = (this.queue.shift() ?? this.fallback)(ctl);
    let closeNow!: () => void;
    const closedP = new Promise<{ done: true; value: undefined }>((r) => { closeNow = () => r({ done: true, value: undefined }); });
    const it = {
      next: () => Promise.race([gen.next(), closedP]),
      return: async () => ({ done: true as const, value: undefined }),
      [Symbol.asyncIterator]() { return this; },
    };
    return {
      [Symbol.asyncIterator]: () => it,
      interrupt: async () => { resolveInt(); },
      close: () => { ctl.closed = true; resolveClosed(); closeNow(); },
    } as SdkQuery;
  }
}
