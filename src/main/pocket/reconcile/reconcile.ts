// Reconciliação após crash (contrato §3, R1–R6). Regra-mãe: NUNCA reexecutar sozinho uma ação que pode já
// ter acontecido. Aqui só se coleta evidência e se muda o estado para `needs_reconcile`; quem decide é o usuário.
// Leitura local e somente-leitura de ~/.claude/projects: só existência, tamanho, mtime e o TIPO dos últimos
// eventos do transcrito. Nenhum conteúdo (texto, comando, arquivo) é lido para fora desta função nem persistido.
import { execFile } from 'node:child_process';
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TaskRow } from '../../../shared/pocket';
import type { EffectRow, PocketStore } from '../core/store';
import type { OrphanReport } from '../process/supervisor';
import { sha256File } from '../security/policy';

// ── transcrito ───────────────────────────────────────────────────────────────────────────────

export interface TranscriptInfo {
  path: string;
  bytes: number;
  mtimeMs: number;
  /** Tipos dos últimos eventos, ex.: ['assistant:tool_use', 'user:tool_result']. Sem conteúdo. */
  tail: string[];
  /** Termina em tool_result sem resposta do assistente (ou em tool_use sem resultado): turno incompleto (T3). */
  incompleteTurn: boolean;
}

export interface TranscriptProbe {
  probe(sessionId: string, cwd: string): Promise<TranscriptInfo | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAIL_BYTES = 64 * 1024;

export class FsTranscriptProbe implements TranscriptProbe {
  constructor(private readonly projectsDir: string = path.join(os.homedir(), '.claude', 'projects')) {}

  private locate(sessionId: string, cwd: string): string | null {
    if (!UUID.test(sessionId)) return null; // nunca monta caminho com texto livre
    const mangled = cwd.replace(/[^A-Za-z0-9]/g, '-');
    const direct = path.join(this.projectsDir, mangled, `${sessionId}.jsonl`);
    if (existsSync(direct)) return direct;
    try {
      for (const d of readdirSync(this.projectsDir, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const p = path.join(this.projectsDir, d.name, `${sessionId}.jsonl`);
        if (existsSync(p)) return p;
      }
    } catch { /* pasta inexistente: sem transcrito */ }
    return null;
  }

  async probe(sessionId: string, cwd: string): Promise<TranscriptInfo | null> {
    const file = this.locate(sessionId, cwd);
    if (!file) return null;
    try {
      const st = statSync(file);
      const start = Math.max(0, st.size - TAIL_BYTES);
      const fd = openSync(file, 'r');
      const buf = Buffer.alloc(st.size - start);
      try { readSync(fd, buf, 0, buf.length, start); } finally { closeSync(fd); }
      let lines = buf.toString('utf8').split('\n');
      if (start > 0) lines = lines.slice(1); // primeira linha pode estar cortada
      const kinds: string[] = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line) as { type?: string; message?: { content?: unknown } };
          if (o.type !== 'user' && o.type !== 'assistant') continue;
          const c = o.message?.content;
          if (Array.isArray(c)) {
            for (const b of c as { type?: string }[]) kinds.push(`${o.type}:${b.type ?? '?'}`);
          } else kinds.push(`${o.type}:text`);
        } catch { /* linha final truncada pelo crash */ }
      }
      const tail = kinds.slice(-6);
      const last = tail.at(-1);
      return { path: file, bytes: st.size, mtimeMs: st.mtimeMs, tail, incompleteTurn: last === 'user:tool_result' || last === 'assistant:tool_use' };
    } catch { return null; }
  }
}

// ── verificação de efeitos ───────────────────────────────────────────────────────────────────

export type Suggestion = 'applied' | 'not_applied' | 'unknown';

/**
 * Efeito verificável (Write com hash esperado): arquivo com hash igual = aplicado; ausente = não aplicado.
 * Qualquer outra coisa (Edit, Bash, git, rede, arquivo diferente) = desconhecido: só o usuário decide.
 */
