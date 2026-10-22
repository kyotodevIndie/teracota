// Fake agent runner. Writes a transcript (JSONL), prints a final "result" line on stdout.
// Real Claude does not write the result to the transcript; neither do we.
// args: --transcript F --session ID [--resume] [--scenario ok|hang|auth|expired|usage|transient] [--steps N] [--interval MS] [--attempt K] [--failUntil N]
import fs from 'node:fs';

const a = process.argv.slice(2);
const get = (k, d) => { const i = a.indexOf(`--${k}`); return i < 0 ? d : a[i + 1]; };
const has = (k) => a.includes(`--${k}`);
const transcript = get('transcript');
const sessionId = get('session');
const scenario = get('scenario', 'ok');
const steps = Number(get('steps', scenario === 'hang' ? 100000 : 3));
const interval = Number(get('interval', 50));
const attempt = Number(get('attempt', 1));
const failUntil = Number(get('failUntil', 0));

const emit = (o) => fs.appendFileSync(transcript, JSON.stringify({ sessionId, ts: new Date().toISOString(), ...o }) + '\n');
const result = (r, code = 0) => { process.stdout.write(JSON.stringify({ type: 'result', sessionId, ...r }) + '\n', () => process.exit(code)); };

if (has('resume') && !fs.existsSync(transcript)) result({ subtype: 'error', error: 'session_not_found' }, 1);
else {
  emit({ type: 'user', prompt: has('resume') ? '(resume)' : 'task prompt', resumed: has('resume') });
  process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', sessionId }) + '\n');
  process.stdin.on('data', (d) => { if (String(d).includes('interrupt')) result({ subtype: 'error_during_execution', is_error: true, error: 'interrupted' }, 0); });
  process.stdin.on('end', () => process.exit(2)); // parent gone: die without a result (as the real claude did)

  if (scenario === 'auth') result({ subtype: 'error', error: 'authentication_failed' }, 1);
  else if (scenario === 'expired') result({ subtype: 'error', error: 'session_not_found' }, 1);
  else if (scenario === 'usage') result({ subtype: 'error', error: 'usage_limit_reached' }, 1);
  else if (scenario === 'transient' && attempt <= failUntil) result({ subtype: 'error', error: 'overloaded' }, 1);
  else {
    let i = 0;
    const tick = () => {
      i++;
      if (i > steps) { emit({ type: 'assistant', text: 'done' }); return result({ subtype: 'success' }, 0); }
      emit({ type: 'assistant', tool_use: `step-${i}` });
      setTimeout(() => { emit({ type: 'user', tool_result: `step-${i}` }); setTimeout(tick, interval); }, interval);
    };
    tick();
  }
}
