// Política de ferramentas (decisão 3): leitura e escrita livres DENTRO do workspace autorizado; Bash
// controlado; escrita fora do workspace, ações destrutivas e tudo que não se classifica com segurança
// exigem aprovação do usuário. Credenciais: negado, nunca oferecido para aprovação. Sem bypass.
import { createHash } from 'node:crypto';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ActionClass } from '../../../shared/pocket';
import { classifyShell } from './bash';
import { isAgentConfig, isCredentialPath, isExecutionSensitive, resolveAgainst, type PathProblem } from './paths';

export interface Classification {
  cls: ActionClass;
  /** true = pode seguir sem perguntar (ainda registra intenção no ledger se escreve). */
  auto: boolean;
  /** true = nunca oferecido para aprovação. */
  deny?: string;
  summary: string;
  reason: string;
  targetPath?: string;
  expectedHash?: string;
  /** O efeito pode ser verificado depois (arquivo com hash esperado). */
  verifiable: boolean;
  writes: boolean;
}

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const INTERNAL_SAFE = new Set(['TodoWrite', 'Task', 'Agent', 'ExitPlanMode', 'EnterPlanMode', 'BashOutput', 'KillShell', 'TaskOutput', 'TaskStop']);

function str(input: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) if (typeof input[k] === 'string') return input[k] as string;
  return undefined;
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** actionKey = sha256(taskId | toolName | canonical(input)) — contrato §3. */
export function actionKeyOf(taskId: string, toolName: string, input: Record<string, unknown>): string {
  return createHash('sha256').update(`${taskId}|${toolName}|${canonical(input)}`).digest('hex');
}

const PROBLEM_TEXT: Record<PathProblem, string> = {
  invalid: 'caminho inválido', device_path: 'caminho de dispositivo', alternate_data_stream: 'stream alternativo (NTFS)',
  reserved_name: 'nome reservado do Windows', trailing_dot_space: 'ponto/espaço final (alias no Windows)',
  dangling_link: 'link simbólico pendente', unresolvable: 'caminho não resolvível', outside: 'fora do workspace',
  hardlink: 'hardlink (pode apontar para fora)', unc: 'caminho de rede (UNC)',
};

export function sha256File(p: string): string | undefined {
  try { return createHash('sha256').update(readFileSync(p)).digest('hex'); } catch { return undefined; }
}

/** Git Bash/WSL: /c/Users/x e /mnt/c/Users/x apontam para C:\\Users\\x. */
export function msysToWin(p: string): string {
  if (process.platform !== 'win32') return p;
  const m = /^\/(?:mnt\/)?([a-zA-Z])(?:\/(.*))?$/.exec(p);
  return m ? `${(m[1] as string).toUpperCase()}:\\${(m[2] ?? '').replace(/\//g, '\\')}` : p;
}

/**
 * Rede de segurança para QUALQUER comando (inclusive composto/destrutivo): se algum token parece um caminho de
 * credencial (~, $HOME, %USERPROFILE%, /c/..., C:\...), o comando é NEGADO, não oferecido para aprovação.
 */
