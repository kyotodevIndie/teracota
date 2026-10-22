// Informação de processos do SO (identidade = pid + tempo de criação). Assíncrono: uma consulta de
// PowerShell leva centenas de ms no Windows; nunca chamar no caminho quente.
import { execFile } from 'node:child_process';

export interface ProcInfo {
  pid: number;
  ppid: number;
  /** ISO-8601 UTC do tempo de criação; null se o SO não informou. */
  startTime: string | null;
  name: string;
}

function run(cmd: string, args: string[], timeout = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

const PS_FIELDS = `[pscustomobject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = $_.Name; start = $(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null }) }`;

function parseWin(out: string): ProcInfo[] {
  const t = out.trim();
  if (!t) return [];
  const j = JSON.parse(t) as unknown;
  const arr = (Array.isArray(j) ? j : [j]) as { pid: number; ppid: number; name: string; start: string | null }[];
  return arr.map((p) => ({ pid: p.pid, ppid: p.ppid, name: p.name, startTime: p.start }));
}

async function winQuery(filter: string | null): Promise<ProcInfo[]> {
  const f = filter ? ` -Filter '${filter}'` : '';
  const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    `Get-CimInstance Win32_Process${f} | ForEach-Object { ${PS_FIELDS} } | ConvertTo-Json -Compress`]);
  return parseWin(out);
}

async function posixQuery(pid?: number): Promise<ProcInfo[]> {
  const args = pid ? ['-o', 'pid=,ppid=,lstart=,comm=', '-p', String(pid)] : ['-A', '-o', 'pid=,ppid=,lstart=,comm='];
  let out = '';
  try { out = await run('ps', args); } catch { return []; }
  const rows: ProcInfo[] = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/.exec(line);
    if (m) rows.push({ pid: +(m[1] as string), ppid: +(m[2] as string), startTime: new Date(`${m[3]} UTC`).toISOString(), name: (m[4] as string).trim() });
  }
  return rows;
}

export async function getProcInfo(pid: number): Promise<ProcInfo | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const rows = process.platform === 'win32' ? await winQuery(`ProcessId = ${pid}`) : await posixQuery(pid);
  return rows.find((r) => r.pid === pid) ?? null;
}

export async function listProcesses(): Promise<ProcInfo[]> {
  return process.platform === 'win32' ? winQuery(null) : posixQuery();
}

/** Descendentes (qualquer profundidade) de `root` num snapshot. Ignora ppid reaproveitado (filho nascido antes do pai). */
export function descendantsOf(all: readonly ProcInfo[], root: number): ProcInfo[] {
  const byParent = new Map<number, ProcInfo[]>();
  const rootInfo = all.find((p) => p.pid === root);
  if (!rootInfo?.startTime) return []; // sem a raiz verificável não há como filtrar ppid reaproveitado
  for (const p of all) {
    const list = byParent.get(p.ppid) ?? [];
    list.push(p);
    byParent.set(p.ppid, list);
  }
  const out: ProcInfo[] = [];
  const seen = new Set<number>([root]);
  const queue = [root];
  while (queue.length) {
    const cur = queue.shift() as number;
    for (const c of byParent.get(cur) ?? []) {
      if (seen.has(c.pid)) continue;
      const parent = cur === root ? rootInfo : out.find((o) => o.pid === cur);
      if (parent?.startTime && c.startTime && c.startTime < parent.startTime) continue; // ppid reaproveitado
      seen.add(c.pid);
      out.push(c);
      queue.push(c.pid);
    }
  }
  return out;
}

export function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}