export function suggestFor(e: Pick<EffectRow, 'verifiable' | 'targetPath' | 'expectedHash' | 'toolName'>): Suggestion {
  if (!e.verifiable || !e.targetPath || !e.expectedHash) return 'unknown';
  try {
    if (!existsSync(e.targetPath)) return 'not_applied';
    if (statSync(e.targetPath).size > 50 * 1024 * 1024) return 'unknown'; // hash síncrono na thread principal: sem arquivos enormes
    return sha256File(e.targetPath) === e.expectedHash ? 'applied' : 'unknown';
  } catch { return 'unknown'; }
}

// ── git ─────────────────────────────────────────────────────────────────────────────────────

export interface GitSummary {
  changedFiles: number;
  files: string[];
  truncated: boolean;
}
export type GitProbe = (cwd: string) => Promise<GitSummary | null>;

let gitPath: string | null | undefined;
/** git absoluto vindo de pastas ABSOLUTAS do PATH (o Windows procura git.exe no cwd do filho antes do PATH: nunca usar a pasta de trabalho). */
export function resolveGit(env: NodeJS.ProcessEnv = process.env): string | null {
  if (gitPath !== undefined) return gitPath;
  gitPath = null;
  const names = process.platform === 'win32' ? ['git.exe'] : ['git'];
  for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const hit = names.map((n) => path.join(dir, n)).find((p) => existsSync(p));
    if (hit) { gitPath = hit; break; }
  }
  return gitPath;
}

/**
 * `git status` num repositório que o agente pode ter alterado (filter drivers em .git/config executam código).
 * Por isso só roda sob GESTO explícito do usuário (collectEvidence com includeGit), com git absoluto, fora da
 * pasta de trabalho (cwd neutro + -C), sem submódulos e com ambiente mínimo.
 */
export const gitStatusProbe: GitProbe = (cwd) => new Promise((resolve) => {
  const git = resolveGit();
  if (!git) { resolve(null); return; }
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
    USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1',
  };
  execFile(git, ['-C', cwd, '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=NUL', '--no-optional-locks', 'status', '--porcelain', '--ignore-submodules=all'],
    { cwd: os.tmpdir(), timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024, env },
    (err, out) => {
      if (err) { resolve(null); return; }
      const lines = out.split('\n').filter(Boolean);
      resolve({ changedFiles: lines.length, files: lines.slice(0, 20).map((l) => l.slice(3).slice(0, 160)), truncated: lines.length > 20 });
    });
});

// ── evidência ───────────────────────────────────────────────────────────────────────────────

export interface Evidence {
  taskId: string;
  state: string;
  reason: string | null;
  transcript: Omit<TranscriptInfo, 'path'> | null;
  /** O transcrito cresceu depois do fim da última execução nossa (ex.: `claude --resume` num terminal). */
  externalActivity: boolean;
  flags: { interruptRequested: boolean; cancelRequested: boolean };
  effects: { id: string; toolName: string; summary: string; status: string; verifiable: boolean; suggestion: Suggestion }[];
  git: GitSummary | null;
}

export interface ReconcileDeps {
  store: PocketStore;
  probe: TranscriptProbe;
  git?: GitProbe;
}

export async function collectEvidence(d: ReconcileDeps, taskId: string, opts: { includeGit?: boolean } = {}): Promise<Evidence> {
  const { store } = d;
  const task = store.mustTask(taskId);
  const lastTransition = store.journalSince(0, taskId).filter((e) => e.kind === 'transition').at(-1);
  const t = task.currentSessionId ? await d.probe.probe(task.currentSessionId, task.cwd) : null;
  // referência = último evento NOSSO persistido (o endedAt de um crash é a hora do boot e esconderia atividade externa)
  const lastOwn = Math.max(0, ...store.journalSince(0, taskId).filter((e) => e.kind === 'event').map((e) => e.ts), ...store.runsOf(taskId).map((r) => r.startedAt));
  const externalActivity = !!t && lastOwn > 0 && t.mtimeMs > lastOwn + 3000;
  if (externalActivity && task.currentSessionId) store.setExternalActivity(task.currentSessionId, true);
  const effects = store.effectsOf(taskId, ['unconfirmed', 'user_applied', 'user_unknown', 'user_not_applied']).map((e) => ({
    id: e.id, toolName: e.toolName, summary: e.summary, status: e.status, verifiable: e.verifiable, suggestion: suggestFor(e),
  }));
  const git = d.git && opts.includeGit ? await d.git(task.cwd).catch(() => null) : null;
  const ev: Evidence = {
    taskId, state: task.state, reason: lastTransition?.reason ?? null,
    transcript: t ? { bytes: t.bytes, mtimeMs: t.mtimeMs, tail: t.tail, incompleteTurn: t.incompleteTurn } : null,
    externalActivity,
    flags: { interruptRequested: task.interruptRequested, cancelRequested: task.cancelRequested },
    effects, git,
  };
  // instantâneo SEM conteúdo no journal (contagens e estados)
  store.note(taskId, 'reconcile_evidence', {
    transcript: ev.transcript ? { bytes: ev.transcript.bytes, tail: ev.transcript.tail, incompleteTurn: ev.transcript.incompleteTurn } : null,
    externalActivity, effects: effects.map((e) => [e.toolName, e.status, e.suggestion]), gitChanged: git?.changedFiles ?? null,
  });
  return ev;
}