export function credentialInCommand(cmd: string, bash: boolean, cwd: string, workspaceReal: string): string | undefined {
  const home = os.homedir();
  const expanded = cmd
    .replace(/\$\{?(HOME|USERPROFILE)\}?|%USERPROFILE%|\$env:USERPROFILE/gi, home)
    .replace(/%APPDATA%|\$env:APPDATA|\$\{?APPDATA\}?/gi, process.env.APPDATA ?? home)
    .replace(/%LOCALAPPDATA%|\$env:LOCALAPPDATA|\$\{?LOCALAPPDATA\}?/gi, process.env.LOCALAPPDATA ?? home)
    .replace(/(^|[\s"'=:;|&(])~(?=[\\/]|$)/g, (_m, pre: string) => `${pre}${home}`);
  for (const raw of expanded.split(/[\s"'`;|&<>()=,]+/)) {
    if (raw.length < 3 || !/[\\/]/.test(raw)) continue;
    const tok = bash ? msysToWin(raw.replace(/\\/g, '/')) : raw;
    const r = resolveAgainst(tok, cwd, workspaceReal);
    if (isCredentialPath(r.real) || isAgentConfig(r.real)) return 'o comando referencia credenciais, a configuração do Claude Code ou dados do Teracota; negado';
  }
  return undefined;
}

const HARD_PROBLEMS = new Set<PathProblem>(['unc', 'device_path']);
function hardDeny(r: { problem?: PathProblem }): string | undefined {
  return r.problem && HARD_PROBLEMS.has(r.problem) ? 'caminho de rede ou de dispositivo é bloqueado' : undefined;
}

export function classifyTool(toolName: string, input: Record<string, unknown>, workspaceReal: string, cwd: string): Classification {
  const base = { auto: false, verifiable: false, writes: false } as const;

  if (INTERNAL_SAFE.has(toolName)) return { ...base, cls: 'safe_read', auto: true, summary: toolName, reason: 'ferramenta interna' };

  if (READ_TOOLS.has(toolName)) {
    const raw = str(input, 'file_path', 'path', 'notebook_path') ?? cwd;
    // padrões de Glob (pattern) e Grep (glob) também alcançam arquivos: absoluto ou com .. precisa estar no workspace
    const patRaw = toolName === 'Glob' ? str(input, 'pattern') : toolName === 'Grep' ? str(input, 'glob') : undefined;
    const escapes = (p: string) => path.isAbsolute(p) || /^[a-zA-Z]:/.test(p) || p.split(/[\\/]/).includes('..') || p.startsWith('~');
    // alternativas de chaves ({a,b}) viram padrões próprios: {../x,y} e {C:/..} não escapam da checagem
    const alts = patRaw === undefined ? [] : (/^([^{]*)\{([^}]*)\}(.*)$/.exec(patRaw) ? (/^([^{]*)\{([^}]*)\}(.*)$/.exec(patRaw) as RegExpExecArray)[2]!.split(',').map((a) => ((/^([^{]*)\{/.exec(patRaw) as RegExpExecArray)[1] ?? '') + a) : [patRaw]);
    const pat = alts.find(escapes) ?? (patRaw !== undefined && escapes(patRaw) ? patRaw : undefined);
    if (pat !== undefined) {
      const head = pat.replace(/[*?[{].*$/, '') || cwd;
      const pr = resolveAgainst(head, cwd, workspaceReal);
      const hp = hardDeny(pr);
      if (hp) return { ...base, cls: 'external_read', summary: toolName, reason: hp, deny: hp };
      if (isCredentialPath(pr.real)) return { ...base, cls: 'external_read', summary: toolName, reason: 'credenciais', deny: 'leitura de credenciais é proibida' };
      if (!pr.inside) return { ...base, cls: 'external_read', summary: toolName, reason: 'padrão fora do workspace' };
    }
    const r = resolveAgainst(raw, cwd, workspaceReal);
    const hd = hardDeny(r);
    if (hd) return { ...base, cls: 'external_read', summary: toolName, reason: hd, deny: hd };
    if (isCredentialPath(r.real)) return { ...base, cls: 'external_read', summary: `${toolName} ${path.basename(r.real)}`, reason: 'credenciais', deny: 'leitura de credenciais é proibida' };
    if (r.inside) return { ...base, cls: 'safe_read', auto: true, summary: `${toolName} ${path.basename(r.real) || '.'}`, reason: 'leitura dentro do workspace', targetPath: r.real };
    return { ...base, cls: 'external_read', summary: `${toolName} ${path.basename(r.real) || r.real}`, reason: `leitura: ${PROBLEM_TEXT[r.problem ?? 'outside']}`, targetPath: r.real };
  }

  if (WRITE_TOOLS.has(toolName)) {
    const raw = str(input, 'file_path', 'notebook_path', 'path');
    if (raw === undefined) return { ...base, cls: 'unknown', writes: true, summary: toolName, reason: 'sem caminho' };
    const r = resolveAgainst(raw, cwd, workspaceReal, { forWrite: true });
    const name = path.basename(r.real) || r.real;
    const hdw = hardDeny(r);
    if (hdw) return { ...base, cls: 'external_write', writes: true, summary: `${toolName} ${name}`, reason: hdw, deny: hdw };
    if (isCredentialPath(r.real)) return { ...base, cls: 'external_write', writes: true, summary: `${toolName} ${name}`, reason: 'credenciais', deny: 'escrita em credenciais é proibida' };
    if (isAgentConfig(r.real)) return { ...base, cls: 'external_write', writes: true, summary: `${toolName} ${name}`, reason: 'configuração do Claude Code (hooks executam código)', deny: 'escrita na configuração do Claude Code é proibida' };
    if (!r.inside) return { ...base, cls: 'external_write', writes: true, summary: `${toolName} ${name}`, reason: `escrita: ${PROBLEM_TEXT[r.problem ?? 'outside']}`, targetPath: r.real };
    if (isExecutionSensitive(workspaceReal, r.real)) {
      return { ...base, cls: 'destructive', writes: true, summary: `${toolName} ${name}`, reason: 'pasta que executa código/configuração (.git, .claude, .husky, .vscode, workflows)', targetPath: r.real };
    }
    const content = toolName === 'Write' ? str(input, 'content') : undefined;
    return {
      ...base, cls: 'workspace_write', auto: true, writes: true, summary: `${toolName} ${name}`, reason: 'escrita dentro do workspace',
      targetPath: r.real, expectedHash: content !== undefined ? createHash('sha256').update(content).digest('hex') : undefined,
      verifiable: content !== undefined,
    };
  }

  if (SHELL_TOOLS.has(toolName)) {
    const cmdText = str(input, 'command') ?? '';
    const sneaky = credentialInCommand(cmdText, toolName === 'Bash', cwd, workspaceReal);
    if (sneaky) return { ...base, cls: 'external_read', writes: true, summary: toolName, reason: sneaky, deny: sneaky };
    const v = classifyShell(str(input, 'command'), toolName === 'Bash' ? 'bash' : 'powershell');
    const first = (str(input, 'command') ?? '').trim().split(/\s+/)[0]?.replace(/[^\w./:\\-]/g, '').slice(0, 40) ?? '';
    const summary = `${toolName} ${first}`.trim();
    if (v.cls === 'safe') {
      // argumentos que são caminhos precisam estar no workspace (leitura)
      for (const a of v.pathArgs) {
        const r = resolveAgainst(toolName === 'Bash' ? msysToWin(a) : a, cwd, workspaceReal);
        const hb = hardDeny(r);
        if (hb) return { ...base, cls: 'external_read', summary, reason: hb, deny: hb };
        if (isCredentialPath(r.real)) return { ...base, cls: 'external_read', summary, reason: 'credenciais', deny: 'leitura de credenciais é proibida' };
        if (!r.inside) return { ...base, cls: 'external_read', summary, reason: `leitura: ${PROBLEM_TEXT[r.problem ?? 'outside']}` };
      }
      return { ...base, cls: 'safe_read', auto: true, summary, reason: v.reason };
    }
    return { ...base, cls: v.cls === 'destructive' ? 'destructive' : 'compound_shell', writes: true, summary, reason: v.reason };
  }

  // MCP, WebFetch, WebSearch e qualquer ferramenta nova: não classificável com segurança
  return { ...base, cls: 'unknown', writes: true, summary: toolName.slice(0, 80), reason: 'ferramenta não classificada' };
}

