import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanionEvent, IncomingEvent } from '../shared/protocol';
import type { AgentSignal } from './integrations/types';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }));

const { startEventServer } = await import('./server');

const signals: AgentSignal[] = [];
const events: IncomingEvent[] = [];
const mcpEvents: CompanionEvent[] = [];
let server: http.Server;
let port: number;

/** Porta livre: o servidor confere o Host contra a porta configurada, então ela precisa ser conhecida */
async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const { port: p } = probe.address() as AddressInfo;
  await new Promise((r) => probe.close(r));
  return p;
}

function request(path: string, opts: { method?: string; body?: string; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: opts.method ?? 'POST', headers: { 'content-type': 'application/json', ...opts.headers } },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end(opts.body);
  });
}

const post = (path: string, json: unknown) => request(path, { body: JSON.stringify(json) });

beforeAll(async () => {
  port = await freePort();
  server = startEventServer(port, {
    onSignal: (s) => signals.push(s),
    onEvent: (e) => events.push(e),
    onMcp: (e) => mcpEvents.push(e),
  });
  await new Promise<void>((r) => (server.listening ? r() : server.once('listening', () => r())));
});

afterAll(() => new Promise((r) => server.close(r)));

beforeEach(() => {
  signals.length = 0;
  events.length = 0;
  mcpEvents.length = 0;
});

describe('servidor local', () => {
  it('GET /health', async () => {
    expect(await request('/health', { method: 'GET' })).toEqual({ status: 200, body: 'ok' });
  });

  describe('rota do adapter (/hook do Claude Code)', () => {
    it('evento válido vira sinal e responde 204', async () => {
      const res = await post('/hook', { hook_event_name: 'PreToolUse', session_id: 's1', cwd: '/x/api', tool_name: 'Edit' });
      expect(res.status).toBe(204);
      expect(signals).toHaveLength(1);
      expect(signals[0]).toMatchObject({ source: { provider: 'claude-code', sessionId: 's1', project: 'api' }, working: true });
    });

    it('nunca devolve erro pro agente: JSON quebrado e lixo também respondem 204', async () => {
      expect((await request('/hook', { body: '{nope' })).status).toBe(204);
      expect((await post('/hook', { qualquer: 'coisa' })).status).toBe(204);
      expect(signals).toHaveLength(0);
    });
  });

  describe('API local', () => {
    it('/api/v1/event aceita evento com source e lifecycle', async () => {
      const res = await post('/api/v1/event', { state: 'happy', source: { provider: 'meu-agente', sessionId: 'a' }, lifecycle: 'start' });
      expect(res.status).toBe(204);
      expect(events[0]).toEqual({ event: { state: 'happy' }, source: { provider: 'meu-agente', sessionId: 'a' }, lifecycle: 'start' });
    });

    it('/event continua como alias compatível', async () => {
      expect((await post('/event', { say: 'oi' })).status).toBe(204);
      expect(events[0]).toEqual({ event: { say: 'oi' } });
    });

    it('evento sem nada válido → 400', async () => {
      expect((await post('/api/v1/event', { state: 'voando' })).status).toBe(400);
      expect((await request('/api/v1/event', { body: 'x' })).status).toBe(400);
      expect(events).toHaveLength(0);
    });
  });

  describe('segurança', () => {
    it('recusa páginas web (header Origin)', async () => {
      expect((await request('/event', { body: '{"say":"x"}', headers: { origin: 'https://site.example' } })).status).toBe(403);
      expect(events).toHaveLength(0);
    });

    it('recusa Host diferente de localhost (DNS rebinding)', async () => {
      expect((await request('/event', { body: '{"say":"x"}', headers: { host: `evil.example:${port}` } })).status).toBe(403);
    });

    it('rotas desconhecidas e métodos errados → 404', async () => {
      expect((await post('/integrations/codex', {})).status).toBe(404);
      expect((await request('/api/v1/event', { method: 'GET' })).status).toBe(404);
    });
  });

  describe('MCP', () => {
    it('GET /mcp → 405 (modo sem estado)', async () => {
      expect((await request('/mcp', { method: 'GET' })).status).toBe(405);
    });

    it('cliente MCP real lista e chama as ferramentas', async () => {
      const client = new Client({ name: 'teste', version: '0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
      const tools = (await client.listTools()).tools.map((t) => t.name);
      expect(tools).toEqual(expect.arrayContaining(['say', 'emote']));

      await client.callTool({ name: 'say', arguments: { text: 'Oi do MCP', expression: 'happy' } });
      await client.callTool({ name: 'emote', arguments: { animation: 'jump', seconds: 2 } });
      await client.close();

      expect(mcpEvents).toEqual([
        { say: 'Oi do MCP', expression: 'happy', duration: 4000 },
        { expression: undefined, anim: 'jump', duration: 2000 },
      ]);
    });
  });
});
