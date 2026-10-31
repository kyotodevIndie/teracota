import { describe, expect, it } from 'vitest';
import { MCP_REMOVE_ARGS, PLUGIN_ID, TERMINAL_COMMAND, isInstalled, isMcpConfigured, mcpAddArgs } from './connect';

describe('comandos da CLI do Claude', () => {
  it('comando manual de uma linha: marketplace + plugin, separados por ";" (PowerShell, bash, zsh)', () => {
    expect(TERMINAL_COMMAND).toBe('claude plugin marketplace add kyotodevIndie/teracota; claude plugin install teracota@teracota');
  });

  it('MCP opcional no escopo de usuário, apontando pra porta do app', () => {
    expect(mcpAddArgs(7777)).toEqual(['mcp', 'add', '--scope', 'user', '--transport', 'http', 'teracota', 'http://127.0.0.1:7777/mcp']);
    expect(mcpAddArgs(7788).at(-1)).toBe('http://127.0.0.1:7788/mcp');
    expect(MCP_REMOVE_ARGS).toEqual(['mcp', 'remove', '--scope', 'user', 'teracota']);
  });

  it('plugin id no formato nome@marketplace', () => {
    expect(PLUGIN_ID).toBe('teracota@teracota');
  });
});

describe('leitura das respostas da CLI', () => {
  it('plugin instalado (saída de `claude plugin list`)', () => {
    expect(isInstalled('Installed plugins:\n\n  ❯ teracota@teracota\n    Version: 0.1.0')).toBe(true);
    expect(isInstalled('No plugins installed. Use `claude plugin install` to install a plugin.')).toBe(false);
    // o nome antigo (com dois Rs) não conta como instalado
    expect(isInstalled('  ❯ terracota@terracota')).toBe(false);
  });

  it('MCP configurado (saída de `claude mcp get teracota`)', () => {
    expect(isMcpConfigured(true, 'teracota:\n  Scope: User config\n  Type: http\n  URL: http://127.0.0.1:7777/mcp')).toBe(true);
    expect(isMcpConfigured(false, 'No MCP server found with name: teracota')).toBe(false);
    expect(isMcpConfigured(true, 'algo sem endereço')).toBe(false);
  });
});
