// Limites do plano do Claude na Tera, pelo caminho oficial e sem custo: o Claude Code
// manda pra statusline um JSON com `rate_limits` (5 horas e semana, em %), e a Tera põe
// um script pequeno na frente da statusline do usuário. O script repassa o JSON pro app
// (POST /usage/claude-code, só 127.0.0.1) e chama a statusline que já existia, que
// continua aparecendo igual. Nada de login ou token é lido.
//
// Mexe em ~/.claude/settings.json (só a chave statusLine), e só quando o usuário liga
// nos Ajustes. Desligar devolve a statusline anterior, guardada ao ligar.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type { UsageWindow } from '../../../shared/live';
import type { AgentUsage } from '../types';

export const USAGE_ROUTE = '/usage/claude-code';
const SCRIPT_NAME = 'claude-statusline.sh';
const PREVIOUS_NAME = 'claude-statusline-previous.json';
const WINDOW_IDS = ['five_hour', 'seven_day', 'spend_limit'] as const;

/** Statusline do Claude Code (o que vai em settings.json) */
export interface StatusLine {
  type: 'command';
  command: string;
  padding?: number;
  [k: string]: unknown;
}

/** rate_limits do JSON da statusline → janelas de uso (vazio = sem limites de plano) */
export function parseRateLimits(body: unknown): UsageWindow[] {
  const limits = (body as { rate_limits?: unknown } | null)?.rate_limits;
  if (!limits || typeof limits !== 'object') return [];
  const out: UsageWindow[] = [];
  for (const id of WINDOW_IDS) {
    const w = (limits as Record<string, unknown>)[id] as { used_percentage?: unknown; resets_at?: unknown } | undefined;
    const pct = w?.used_percentage;
    if (typeof pct !== 'number' || !Number.isFinite(pct)) continue;
    const resets = typeof w?.resets_at === 'number' && Number.isFinite(w.resets_at) ? w.resets_at * 1000 : null;
    out.push({ id, usedPct: Math.max(0, Math.min(999, pct)), resetsAt: resets });
  }
  return out;
}

/** Texto entre aspas simples pro sh */
export const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** O script: repassa o JSON pro app (em segundo plano, sem atrasar) e roda a statusline anterior */
export function buildScript(port: number, previous: string | null): string {
  return [
    '#!/bin/sh',
    '# Teracota: repassa os limites do plano (statusline do Claude Code) pro app da Tera.',
    '# Gerado pelo app; desligar nos Ajustes da Tera devolve a statusline anterior.',
    'input=$(cat)',
    `printf '%s' "$input" | curl -s -m 1 -X POST -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:${port}${USAGE_ROUTE} >/dev/null 2>&1 &`,
    previous ? `printf '%s' "$input" | sh -c ${shQuote(previous)}` : ':',
    '',
  ].join('\n');
}

/** Comando que vai em settings.json (o caminho não pode ter o que o sh interpretaria) */
export function scriptCommand(scriptPath: string): string | null {
  if (/["$`\\\n]/.test(scriptPath)) return null;
  return `sh "${scriptPath}"`;
}

export const isOurs = (statusLine: unknown, scriptPath: string) =>
  typeof (statusLine as StatusLine | undefined)?.command === 'string' && (statusLine as StatusLine).command.includes(scriptPath);

export interface StatusLinePaths {
  /** settings.json do Claude Code */
  settings: string;
  /** Pasta do app (script e statusline anterior) */
  dataDir: string;
}

export function defaultSettingsPath(): string {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(dir, 'settings.json');
}

/** settings.json lido; {} se não existe; null se existe mas não dá pra entender (não mexemos) */
function readSettings(file: string): Record<string, unknown> | null {
  if (!fs.existsSync(file)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function writeAtomic(file: string, text: string, mode?: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.teracota-${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, mode === undefined ? undefined : { mode });
  fs.renameSync(tmp, file);
}

export function usageEnabled(paths: StatusLinePaths): boolean {
  const settings = readSettings(paths.settings);
  return !!settings && isOurs(settings.statusLine, path.join(paths.dataDir, SCRIPT_NAME));
}

/** Liga: guarda a statusline atual, escreve o script e aponta settings.json pra ele */
export function enableUsage(paths: StatusLinePaths, port: number): boolean {
  const settings = readSettings(paths.settings);
  if (!settings) return false;
  const scriptPath = path.join(paths.dataDir, SCRIPT_NAME);
  const command = scriptCommand(scriptPath);
  if (!command) return false;
  const current = settings.statusLine as StatusLine | undefined;
  let previous: StatusLine | null = null;
  if (isOurs(current, scriptPath)) {
    // já ligado: mantém a anterior guardada
    try { previous = (JSON.parse(fs.readFileSync(path.join(paths.dataDir, PREVIOUS_NAME), 'utf8')) as { statusLine: StatusLine | null }).statusLine; } catch { previous = null; }
  } else {
    previous = current && typeof current.command === 'string' ? current : null;
    writeAtomic(path.join(paths.dataDir, PREVIOUS_NAME), JSON.stringify({ statusLine: current ?? null }, null, 2));
  }
  writeAtomic(scriptPath, buildScript(port, previous?.command ?? null), 0o755);
  const next: StatusLine = { ...(previous ?? {}), type: 'command', command };
  writeAtomic(paths.settings, `${JSON.stringify({ ...settings, statusLine: next }, null, 2)}\n`);
  return true;
}

/** Desliga: devolve a statusline anterior (ou tira a chave, se não havia) */
export function disableUsage(paths: StatusLinePaths): boolean {
  const settings = readSettings(paths.settings);
  if (!settings) return false;
  const scriptPath = path.join(paths.dataDir, SCRIPT_NAME);
  if (!isOurs(settings.statusLine, scriptPath)) return true;
  let previous: unknown = null;
  try { previous = (JSON.parse(fs.readFileSync(path.join(paths.dataDir, PREVIOUS_NAME), 'utf8')) as { statusLine: unknown }).statusLine; } catch { previous = null; }
  const { statusLine: _ours, ...rest } = settings;
  writeAtomic(paths.settings, `${JSON.stringify(previous ? { ...rest, statusLine: previous } : rest, null, 2)}\n`);
  return true;
}

const appPaths = (): StatusLinePaths => ({ settings: defaultSettingsPath(), dataDir: app.getPath('userData') });

/** Limites do Claude na Tera (Ajustes) */
export const claudeUsage: AgentUsage = {
  route: USAGE_ROUTE,
  parse: parseRateLimits,
  label: 'Limites do Claude na Tera',
  description: 'Lê os limites do plano pela statusline do Claude Code (a sua continua aparecendo).',
  enabled: () => usageEnabled(appPaths()),
  enable: (port) => enableUsage(appPaths(), port),
  disable: () => disableUsage(appPaths()),
};
