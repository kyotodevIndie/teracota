// PoC Fase 0: roda uma sessão via Agent SDK e grava eventos com timestamps em JSONL.
// Uso: node runner.mjs '<json opts>'  opts: {name,prompt,resume?,interruptAfter?,followup?,exitAfterDeltas?}
// SDK reutilizado do PoC anterior (sem instalar dependências).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire('K:/dev/waifu-claude/poc/claude-gui/package.json');
const sdkPath = require.resolve('@anthropic-ai/claude-agent-sdk');
const { query } = await import(pathToFileURL(sdkPath).href);

const o = JSON.parse(process.argv[2]);
const t0 = Date.now();
const log = path.join(here, 'out', `${o.name}.jsonl`);
fs.writeFileSync(log, '');
const rec = (kind, extra = {}) => fs.appendFileSync(log, JSON.stringify({ t: Date.now() - t0, kind, ...extra }) + '\n');

const queue = []; let wake = null; let ended = false;
const push = (text) => { queue.push({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, parent_tool_use_id: null }); wake?.(); };
const inbox = { async *[Symbol.asyncIterator]() { for (;;) { if (queue.length) yield queue.shift(); else if (ended) return; else await new Promise(r => (wake = r)); } } };
push(o.prompt);

const q = query({ prompt: inbox, options: {
  cwd: path.join(here, 'workspace'), model: 'haiku', resume: o.resume,
  pathToClaudeCodeExecutable: 'C:/Users/vicen/AppData/Local/Microsoft/WinGet/Links/claude.exe',
  includePartialMessages: true, permissionMode: 'default',
  disallowedTools: ['Bash'],
  canUseTool: async (tool, input) => {
    const p = input.file_path ? path.resolve(input.file_path) : null;
    const ws = path.join(here, 'workspace');
    if ((tool === 'Write' || tool === 'Read') && p && p.toLowerCase().startsWith(ws.toLowerCase() + path.sep)) { rec('perm_allow', { tool }); return { behavior: 'allow', updatedInput: input }; }
    rec('perm_deny', { tool, path: p }); return { behavior: 'deny', message: 'Somente Read/Write dentro de workspace.' };
  },
} });

let deltas = 0, sid = null, interrupted = false, results = 0;
try {
  for await (const m of q) {
    if (m.type === 'system' && m.subtype === 'init') { sid = m.session_id; rec('init', { session_id: sid }); }
    else if (m.type === 'stream_event' && m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta') {
      deltas++; if (deltas === 1) rec('first_delta', { session_id: m.session_id });
      if (deltas === o.exitAfterDeltas) { rec('exit_marker', { deltas, pid: process.pid }); }
      if (deltas === o.interruptAfter && !interrupted) { interrupted = true; rec('interrupt_call'); const a = Date.now(); await q.interrupt(); rec('interrupt_returned', { ms: Date.now() - a }); }
    } else if (m.type === 'result') {
      results++; rec('result', { subtype: m.subtype, is_error: m.is_error, session_id: m.session_id, errors: m.errors, result: String(m.result ?? '').slice(0, 80), num_turns: m.num_turns });
      if (o.followup && results === 1) push(o.followup); else { ended = true; wake?.(); }
    } else if (m.type === 'assistant') {
      const tools = (m.message?.content ?? []).filter(c => c.type === 'tool_use').map(c => c.name);
      if (tools.length) rec('tool_use', { tools });
    } else if (m.type !== 'stream_event' && m.subtype !== 'thinking_tokens') rec('msg', { type: m.type, subtype: m.subtype });
  }
  rec('done', { deltas });
} catch (e) { rec('error', { message: String(e?.message ?? e).slice(0, 300) }); }
process.exit(0);
