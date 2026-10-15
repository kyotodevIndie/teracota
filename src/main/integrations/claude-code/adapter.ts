// Adapter do Claude Code: recebe o JSON cru dos hooks (enviado por curl pelo
// plugin, em POST /hook) e traduz pra sinais normalizados do Teracota.
import { MCP_SERVER_NAME } from '../../../shared/brand';
import type { StateName } from '../../../shared/protocol';
import { projectName } from '../../sessions';
import type { AgentAdapter, AgentSignal } from '../types';
import { TERMINAL_COMMAND, disableMcp, enableMcp, installPlugin, mcpEnabled, pluginStatus } from './connect';

export const PROVIDER = 'claude-code';

export interface HookInput {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  source?: string;
}

/** As ferramentas do MCP do Teracota aparecem pro Claude como mcp__teracota__say etc. */
export const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

const TOOL_STATES: Record<string, StateName> = {
  Read: 'reading', NotebookRead: 'reading',
  Grep: 'searching', Glob: 'searching', ToolSearch: 'searching',
  Edit: 'typing', Write: 'typing', MultiEdit: 'typing', NotebookEdit: 'typing',
  Bash: 'terminal', PowerShell: 'terminal', Monitor: 'terminal',
  WebFetch: 'web', WebSearch: 'web',
  Agent: 'delegating', Task: 'delegating',
};

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

export function toolState(name = ''): StateName | null {
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
  };
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
      return { source, working: true, event: { state: 'listening', working: true } };
    case 'PreToolUse': {
      const state = toolState(input.tool_name);
      return {
        source,
        working: true,
        mcpCall: input.tool_name?.startsWith(MCP_TOOL_PREFIX) ?? false,
        event: state ? { state, working: true } : null,
      };
    }
    case 'PostToolUseFailure':
      return { source, event: { state: 'error', say: pick(['Ops...', 'Hmm, deu erro.', 'Eita!']) } };
    case 'Notification':
      return { source, event: { state: 'attention', say: pick(['Ei, preciso de você!', 'Psiu! Dá uma olhada?', 'Tô esperando você 👀']) } };
    case 'Stop':
      return { source, working: false, event: { state: 'happy', working: false, say: pick(['Pronto!', 'Terminei! ✨', 'Feito!', 'Tá aí!']) } };
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
};
