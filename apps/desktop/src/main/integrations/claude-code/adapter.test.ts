import { describe, expect, it } from 'vitest';
import { MCP_TOOL_PREFIX, PROVIDER, claudeCode, hookToSignal, parseHookInput } from './adapter';

describe('parseHookInput', () => {
  it('pega só os campos que o adapter usa', () => {
    expect(parseHookInput({
      hook_event_name: 'PreToolUse', session_id: 's1', cwd: 'C:\\dev\\api', tool_name: 'Edit',
      tool_input: { file_path: 'x' }, transcript_path: 'y',
    })).toEqual({ hook_event_name: 'PreToolUse', session_id: 's1', cwd: 'C:\\dev\\api', tool_name: 'Edit', source: undefined });
  });

  it('rejeita payload sem nome de evento', () => {
    expect(parseHookInput({ session_id: 's1' })).toBeNull();
    expect(parseHookInput(null)).toBeNull();
    expect(parseHookInput({ hook_event_name: 42 })).toBeNull();
  });
});

describe('hookToSignal', () => {
  const tool = (tool_name: string) => hookToSignal({ hook_event_name: 'PreToolUse', tool_name });

  it('identifica agente, sessão e projeto', () => {
    expect(hookToSignal({ hook_event_name: 'Stop', session_id: 's1', cwd: 'K:\\dev\\front' })?.source)
      .toEqual({ provider: PROVIDER, sessionId: 's1', project: 'front' });
  });

  it('sem sessão nem pasta, usa valores padrão', () => {
    expect(hookToSignal({ hook_event_name: 'Stop' })?.source).toEqual({ provider: PROVIDER, sessionId: 'default', project: 'claude' });
  });

  it('mapeia ferramentas pra atividades', () => {
    expect(tool('Read')?.event?.state).toBe('reading');
    expect(tool('Grep')?.event?.state).toBe('searching');
    expect(tool('Edit')?.event?.state).toBe('typing');
    expect(tool('Bash')?.event?.state).toBe('terminal');
    expect(tool('PowerShell')?.event?.state).toBe('terminal');
    expect(tool('WebFetch')?.event?.state).toBe('web');
    expect(tool('mcp__Claude_Browser__navigate')?.event?.state).toBe('web');
    expect(tool('Agent')?.event?.state).toBe('delegating');
    expect(tool('mcp__outro__qualquer')?.event).toEqual({ state: 'thinking', working: true });
  });

  it('ferramentas do próprio MCP marcam a chamada e não mudam o visual', () => {
    const signal = tool(`${MCP_TOOL_PREFIX}say`);
    expect(signal?.mcpCall).toBe(true);
    expect(signal?.event).toBeNull();
    expect(tool('Edit')?.mcpCall).toBe(false);
  });

  it('ciclo de vida e trabalho', () => {
    expect(hookToSignal({ hook_event_name: 'SessionStart', source: 'startup' })).toMatchObject({ lifecycle: 'start', event: { state: 'attention' } });
    expect(hookToSignal({ hook_event_name: 'UserPromptSubmit' })).toMatchObject({ working: true, event: { state: 'listening' } });
    expect(hookToSignal({ hook_event_name: 'Stop' })).toMatchObject({ working: false, event: { state: 'happy' } });
    expect(hookToSignal({ hook_event_name: 'SessionEnd' })).toMatchObject({ lifecycle: 'end', working: false, event: { state: 'sleeping' } });
  });

  it('erro e pedido de permissão', () => {
    expect(hookToSignal({ hook_event_name: 'PostToolUseFailure' })?.event?.state).toBe('error');
    expect(hookToSignal({ hook_event_name: 'Notification' })?.event?.state).toBe('attention');
  });

  it('depois de compactar a conversa, a sessão continua mas ela não cumprimenta de novo', () => {
    expect(hookToSignal({ hook_event_name: 'SessionStart', source: 'compact' })).toMatchObject({ lifecycle: 'start', event: null });
  });

  it('eventos desconhecidos são ignorados', () => {
    expect(hookToSignal({ hook_event_name: 'PreCompact' })).toBeNull();
  });
});

describe('adapter claudeCode', () => {
  it('recebe na rota /hook (a do plugin) e traduz o JSON cru', () => {
    expect(claudeCode.routes).toContain('/hook');
    expect(claudeCode.toSignal({ hook_event_name: 'Stop', session_id: 'x' })?.working).toBe(false);
    expect(claudeCode.toSignal('lixo')).toBeNull();
  });
});
