// Adapter do Claude Code — conexão pela CLI do Claude:
// - "Conectar ao Claude Code": instala o plugin (hooks). Sem a CLI no PATH, devolve
//   um comando de uma linha pra colar no terminal.
// - Falas pelo MCP (opcional): registra/remove o servidor MCP do Teracota no escopo
//   de usuário. É opcional porque, com o app fechado, o Claude Code mostra erro de
//   conexão do MCP — os hooks do plugin, ao contrário, falham em silêncio.
import { execFile } from 'node:child_process';
import { GITHUB_REPO, MCP_SERVER_NAME } from '../../../shared/brand';
import { platform } from '../../platform';
import type { ConnectResult, ConnectStatus } from '../types';

/** Plugin no formato nome@marketplace */
export const PLUGIN_ID = 'teracota@teracota';

const STEPS: string[][] = [
  ['plugin', 'marketplace', 'add', GITHUB_REPO],
  ['plugin', 'install', PLUGIN_ID],
];

/** Uma linha só, que funciona no PowerShell, bash e zsh (o `;` roda um depois do outro) */
export const TERMINAL_COMMAND = STEPS.map((args) => `claude ${args.join(' ')}`).join('; ');

export const mcpUrl = (port: number) => `http://127.0.0.1:${port}/mcp`;
export const mcpAddArgs = (port: number) => ['mcp', 'add', '--scope', 'user', '--transport', 'http', MCP_SERVER_NAME, mcpUrl(port)];
export const MCP_REMOVE_ARGS = ['mcp', 'remove', '--scope', 'user', MCP_SERVER_NAME];

/** `claude plugin list` mostra o plugin do Teracota? */
export const isInstalled = (pluginList: string) => pluginList.includes(PLUGIN_ID.split('@')[0]!);

/** `claude mcp get teracota` descreve o servidor do Teracota (e não "não encontrado")? */
export const isMcpConfigured = (ok: boolean, output: string) => ok && output.includes('127.0.0.1');

interface RunResult {
  ok: boolean;
  output: string;
}

function run(file: string, args: string[], shell = false): Promise<RunResult> {
  return new Promise((resolve) => {
    // shell só quando a plataforma exige (.cmd no Windows, instalação via npm); os
    // argumentos são fixos, então não há o que escapar
    execFile(file, args, { shell, timeout: 120_000, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: `${stdout}\n${stderr}`.trim() });
    });
  });
}

/** Caminho da CLI do Claude, se estiver no PATH */
async function findClaude(): Promise<string | null> {
  const lookup = await run(platform.whichCommand, ['claude']);
  if (!lookup.ok) return null;
  return lookup.output.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? null;
}

/** Roda a CLI do Claude; null quando ela não está instalada */
async function claude(args: string[]): Promise<RunResult | null> {
  const cli = await findClaude();
  if (!cli) return null;
  return run(cli, args, platform.needsShell(cli));
}

export async function installPlugin(): Promise<ConnectResult> {
  const log: string[] = [];
  for (const args of STEPS) {
    const r = await claude(args);
    if (!r) return { ok: false, reason: 'not-found', output: '' };
    log.push(`$ claude ${args.join(' ')}\n${r.output}`);
    // "já adicionado"/"já instalado" não é erro: seguimos e conferimos no fim
    if (!r.ok && !/already/i.test(r.output)) return { ok: false, reason: 'failed', output: log.join('\n\n') };
  }
  const list = await claude(['plugin', 'list']);
  return list && isInstalled(list.output)
    ? { ok: true }
    : { ok: false, reason: 'failed', output: `${log.join('\n\n')}\n\n$ claude plugin list\n${list?.output ?? ''}` };
}

/** Claude Code instalado? Plugin já ativo? */
export async function pluginStatus(): Promise<ConnectStatus> {
  const list = await claude(['plugin', 'list']);
  if (!list) return 'unavailable';
  return list.ok && isInstalled(list.output) ? 'connected' : 'available';
}

export async function enableMcp(port: number): Promise<ConnectResult> {
  const r = await claude(mcpAddArgs(port));
  if (!r) return { ok: false, reason: 'not-found', output: '' };
  return r.ok || /already exists/i.test(r.output) ? { ok: true } : { ok: false, reason: 'failed', output: r.output };
}

export async function disableMcp(): Promise<ConnectResult> {
  const r = await claude(MCP_REMOVE_ARGS);
  if (!r) return { ok: false, reason: 'not-found', output: '' };
  return r.ok || /not found|no mcp server/i.test(r.output) ? { ok: true } : { ok: false, reason: 'failed', output: r.output };
}

export async function mcpEnabled(): Promise<boolean> {
  const r = await claude(['mcp', 'get', MCP_SERVER_NAME]);
  return !!r && isMcpConfigured(r.ok, r.output);
}
