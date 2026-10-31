// Servidor MCP servido pelo próprio app (Streamable HTTP, sem estado).
// O Claude Code conecta em http://127.0.0.1:7777/mcp — não precisa de Node instalado.
import { app } from 'electron';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { CHARACTER_NAME, MCP_SERVER_NAME } from '../shared/brand';
import { ANIMS, EXPRESSIONS, type CompanionEvent } from '../shared/protocol';

const ok = { content: [{ type: 'text' as const, text: 'ok' }] };

function buildServer(dispatch: (event: CompanionEvent) => void): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: app.getVersion() },
    {
      instructions:
        `Controla ${CHARACTER_NAME}, uma personagem de desktop que acompanha seu trabalho. As atividades (ler, editar, ` +
        'terminal, erro, fim) já são animadas automaticamente por hooks — use estas ferramentas só para momentos com ' +
        'personalidade: comemorar um bug resolvido, comentar algo curioso, reagir a uma descoberta. Falas curtas ' +
        '(até ~80 caracteres), no idioma do usuário. Não use em toda mensagem.',
    },
  );

  server.registerTool(
    'say',
    {
      description: `Faz ${CHARACTER_NAME} falar uma frase curta num balão, opcionalmente com uma expressão.`,
      inputSchema: {
        text: z.string().min(1).max(280).describe('O que ela fala (curto)'),
        expression: z.enum(EXPRESSIONS).optional().describe('Expressão durante a fala'),
      },
    },
    async ({ text, expression }) => {
      dispatch({ say: text, ...(expression && { expression, duration: 4000 }) });
      return ok;
    },
  );

  server.registerTool(
    'emote',
    {
      description: `Muda a expressão e/ou toca uma animação de ${CHARACTER_NAME} por alguns segundos.`,
      inputSchema: {
        expression: z.enum(EXPRESSIONS).optional(),
        animation: z.enum(ANIMS).optional(),
        seconds: z.number().min(1).max(30).default(4).describe('Quanto tempo dura antes de voltar ao normal'),
      },
    },
    async ({ expression, animation, seconds }) => {
      dispatch({ expression, anim: animation, duration: seconds * 1000 });
      return ok;
    },
  );

  return server;
}

/** Trata um POST /mcp já com o corpo lido. Um servidor/transporte por requisição (modo sem estado). */
export async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  dispatch: (event: CompanionEvent) => void,
): Promise<void> {
  const server = buildServer(dispatch);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
