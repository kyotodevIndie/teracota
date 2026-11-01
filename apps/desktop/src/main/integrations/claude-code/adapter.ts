// Adapter do Claude Code: recebe o JSON cru dos hooks (enviado por curl pelo
// plugin, em POST /hook) e traduz pra sinais normalizados do Teracota.
import { MCP_SERVER_NAME } from '../../../shared/brand';
import { projectName } from '../../sessions';
import type { Activity, AgentRequest } from '../../../shared/live';
import type { AgentAdapter, AgentSignal } from '../types';
import { TERMINAL_COMMAND, disableMcp, enableMcp, installPlugin, mcpEnabled, pluginStatus } from './connect';
import { claudeUsage } from './statusline';
import type { ToolActivity } from '@tera/agent-bridge/contract';

export const PROVIDER = 'claude-code';

export interface HookInput {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  source?: string;
  /** Entrada da ferramenta (PreToolUse); só alguns campos são lidos */
  tool_input?: Record<string, unknown>;
  /** Notification: texto e tipo (permission_prompt, idle_prompt...) */
  message?: string;
  notification_type?: string;
}

const DETAIL_MAX = 90;
const OPTIONS_MAX = 6;

/** Uma linha curta pra mostrar na interface */
export function clip(text: string, max = DETAIL_MAX): string {
  const line = text.trim().split(/\r?\n/)[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

const baseName = (p: string) => p.split(/[\\/]+/).filter(Boolean).pop() ?? p;

/** O que mostrar da entrada da ferramenta: arquivo, comando, busca ou endereço */
export function toolDetail(name: string | undefined, input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  const str = (k: string) => (typeof input[k] === 'string' && input[k] ? (input[k] as string) : undefined);
  const file = str('file_path') ?? str('notebook_path') ?? str('path');
  if (name && /^(Read|Edit|Write|MultiEdit|NotebookEdit|NotebookRead)$/.test(name) && file) return clip(baseName(file));
  const command = str('command');
  if (command) return clip(command);
  const pattern = str('pattern') ?? str('query');
  if (pattern) return clip(pattern);
  const url = str('url');
  if (url) {
    try { return new URL(url).host; } catch { return clip(url); }
  }
  const description = str('description');
  return description ? clip(description) : undefined;
}

/** Pergunta do AskUserQuestion (a primeira, com as alternativas) */
export function questionRequest(input: Record<string, unknown> | undefined, at = Date.now()): AgentRequest | null {
  const list = Array.isArray(input?.questions) ? (input!.questions as unknown[]) : [];
  const q = list[0] as Record<string, unknown> | undefined;
  if (!q || typeof q.question !== 'string') return null;
  const options = (Array.isArray(q.options) ? q.options : [])
    .map((o) => (typeof o === 'string' ? o : typeof (o as { label?: unknown })?.label === 'string' ? (o as { label: string }).label : null))
    .filter((o): o is string => !!o)
    .slice(0, OPTIONS_MAX)
    .map((o) => clip(o, 60));
  return { kind: 'question', message: clip(q.question, 200), ...(options.length && { options }), at };
}

const PERMISSION_TEXT: Record<string, string> = {
  Bash: 'Quer rodar um comando', PowerShell: 'Quer rodar um comando',
  Edit: 'Quer editar um arquivo', Write: 'Quer criar um arquivo', MultiEdit: 'Quer editar um arquivo', NotebookEdit: 'Quer editar um notebook',
  WebFetch: 'Quer abrir um site', WebSearch: 'Quer pesquisar na web',
};

/** O texto do Claude Code vem em inglês: os conhecidos viram português */
export function translateMessage(message: string): string {
  const perm = /needs your permission to use (.+?)\.?$/i.exec(message);
  if (perm) {
    const tool = perm[1]!.trim();
    const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
    return PERMISSION_TEXT[tool] ?? (mcp ? `Quer usar ${mcp[2]} (${mcp[1]})` : `Quer usar ${tool}`);
  }
  if (/waiting for your input/i.test(message)) return 'Esperando você';
  return message;
}

/** Notification do Claude Code → pedido pro usuário (null = não é um pedido, ex.: idle_prompt) */
export function notificationRequest(input: HookInput, at = Date.now()): AgentRequest | null {
  const message = input.message ? translateMessage(clip(input.message, 200)) : '';
  const type = input.notification_type;
  if (type === 'permission_prompt' || (!type && /permiss/i.test(message))) {
    return { kind: 'permission', message: message || 'Pediu permissão', at };
  }
  // idle_prompt chega um tempo depois de toda tarefa terminada: não é um pedido de verdade
  if (type === 'elicitation_dialog') return { kind: 'question', message: message || 'Tem uma pergunta', at };
  return null;
}

function toolActivity(name: string | undefined, input: Record<string, unknown> | undefined): Activity | null {
  const kind = toolState(name);
  if (!kind) return null;
  const detail = toolDetail(name, input);
  return detail ? { kind, detail } : { kind };
}

/** As ferramentas do MCP do Teracota aparecem pro Claude como mcp__teracota__say etc. */
export const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

const TOOL_STATES: Record<string, ToolActivity> = {
  Read: 'reading', NotebookRead: 'reading',
  Grep: 'searching', Glob: 'searching', ToolSearch: 'searching',
  Edit: 'typing', Write: 'typing', MultiEdit: 'typing', NotebookEdit: 'typing',
  Bash: 'terminal', PowerShell: 'terminal', Monitor: 'terminal',
  WebFetch: 'web', WebSearch: 'web',
  Agent: 'delegating', Task: 'delegating',
};

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

export function toolState(name = ''): ToolActivity | null {
  if (name.startsWith(MCP_TOOL_PREFIX)) return null; // o próprio MCP já controla a Tera
  if (TOOL_STATES[name]) return TOOL_STATES[name];
  if (/browser|chrome/i.test(name)) return 'web';
  return 'thinking';
}

export function parseHookInput(input: unknown): HookInput | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const hook: HookInput = {
    hook_event_name: str(o.hook_event_name),
    session_id: str(o.session_id),
    cwd: str(o.cwd),
    tool_name: str(o.tool_name),
    source: str(o.source),
    message: str(o.message),
    notification_type: str(o.notification_type),
  };
  if (o.tool_input && typeof o.tool_input === 'object' && !Array.isArray(o.tool_input)) {
    hook.tool_input = o.tool_input as Record<string, unknown>;
  }
  return hook.hook_event_name ? hook : null;
}

/** Evento de hook → sinal normalizado */
export function hookToSignal(input: HookInput): AgentSignal | null {
  const source = {
    provider: PROVIDER,
    sessionId: input.session_id ?? 'default',
    project: projectName(input.cwd) ?? 'claude',
  };
  switch (input.hook_event_name) {
    case 'SessionStart':
      // /clear e compactação também disparam SessionStart — só cumprimenta em sessão nova
      return {
        source,
        lifecycle: 'start',
        event: input.source === 'compact'
          ? null
          : { state: 'attention', duration: 3000, say: pick(['Oi! Bora trabalhar?', 'Cheguei! ✨', 'Pronta pra codar!']) },
      };
    case 'UserPromptSubmit':
      return { source, working: true, event: { state: 'listening', working: true }, activity: { kind: 'listening' }, request: null };
    case 'PreToolUse': {
      if (input.tool_name === 'AskUserQuestion') {
        const request = questionRequest(input.tool_input);
        return {
          source,
          working: true,
          event: { state: 'attention', working: true, say: pick(['Tenho uma pergunta!', 'Psiu, preciso decidir uma coisa.']) },
          ...(request && { request }),
        };
      }
      const state = toolState(input.tool_name);
      const activity = toolActivity(input.tool_name, input.tool_input);
      return {
        source,
        working: true,
        mcpCall: input.tool_name?.startsWith(MCP_TOOL_PREFIX) ?? false,
        event: state ? { state, working: true } : null,
        ...(activity && { activity }),
        request: null,
      };
    }
    case 'PostToolUseFailure':
      return { source, event: { state: 'error', say: pick(['Ops...', 'Hmm, deu erro.', 'Eita!']) } };
    case 'Notification': {
      const request = notificationRequest(input);
      return {
        source,
        event: { state: 'attention', say: pick(['Ei, preciso de você!', 'Psiu! Dá uma olhada?', 'Tô esperando você 👀']) },
        ...(request && { request }),
      };
    }
    case 'Stop':
      return {
        source,
        working: false,
        event: { state: 'happy', working: false, say: pick(['Pronto!', 'Terminei! ✨', 'Feito!', 'Tá aí!']) },
        activity: { kind: 'idle' },
        request: null,
      };
    case 'SessionEnd':
      return { source, lifecycle: 'end', working: false, event: { state: 'sleeping', working: false, say: 'Até mais! 💤' } };
    default:
      return null;
  }
}

export const claudeCode: AgentAdapter = {
  id: PROVIDER,
  displayName: 'Claude Code',
  capabilities: {
    sessions: true,
    toolEvents: true,
    fileEvents: false, // edição chega como ferramenta (Edit/Write), não como evento de arquivo
    permissions: true,
    errors: true,
    completion: true,
    messages: true,
    mcp: true,
  },
  routes: ['/hook', '/integrations/claude-code'],
  connect: {
    label: 'Conectar ao Claude Code',
    run: installPlugin,
    status: pluginStatus,
    manualCommand: TERMINAL_COMMAND,
    // carrega o plugin recém-instalado numa sessão já aberta, sem reiniciar
    openSessions: { command: '/reload-plugins' },
    // MCP opcional (escopo de usuário), fora do plugin: com o app fechado ele dá erro no Claude Code
    speech: { enable: enableMcp, disable: disableMcp, enabled: mcpEnabled },
  },
  toSignal: (body) => {
    const input = parseHookInput(body);
    return input && hookToSignal(input);
  },
  badge: { text: 'C', color: '#d97757' },
  usage: claudeUsage,
};
