// Smoke MANUAL do painel de conversa: uma chamada real, mínima e barata ao Agent SDK.
// NÃO roda em testes nem no CI. Exige ANTHROPIC_API_KEY no ambiente (nunca lida nem impressa aqui).
//   npm run build && node dist/scripts/agent-smoke.js
//
// Limites: cwd temporário vazio, modelo haiku, 1 turno, orçamento de US$ 0,05, 60 s no total,
// todas as permissões negadas, sem retry. Imprime só estado, origem da chave, custo, tokens e o texto final.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findClaudeOnPath } from '../src/main/integrations/claude-code/bridge-provider';

const PROMPT = 'Responda apenas: ok';
const TIMEOUT_MS = 60_000;

async function main(): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.error('Abortado: defina ANTHROPIC_API_KEY no ambiente (o login do Claude Code não é usado).');
    return 2;
  }
  const exe = await findClaudeOnPath();
  if (!exe) {
    console.error('Abortado: o comando "claude" não foi encontrado no PATH.');
    return 2;
  }
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const cwd = await mkdtemp(path.join(tmpdir(), 'teracota-smoke-'));
  let code = 1;
  try {
    const q = query({
      prompt: PROMPT,
      options: {
        cwd,
        model: 'haiku',
        maxTurns: 1,
        maxBudgetUsd: 0.05,
        pathToClaudeCodeExecutable: exe,
        permissionMode: 'default',
        settingSources: [],
        canUseTool: async () => ({ behavior: 'deny', message: 'smoke: permissões negadas' }),
      },
    });
    const timer = setTimeout(() => {
      console.error('Tempo esgotado (60 s): interrompendo.');
      void q.interrupt();
    }, TIMEOUT_MS);
    try {
      for await (const m of q) {
        if (m.type === 'system' && m.subtype === 'init') {
          console.log(`estado: init · apiKeySource=${m.apiKeySource ?? 'ausente'}`);
          if (m.apiKeySource !== 'ANTHROPIC_API_KEY') {
            console.error('Abortado: a sessão não usa ANTHROPIC_API_KEY (login da assinatura não é permitido).');
            q.close();
            return 3;
          }
        } else if (m.type === 'result') {
          const ok = m.subtype === 'success' && !m.is_error;
          console.log(`estado: ${ok ? 'concluído' : `erro (${m.subtype})`}`);
          console.log(`total_cost_usd=${m.total_cost_usd}`);
          console.log(`tokens: entrada=${m.usage.input_tokens} saída=${m.usage.output_tokens}`);
          if (ok) console.log(`texto final: ${m.result}`);
          code = ok ? 0 : 1;
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error(`estado: erro · ${err instanceof Error ? err.message : 'falha desconhecida'}`);
    code = 1;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
  return code;
}

main().then((c) => process.exit(c));
