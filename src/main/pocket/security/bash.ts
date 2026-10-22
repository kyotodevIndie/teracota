// Classificação conservadora de comandos de shell (Bash/PowerShell). Em dúvida: aprovação.
// Nunca devolve "seguro" para nada com composição, redirecionamento, expansão ou argumento fora do alfabeto simples.

export type ShellClass = 'safe' | 'destructive' | 'compound' | 'other';
export interface ShellVerdict {
  cls: ShellClass;
  reason: string;
  /** Argumentos que parecem caminho (para conferir confinamento de leitura). Só preenchido quando 'safe'. */
  pathArgs: string[];
}

// Operadores/expansões de shell (bash, cmd e PowerShell). Qualquer ocorrência, mesmo entre aspas, = composto.
const META = /[&|;<>`$(){}[\]*?~^%!#\n\r"']/;

const DESTRUCTIVE: [RegExp, string][] = [
  [/(^|[\s;&|(])(rm|rmdir|rd|del|erase|unlink|shred|srm|truncate)(\.exe)?(\s|$)/i, 'remoção'],
  [/(^|[\s;&|(])(remove-item|ri|clear-content|remove-itemproperty|rename-item)(\s|$)/i, 'remoção (PowerShell)'],
  [/\bgit\s+(-\S+\s+)*(clean|reset|restore|rebase|filter-branch|gc|prune)\b/i, 'git destrutivo'],
  [/\bgit\s+(-\S+\s+)*checkout\b[^&|;]*\s--(\s|$)/i, 'git checkout --'],
  [/\bgit\s+(-\S+\s+)*branch\b[^&|;]*\s-[dD]\b/i, 'apagar branch'],
  [/\bgit\s+(-\S+\s+)*(commit|push|tag|merge|cherry-pick|revert|am|apply|stash)\b/i, 'git que altera histórico/remoto'],
  [/\b(gh|hub)\s+(release|repo\s+delete|pr\s+merge)\b/i, 'release/remoto'],
  [/\b(npm|yarn|pnpm|bun)\s+(publish|unpublish|deprecate)\b/i, 'publicação'],
  [/\b(twine|cargo|gem|docker)\s+(upload|publish|push)\b/i, 'publicação'],
  [/\b(deploy|terraform\s+apply|kubectl\s+(apply|delete)|vercel|netlify|firebase\s+deploy)\b/i, 'deploy'],
  [/\b(format|diskpart|mkfs|dd|shutdown|reboot|restart-computer|stop-computer|reg\s+(add|delete)|setx|schtasks|sc\s+(delete|stop))\b/i, 'sistema'],
  [/\b(taskkill|kill|killall|pkill|stop-process)\b/i, 'encerrar processos'],
  [/\b(curl|wget|invoke-webrequest|iwr|invoke-restmethod|irm|scp|ssh|ftp|nc|ncat)\b/i, 'rede'],
  [/\b(powershell|pwsh|cmd|bash|sh|wsl|node|python3?|py|ruby|perl|deno|bun|npx|npm|yarn|pnpm|make|invoke-expression|iex)(\.exe)?\b/i, 'executa código arbitrário'],
];

// comando + subcomandos permitidos sem composição (somente leitura)
const SAFE_SIMPLE = new Set(['ls', 'dir', 'pwd', 'echo', 'cat', 'type', 'head', 'tail', 'wc', 'where', 'which',
  'get-childitem', 'get-content', 'get-location', 'get-date', 'select-string']);
const ARG = /^[\w./\\:=@+,-]+$/;

// git: lista de flags PERMITIDAS por subcomando (abreviações e opções não listadas viram "other")
const GIT_FLAGS: Record<string, RegExp[]> = {
  status: [/^(-s|--short|-b|--branch|--porcelain|--porcelain=v[12]|--no-color)$/],
  diff: [/^(--stat|--shortstat|--numstat|--name-only|--name-status|--cached|--staged|--no-color|--color=never|-U\d{1,3}|--unified=\d{1,3})$/],
  log: [/^(--oneline|--graph|--decorate|--stat|--name-only|--no-color|--color=never|-n|-\d{1,4}|--max-count=\d{1,4})$/],
  show: [/^(--stat|--name-only|--oneline|--no-color|--color=never)$/],
  'rev-parse': [/^(--short|--abbrev-ref|--show-toplevel|--is-inside-work-tree|--verify)$/],
  'ls-files': [/^(-m|-o|--others|--cached|--modified)$/],
  describe: [/^(--tags|--always|--abbrev=\d{1,2})$/],
  branch: [/^(-a|-v|-vv|--list|-r)$/],
};

/** `shell`: no Bash (Git Bash no Windows) a barra invertida é ESCAPE, não separador: qualquer `\\` vira composto. */
export function classifyShell(command: unknown, shell: 'bash' | 'powershell' = 'powershell'): ShellVerdict {
  if (typeof command !== 'string' || command.trim() === '' || command.length > 8000) {
    return { cls: 'other', reason: 'comando vazio ou grande demais', pathArgs: [] };
  }
  const cmd = command.trim();
  for (const [re, why] of DESTRUCTIVE) if (re.test(cmd)) {
    // runtimes (node/npm/...) são "outro", não "destrutivo": só mudam o rótulo exibido
    const runtime = why === 'executa código arbitrário';
    return { cls: runtime ? 'other' : 'destructive', reason: why, pathArgs: [] };
  }
  if (shell === 'bash' && cmd.includes('\\')) return { cls: 'compound', reason: 'barra invertida no Bash (escape)', pathArgs: [] };
  if (META.test(cmd)) return { cls: 'compound', reason: 'composição, redirecionamento ou expansão', pathArgs: [] };
  const parts = cmd.split(/\s+/);
  const head = (parts[0] ?? '').toLowerCase().replace(/\.exe$/, '');
  const args = parts.slice(1);
  if (!args.every((a) => ARG.test(a) || /^-{1,2}[\w-]+$/.test(a))) {
    return { cls: 'compound', reason: 'argumentos fora do alfabeto simples', pathArgs: [] };
  }
  if (head === 'git') {
    const sub = args[0] ?? '';
    const allowed = GIT_FLAGS[sub];
    if (!allowed) return { cls: 'other', reason: 'git fora da lista de leitura (ou com opção antes do subcomando)', pathArgs: [] };
    const rest = args.slice(1);
    const flags = rest.filter((a) => a.startsWith('-'));
    if (!flags.every((f) => allowed.some((re) => re.test(f)))) return { cls: 'other', reason: 'git com opção fora da lista permitida', pathArgs: [] };
    const positional = rest.filter((a) => !a.startsWith('-'));
    return { cls: 'safe', reason: `git ${sub} (leitura)`, pathArgs: sub === 'branch' ? [] : positional };
  }
  if (SAFE_SIMPLE.has(head)) {
    // valor colado em parâmetro (-Path:C:\\x, --file=..) também é caminho
    const pathArgs = args.flatMap((a) => (a.startsWith('-') ? (/[:=](.+)$/.exec(a)?.[1] ? [/[:=](.+)$/.exec(a)?.[1] as string] : []) : [a]));
    return { cls: 'safe', reason: `${head} (leitura)`, pathArgs: head === 'echo' ? [] : pathArgs };
  }
  return { cls: 'other', reason: 'fora da lista de comandos permitidos', pathArgs: [] };
}
