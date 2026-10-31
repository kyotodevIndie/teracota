// Servidor HTTP local (só 127.0.0.1):
//   POST <rotas dos adapters>   eventos nativos de cada agente (ex.: /hook do Claude Code)
//   POST /api/v1/event          API local universal (CompanionEvent + source opcional)
//   POST /event                 alias compatível da API acima
//   POST /mcp                   servidor MCP (Streamable HTTP)
//   GET  /health
// Documentação da API: docs/API.md
import http from 'node:http';
import { parseIncoming, type CompanionEvent, type IncomingEvent } from '../shared/protocol';
import { ADAPTERS, adapterForRoute } from './integrations';
import type { AgentSignal } from './integrations/types';
import { handleMcpRequest } from './mcp';

/** Eventos de agentes podem trazer payloads grandes (ex.: conteúdo de ferramentas) */
const MAX_BODY = 8 * 1024 * 1024;

const EVENT_ROUTES = ['/api/v1/event', '/event'];

export interface ServerHandlers {
  onSignal(signal: AgentSignal): void;
  onEvent(incoming: IncomingEvent): void;
  onMcp(event: CompanionEvent): void;
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('payload grande demais'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Bloqueia páginas web: navegadores mandam Origin em POST cross-origin, e um Host
 * diferente de localhost indica DNS rebinding. curl e os agentes não fazem nenhum dos dois.
 */
function isLocalClient(req: http.IncomingMessage, port: number): boolean {
  if (req.headers.origin) return false;
  const host = req.headers.host ?? '';
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

const knownRoute = (url: string) => url === '/mcp' || EVENT_ROUTES.includes(url) || !!adapterForRoute(url);

export function startEventServer(port: number, handlers: ServerHandlers): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = (req.url ?? '').split('?')[0] ?? '';

    if (!isLocalClient(req, port)) {
      res.writeHead(403).end();
      return;
    }
    if (req.method === 'GET' && url === '/health') {
      res.writeHead(200).end('ok');
      return;
    }
    if (url === '/mcp' && req.method !== 'POST') {
      // modo sem estado: sem stream SSE (GET) nem encerramento de sessão (DELETE)
      res.writeHead(405, { 'content-type': 'application/json', allow: 'POST' }).end(
        JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }),
      );
      return;
    }
    if (req.method !== 'POST' || !knownRoute(url)) {
      res.writeHead(404).end();
      return;
    }

    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      // eventos nativos de agentes nunca recebem erro: não podem atrapalhar o agente
      if (!res.headersSent) res.writeHead(adapterForRoute(url) ? 204 : 400).end();
      return;
    }

    if (url === '/mcp') {
      try {
        await handleMcpRequest(req, res, body, handlers.onMcp);
      } catch (err) {
        console.error('[teracota] erro no MCP:', err);
        if (!res.headersSent) res.writeHead(500).end();
      }
      return;
    }

    const adapter = adapterForRoute(url);
    if (adapter) {
      try {
        const signal = adapter.toSignal(body);
        if (signal) handlers.onSignal(signal);
      } catch (err) {
        console.error(`[teracota] adapter ${adapter.id} falhou:`, err);
      }
      res.writeHead(204).end();
      return;
    }

    const incoming = parseIncoming(body);
    if (!incoming) {
      res.writeHead(400).end('invalid event');
      return;
    }
    handlers.onEvent(incoming);
    res.writeHead(204).end();
  });
  server.on('error', (err) => console.error(`[teracota] servidor na porta ${port} falhou:`, err.message));
  server.listen(port, '127.0.0.1', () => {
    console.log(`[teracota] ouvindo em http://127.0.0.1:${port} — integrações: ${ADAPTERS.map((a) => a.id).join(', ')}`);
  });
  return server;
}
