import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BIN = path.join(HERE, '..', 'bin');
const WORK = path.join(HERE, '..', '.work');

export function tmpRoot(name) {
  fs.mkdirSync(WORK, { recursive: true });
  return fs.mkdtempSync(path.join(WORK, `${name}-`));
}

/** Spawn a node script; collect JSON lines; resolve helpers. */
export function spawnJson(script, args) {
  const p = spawn(process.execPath, [path.join(BIN, script), ...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const lines = []; const waiters = []; let buf = ''; let err = '';
  p.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i); buf = buf.slice(i + 1);
      try { lines.push(JSON.parse(l)); } catch {}
      waiters.splice(0).forEach((w) => w());
    }
  });
  p.stderr.on('data', (d) => { err += d; });
  const exit = new Promise((r) => p.on('close', (code, signal) => { waiters.splice(0).forEach((w) => w()); r({ code, signal }); }));
  const waitLine = async (pred, ms = 30000) => {
    const t0 = Date.now();
    for (;;) {
      const f = lines.find(pred); if (f) return f;
      if (Date.now() - t0 > ms) throw new Error(`timeout waiting line; got ${JSON.stringify(lines)} err=${err}`);
      await new Promise((r) => { waiters.push(r); setTimeout(r, 100); });
    }
  };
  return { p, pid: p.pid, lines, exit, waitLine, err: () => err };
}

export function runJson(script, args) {
  const r = spawnSync(process.execPath, [path.join(BIN, script), ...args], { encoding: 'utf8', windowsHide: true });
  const lines = r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { code: r.status, signal: r.signal, lines, last: lines.at(-1), stderr: r.stderr };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(fn, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(50); }
  throw new Error('waitFor timeout');
}
