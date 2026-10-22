import fs from 'node:fs';
import path from 'node:path';
import { canTransition, InvalidTransitionError } from './states.mjs';

/** Append one JSON line with fsync. If the file does not end in "\n" (torn write), start a fresh line first. */
export function appendLine(file, obj, { partial = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let prefix = '';
  try {
    const st = fs.statSync(file);
    if (st.size > 0) {
      const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(1);
      fs.readSync(fd, b, 0, 1, st.size - 1); fs.closeSync(fd);
      if (b[0] !== 10) prefix = '\n';
    }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let line = JSON.stringify(obj) + '\n';
  if (partial) line = line.slice(0, Math.floor(line.length / 2)); // test hook: simulate crash mid-write
  const fd = fs.openSync(file, 'a');
  try { fs.writeSync(fd, prefix + line); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export function readLines(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return { records: [], warnings: [] }; throw e; }
  const records = [], warnings = [];
  const lines = txt.split('\n');
  lines.forEach((l, i) => {
    if (!l.trim()) return;
    try { records.push(JSON.parse(l)); }
    catch {
      const last = i === lines.length - 1 || (i === lines.length - 2 && lines[i + 1] === '');
      warnings.push(`line ${i + 1}: unparseable ${last ? '(last line, likely truncated by crash)' : '(ignored)'}: ${l.slice(0, 40)}`);
    }
  });
  return { records, warnings };
}

export class Journal {
  constructor(file, { onWarn = () => {} } = {}) { this.file = file; this.onWarn = onWarn; }

  read() { const r = readLines(this.file); r.warnings.forEach((w) => this.onWarn(w)); return r; }

  /** State derived from the journal only. */
  states() {
    const { records, warnings } = this.read();
    const tasks = new Map();
    for (const r of records) {
      if (!r || !r.taskId) continue;
      const cur = tasks.get(r.taskId);
      if (r.type === 'transition') {
        if ((cur?.state ?? null) !== r.from) warnings.push(`task ${r.taskId} seq ${r.seq}: from=${r.from} but derived=${cur?.state ?? null}`);
        tasks.set(r.taskId, { taskId: r.taskId, sessionId: r.sessionId, state: r.to, seq: r.seq, reason: r.reason, at: r.at,
          hasUnconfirmedEffects: !!r.hasUnconfirmedEffects, evidence: r.evidence ?? null });
      } else if (cur) cur.seq = Math.max(cur.seq, r.seq ?? 0);
    }
    return { tasks, warnings };
  }

  transition({ taskId, sessionId, to, reason = '', extra = {} }) {
    const { tasks } = this.states();
    const cur = tasks.get(taskId);
    const from = cur?.state ?? null;
    if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
    const { __partial, ...fields } = extra;
    const rec = { type: 'transition', taskId, sessionId: sessionId ?? cur?.sessionId, from, to, reason, at: new Date().toISOString(), seq: (cur?.seq ?? 0) + 1, ...fields };
    appendLine(this.file, rec, { partial: __partial });
    return rec;
  }

  event(taskId, kind, data = {}) {
    const { tasks } = this.states();
    const cur = tasks.get(taskId);
    const rec = { type: 'event', taskId, sessionId: cur?.sessionId, kind, at: new Date().toISOString(), seq: (cur?.seq ?? 0) + 1, ...data };
    appendLine(this.file, rec);
    return rec;
  }
}
