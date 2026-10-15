import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADAPTERS, adapterForRoute, providerInfo } from '.';

describe('registro de integrações', () => {
  it('ids e rotas únicos entre os adapters', () => {
    const ids = ADAPTERS.map((a) => a.id);
    const routes = ADAPTERS.flatMap((a) => a.routes);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('rotas de adapters não colidem com as rotas do core', () => {
    for (const route of ADAPTERS.flatMap((a) => a.routes)) {
      expect(['/event', '/api/v1/event', '/mcp', '/health']).not.toContain(route);
    }
  });

  it('acha o adapter pela rota', () => {
    expect(adapterForRoute('/hook')?.id).toBe('claude-code');
    expect(adapterForRoute('/nada')).toBeUndefined();
  });

  it('provider oficial usa as capabilities do adapter', () => {
    expect(providerInfo('claude-code')).toMatchObject({ displayName: 'Claude Code', capabilities: { completion: true } });
  });

  it('provider simulado do painel: conclusão garantida', () => {
    expect(providerInfo('simulado').capabilities.completion).toBe(true);
  });

  it('provider da comunidade: nome = id e sem garantia de conclusão', () => {
    expect(providerInfo('meu-agente')).toMatchObject({ displayName: 'meu-agente', capabilities: { sessions: true, completion: false } });
  });
});

/**
 * Regra da arquitetura (docs/INTEGRACOES.md): nada específico de um agente fora de
 * src/main/integrations/. O core e o renderer só conhecem o protocolo normalizado.
 */
describe('regra: core e renderer não conhecem agentes', () => {
  const src = path.resolve(__dirname, '../..');
  const AGENT_SPECIFIC = [
    /claude-code/, /hook_event_name/, /\bPreToolUse\b/, /\bPostToolUse/, /\bUserPromptSubmit\b/,
    /\bis(Claude|Codex|OpenCode)\b/, /\bcodex\b/i, /\bopencode\b/i,
  ];

  function files(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return full.includes(`${path.sep}integrations`) ? [] : files(full);
      return /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [full] : [];
    });
  }

  it.each(files(src).map((f) => [path.relative(src, f), f]))('%s', (_name, file) => {
    const code = fs.readFileSync(file, 'utf8');
    for (const pattern of AGENT_SPECIFIC) expect(code, `${pattern} em ${file}`).not.toMatch(pattern);
  });
});
