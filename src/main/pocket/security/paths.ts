// Confinamento de escrita ao workspace (contrato §4): caminho real (symlink/junction resolvidos), sem
// diferenciar maiúsculas no Windows, com recusa de formas que enganam a comparação textual
// (streams alternativos, nomes de dispositivo, caminhos de dispositivo/estendidos, ponto/espaço final,
// links pendentes e hardlinks). O `cwd` NÃO confina nada: toda checagem parte do caminho resolvido.
// Limite conhecido: TOCTOU — um link criado entre a checagem e a escrita pelo próprio agente não é visto.
import { lstatSync, realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WIN = process.platform === 'win32';
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i;

export type PathProblem =
  | 'invalid' | 'device_path' | 'alternate_data_stream' | 'reserved_name' | 'trailing_dot_space'
  | 'dangling_link' | 'unresolvable' | 'outside' | 'hardlink' | 'unc';

export interface ResolvedPath {
  /** Caminho absoluto resolvido (realpath do ancestral existente + restante). */
  real: string;
  inside: boolean;
  problem?: PathProblem;
  exists: boolean;
}

function stripExtended(p: string): string {
  return p.startsWith('\\\\?\\UNC\\') ? `\\\\${p.slice(8)}` : p.startsWith('\\\\?\\') ? p.slice(4) : p;
}

/** Forma canônica para COMPARAR (nunca para acessar o disco). */
export function foldCase(p: string): string {
  const n = path.normalize(p).normalize('NFC');
  return WIN ? n.toLowerCase() : n;
}

/** Comparação exata por segmento (para nomes já canônicos vindos do realpath). */
export function isInsideExact(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

export function isInside(root: string, target: string): boolean {
  const r = foldCase(root);
  const t = foldCase(target);
  const rel = path.relative(r, t);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function validateRaw(raw: unknown): PathProblem | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 32_000 || raw.includes('\0')) return 'invalid';
  if (raw !== raw.normalize('NFC')) return 'invalid'; // o NTFS não normaliza Unicode: formas decompostas enganariam a comparação
  if (!WIN) return null;
  if (/^\\\\[.?]\\/.test(raw) || /^\/\/[.?]\//.test(raw)) return 'device_path';
  const noDrive = raw.replace(/^[a-zA-Z]:/, '');
  if (noDrive.includes(':')) return 'alternate_data_stream';
  const comps = raw.split(/[\\/]+/).filter(Boolean);
  for (const c of comps) {
    if (c === '.' || c === '..') continue;
    if (RESERVED.test(c)) return 'reserved_name';
    if (/[. ]$/.test(c)) return 'trailing_dot_space'; // o Windows descarta: "a." e "a" são o mesmo arquivo
  }
  return null;
}

function realpathPartial(abs: string): { real: string; ancestor: string; exists: boolean; problem?: PathProblem } {
  let cur = abs;
  const rest: string[] = [];
  for (let i = 0; i < 4096; i++) {
    try {
      const r = stripExtended(realpathSync.native(cur));
      return { real: rest.length ? path.join(r, ...[...rest].reverse()) : r, ancestor: r, exists: rest.length === 0 };
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return { real: abs, ancestor: abs, exists: false, problem: 'unresolvable' };
      try {
        lstatSync(cur); // existe como entrada mas não resolve: link pendente
        return { real: abs, ancestor: abs, exists: false, problem: 'dangling_link' };
      } catch { /* realmente inexistente: sobe */ }
      rest.push(path.basename(cur));
      const parent = path.dirname(cur);
      if (parent === cur) return { real: abs, ancestor: abs, exists: false, problem: 'unresolvable' };
      cur = parent;
    }
  }
  return { real: abs, ancestor: abs, exists: false, problem: 'unresolvable' };
}

/** Resolve `raw` (relativo ao `cwd`) e diz se cai dentro de `workspaceReal`. */
export function resolveAgainst(raw: unknown, cwd: string, workspaceReal: string, opts: { forWrite?: boolean } = {}): ResolvedPath {
  const bad = validateRaw(raw);
  if (bad) return { real: String(raw), inside: false, problem: bad, exists: false };
  const s = raw as string;
  const abs = path.resolve(cwd, s);
  // rede/dispositivo: decidido ANTES de qualquer chamada ao disco (realpath em UNC autenticaria na rede)
  if (WIN && (/^[\\/]{2}/.test(s) || /^[\\/]{2}/.test(abs))) {
    return { real: abs, inside: false, problem: /^[\\/]{2}[.?][\\/]/.test(abs) ? 'device_path' : 'unc', exists: false };
  }
  const r = realpathPartial(abs);
  if (r.problem) return { real: r.real, inside: false, problem: r.problem, exists: r.exists };
  // dentro/fora = prefixo EXATO do realpath do ancestral existente (nomes canônicos do disco); sem dobrar caixa/Unicode
  if (!isInsideExact(workspaceReal, r.ancestor)) return { real: r.real, inside: false, problem: 'outside', exists: r.exists };
  if (opts.forWrite && r.exists) {
    try {
      const st = statSync(r.real);
      if (st.isFile() && st.nlink > 1) return { real: r.real, inside: false, problem: 'hardlink', exists: true };
    } catch { /* sumiu entre as chamadas: tratado como inexistente */ }
  }
  return { real: r.real, inside: true, exists: r.exists };
}

export function workspaceRealpath(cwd: string): string {
  return stripExtended(realpathSync.native(cwd));
}

// Escrever aqui executa código depois (hooks, tarefas, configuração do próprio agente): exige aprovação
// mesmo dentro do workspace.
const SENSITIVE_SEGMENTS = new Set(['.git', '.claude', '.husky', '.vscode']);
// em QUALQUER profundidade (submódulos, repositórios aninhados, pacotes de monorepo); sempre sem diferenciar caixa
export function isExecutionSensitive(workspaceReal: string, real: string): boolean {
  const segs = path.relative(foldCase(workspaceReal), foldCase(real)).toLowerCase().split(path.sep);
  if (segs.some((s) => SENSITIVE_SEGMENTS.has(s))) return true;
  return segs.some((s, i) => s === '.github' && segs[i + 1] === 'workflows');
}

// Credenciais e chaves: nunca oferecidas para aprovação (contrato §0: o Teracota e seu agente não tocam nelas).
// Diretórios que o agente nunca toca: dados do próprio Teracota (banco/journal) — corromper o ledger manipularia a reconciliação.
const protectedRoots: string[] = [];
export function setProtectedPaths(paths: readonly string[]): void {
  protectedRoots.length = 0;
  for (const p of paths) {
    protectedRoots.push(foldCase(path.resolve(p)));
    try { protectedRoots.push(foldCase(stripExtended(realpathSync.native(p)))); } catch { /* ainda não existe */ } // junction/OneDrive/8.3
  }
}

/** ~/.claude (settings, hooks, plugins) e ~/.claude.json: escrever aqui = executar código no próximo start. Nunca oferecido. */
export function isAgentConfig(real: string): boolean {
  const f = foldCase(real);
  const home = foldCase(os.homedir());
  const dir = foldCase(path.join(os.homedir(), '.claude'));
  return f === foldCase(path.join(os.homedir(), '.claude.json')) || ((f === dir || f.startsWith(dir + path.sep)) && f.startsWith(home));
}

export function isCredentialPath(real: string): boolean {
  const home = foldCase(os.homedir());
  const f = foldCase(real);
  if (protectedRoots.some((r) => f === r || f.startsWith(r.endsWith(path.sep) ? r : r + path.sep))) return true;
  const appData = process.env.APPDATA ? foldCase(process.env.APPDATA) : null;
  if (appData && (f.startsWith(foldCase(path.join(appData, 'GitHub CLI'))) || f.startsWith(foldCase(path.join(appData, 'gh'))))) return true;
  if (appData) for (const d of ['Credentials', 'Protect', 'Vault']) if (f.startsWith(foldCase(path.join(appData, 'Microsoft', d)))) return true;
  const baseName = path.basename(f);
  if (['_netrc', '.netrc', '.pypirc'].includes(baseName)) return true;
  const under = (rel: string) => { const d = path.join(home, rel); return f === foldCase(d) || f.startsWith(`${foldCase(d)}${path.sep}`); };
  if (under('.ssh') || under('.aws') || under(path.join('.config', 'gh')) || under('.gnupg') || under('.docker') || under('.kube') || under('.azure')) return true;
  const base = path.basename(f);
  if (base === '.git-credentials' || (base === '.npmrc' && f.startsWith(home))) return true;
  if (f.startsWith(foldCase(path.join(home, '.claude'))) && /(^|[\\/])\.credentials[^\\/]*$/.test(f)) return true;
  return false;
}
