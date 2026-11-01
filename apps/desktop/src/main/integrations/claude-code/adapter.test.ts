import { describe, expect, it } from 'vitest';
import {
  MCP_TOOL_PREFIX, PROVIDER, claudeCode, hookToSignal, notificationRequest, parseHookInput, questionRequest, toolDetail, translateMessage,
} from './adapter';

describe('parseHookInput', () => {
  it('pega só os campos que o adapter usa', () => {
    expect(parseHookInput({
      hook_event_name: 'PreToolUse', session_id: 's1', cwd: 'C:\\dev\\api', tool_name: 'Edit',
      tool_input: { file_path: 'x' }, transcript_path: 'y',
    })).toEqual({
      hook_event_name: 'PreToolUse', session_id: 's1', cwd: 'C:\\dev\\api', tool_name: 'Edit', source: undefined,
      message: undefined, notification_type: undefined, tool_input: { file_path: 'x' },
    });
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

describe('o que a interface mostra de cada sessão', () => {
  it('detalhe da ferramenta: arquivo, comando, busca, site', () => {
    expect(toolDetail('Edit', { file_path: 'C:\\dev\\api\\src\\app.ts' })).toBe('app.ts');
    expect(toolDetail('Read', { file_path: '/home/x/README.md' })).toBe('README.md');
    expect(toolDetail('Bash', { command: 'npm test\nnpm run build' })).toBe('npm test');
    expect(toolDetail('Grep', { pattern: 'useAuth' })).toBe('useAuth');
    expect(toolDetail('WebFetch', { url: 'https://docs.example.com/a?b' })).toBe('docs.example.com');
    expect(toolDetail('Bash', { command: 'x'.repeat(200) })!.length).toBeLessThanOrEqual(90);
    expect(toolDetail('Bash', undefined)).toBeUndefined();
  });

  it('pergunta do AskUserQuestion com as alternativas', () => {
    expect(questionRequest({ questions: [{ question: 'Qual lib?', options: [{ label: 'Zustand' }, { label: 'Redux' }] }] }, 7))
      .toEqual({ kind: 'question', message: 'Qual lib?', options: ['Zustand', 'Redux'], at: 7 });
    expect(questionRequest({ questions: [] })).toBeNull();
    expect(questionRequest(undefined)).toBeNull();
  });

  it('notificação de permissão vira pedido, em português; a de ocioso não', () => {
    expect(notificationRequest({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' }, 1))
      .toEqual({ kind: 'permission', message: 'Quer rodar um comando', at: 1 });
    expect(notificationRequest({ message: 'Claude is waiting for your input', notification_type: 'idle_prompt' })).toBeNull();
    expect(translateMessage('Claude needs your permission to use mcp__github__create_issue')).toBe('Quer usar create_issue (github)');
    expect(translateMessage('Algo novo')).toBe('Algo novo');
  });

  it('o pedido some quando a sessão segue (nova ferramenta, novo prompt, fim)', () => {
    const base = { session_id: 's', cwd: '/p' };
    expect(hookToSignal({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/p/a.ts' } }))
      .toMatchObject({ request: null, activity: { kind: 'reading', detail: 'a.ts' } });
    expect(hookToSignal({ ...base, hook_event_name: 'UserPromptSubmit' })).toMatchObject({ request: null });
    expect(hookToSignal({ ...base, hook_event_name: 'Stop' })).toMatchObject({ request: null, activity: { kind: 'idle' } });
  });

  it('AskUserQuestion vira pedido de pergunta (e não atividade)', () => {
    const s = hookToSignal({ session_id: 's', cwd: '/p', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Q?' }] } });
    expect(s?.request).toMatchObject({ kind: 'question', message: 'Q?' });
    expect(s).not.toHaveProperty('activity');
  });
});