// ── inicialização ───────────────────────────────────────────────────────────────────────────

export interface ReconcileReport {
  integrityIssues: string[];
  movedToReconcile: { taskId: string; reason: string }[];
  deniedApprovals: number;
}

/** R1: banco íntegro e projeção == journal. Devolve problemas (vazio = ok). */
export function verifyIntegrity(store: PocketStore): string[] {
  const issues: string[] = [];
  const qc = (store.db.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check;
  if (qc !== 'ok') issues.push(`quick_check: ${qc}`);
  for (const t of store.listTasks()) {
    const last = store.journalSince(0, t.id).filter((e) => e.kind === 'transition').at(-1);
    if (!last || last.toState !== t.state) issues.push(`tarefa ${t.id}: estado ${t.state} diverge do journal (${last?.toState ?? 'vazio'})`);
  }
  return issues;
}

/**
 * Roda UMA vez, depois de `openCore` (lock + fence + varredura de órfãos) e antes de liberar comandos.
 * R2: running/awaiting_approval sem runner vivo (por definição: este processo acabou de subir) → needs_reconcile.
 * R3: queued com transcrito da sua sessão ou intenção no ledger → needs_reconcile (lost_transition).
 * R4: runner órfão já morto por sweepOrphans; só registra a evidência.
 */
export async function reconcileOnStartup(d: ReconcileDeps, orphans?: OrphanReport): Promise<ReconcileReport> {
  const { store } = d;
  const report: ReconcileReport = { integrityIssues: verifyIntegrity(store), movedToReconcile: [], deniedApprovals: 0 };
  if (report.integrityIssues.length > 0) return report; // inconsistência: nada é tocado, o app mostra o problema

  const move = (task: TaskRow, reason: string, runId: string | null): void => {
    store.transition(task.id, 'needs_reconcile', { actor: 'system', reason, runId, evidence: { orphanKilled: !!orphans?.killed.some((k) => k.runId === runId) } });
    store.markUnconfirmed(task.id);
    report.movedToReconcile.push({ taskId: task.id, reason });
  };

  for (const task of store.listTasks(['running', 'awaiting_approval'])) {
    const open = store.openRunOf(task.id);
    for (const a of store.pendingApprovals(task.id)) { // o canUseTool pendente não sobrevive ao processo
      try { store.decideApproval(a.approvalRequestId, { decision: 'deny', actor: 'system', hmac: 'crash' }); report.deniedApprovals++; } catch { /* já decidida */ }
    }
    if (open) store.endRun(open.id, 'crash');
    for (const s of store.sessionsOf(task.id)) {
      if (s.state === 'active') { store.setSessionState(s.id, 'orphaned', 'crash'); store.setSessionState(s.id, 'idle', 'crash'); }
    }
    move(task, 'orchestrator_crash', open?.id ?? null);
  }

  for (const task of store.listTasks(['queued'])) {
    const hasLedger = store.effectsOf(task.id).length > 0 || store.runsOf(task.id).length > 0;
    const t = task.currentSessionId ? await d.probe.probe(task.currentSessionId, task.cwd) : null;
    if (hasLedger || t) {
      for (const s of store.sessionsOf(task.id)) if (s.state === 'reserved' && t) { store.setSessionState(s.id, 'active', 'lost_transition'); store.setSessionState(s.id, 'idle', 'lost_transition'); }
      move(task, 'lost_transition', null);
    }
  }
  return report;
}
