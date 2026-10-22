import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POCKET_IPC, type PocketChannel } from '../../shared/pocket-ipc';
import type { TaskView } from '../../shared/pocket';
import { happy, init, result, toolUse, type Scenario } from '../integrations/claude-code/pocket/fake-sdk';
import { harness, type Harness } from '../integrations/claude-code/pocket/harness';
import { createPocketHandlers, runHandler, validateCwd } from './ipc';
import { lockName, OsLock } from './process/os-lock';
import { setProtectedPaths } from './security/paths';
import { classifyTool } from './security/policy';
import { resolveClaudeExecutable } from './service';
import { workspaceRealpath } from './security/paths';

const hs: Harness[] = [];
afterEach(async () => { setProtectedPaths([]); while (hs.length) await hs.pop()?.cleanup(); });
function mk(opts: Parameters<typeof harness>[0] = {}): Harness { const h = harness(opts); hs.push(h); return h; }
const state = (h: Harness, id: string) => h.store.mustTask(id).state;
const waitState = (h: Harness, id: string, s: string) => vi.waitFor(() => expect(state(h, id)).toBe(s), { timeout: 5000, interval: 10 });

describe('validateCwd: áreas protegidas', () => {
  it("'exact' recusa a pasta e seus ancestrais, mas libera subpastas; 'tree' recusa tudo dentro", () => {
    const h = mk();
    const parent = path.dirname(h.ws);
    expect(validateCwd(h.ws, [{ dir: parent, kind: 'exact' }])).toBeTruthy(); // subpasta do perfil: ok
    expect(() => validateCwd(parent, [{ dir: parent, kind: 'exact' }])).toThrow(/protegida/);
    expect(() => validateCwd(parent, [{ dir: h.ws, kind: 'exact' }])).toThrow(/protegida/); // ancestral da proibida
    expect(() => validateCwd(h.ws, [{ dir: h.ws, kind: 'tree' }])).toThrow(/protegida/);
    expect(() => validateCwd(path.join(h.ws, 'src'), [{ dir: h.ws, kind: 'tree' }])).toThrow(/dentro de uma área protegida/);
  });

  it('o perfil real do usuário, o AppData e a raiz são recusados; um ancestral do HOME também', () => {
    const forbidden = [{ dir: os.homedir(), kind: 'exact' as const }, ...(process.env.APPDATA ? [{ dir: process.env.APPDATA, kind: 'tree' as const }] : [])];
    expect(() => validateCwd(os.homedir(), forbidden)).toThrow(/protegida/);
    expect(() => validateCwd(path.dirname(os.homedir()), forbidden)).toThrow(/protegida/);
    const appData = process.env.APPDATA;
    if (appData) expect(() => validateCwd(path.join(appData, 'Microsoft'), forbidden)).toThrow(/protegida/);
  });

  it('o handler de criação aplica as pastas proibidas do backend', async () => {
    const h = mk();
    const handlers = createPocketHandlers({
      forbiddenWorkdirs: () => [{ dir: h.ws, kind: 'tree' }], orch: h.orch, store: h.store,
      status: () => ({ ready: true, claudeFound: true, containment: 'job-object', orphansKilled: 0 }), pickFolder: async () => null,
    });
    expect(await runHandler(handlers[POCKET_IPC.create], { title: 't', prompt: 'p', cwd: h.ws })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(h.store.listTasks()).toHaveLength(0);
  });
});

describe('descoberta do claude: só PATH absoluto', () => {
  it('entrada relativa do PATH (resolvida contra a pasta atual) é ignorada', () => {
    const rel = `.tmp-claude-rel-${process.pid}-${Date.now()}`;
    mkdirSync(rel, { recursive: true });
    writeFileSync(path.join(rel, process.platform === 'win32' ? 'claude.exe' : 'claude'), '');
    try {
      expect(resolveClaudeExecutable({ PATH: `${rel}${path.delimiter}.` } as NodeJS.ProcessEnv)).toBeUndefined();
      expect(resolveClaudeExecutable({ PATH: path.resolve(rel) } as NodeJS.ProcessEnv)).toBe(path.join(path.resolve(rel), process.platform === 'win32' ? 'claude.exe' : 'claude'));
    } finally { rmSync(rel, { recursive: true, force: true }); }
  });
});

describe('credentialInCommand ampliado (Claude Code e dados do Teracota)', () => {
  const ws = process.cwd();
  const wsReal = workspaceRealpath(ws);
  const cls = (cmd: string) => classifyTool('Bash', { command: cmd }, wsReal, ws);

  it('configuração do Claude Code e dados do Teracota são NEGADOS em qualquer comando', () => {
    const data = path.join(os.tmpdir(), 'pocket-dados-teste');
    mkdirSync(data, { recursive: true });
    setProtectedPaths([data]);
    try {
      expect(cls('cat ~/.claude/settings.json').deny).toBeTruthy();
      expect(cls('echo x >> ~/.claude/settings.json').deny).toBeTruthy();
      expect(cls(`cat ${data.replace(/\\/g, '/')}/pocket.db`).deny).toBeTruthy();
      expect(cls('ls && cat $HOME/.claude.json').deny).toBeTruthy();
      expect(cls('cat src/a.ts').deny).toBeUndefined();
    } finally { rmSync(data, { recursive: true, force: true }); }
  });

  it.runIf(process.platform === 'win32')('variáveis do Windows (%APPDATA%, $env:APPDATA) são expandidas', () => {
    const ps = (cmd: string) => classifyTool('PowerShell', { command: cmd }, wsReal, ws);
    expect(ps('type %APPDATA%\\Microsoft\\Credentials\\x').deny).toBeTruthy();
    expect(ps('Get-Content $env:APPDATA\\Microsoft\\Vault\\x').deny).toBeTruthy();
  });
});

describe('efeito pendente após interrupção/falha → needs_reconcile (nunca interrupted/failed limpos)', () => {
  const writeThen = (finish: (ctl: Parameters<Scenario>[0]) => AsyncGenerator<Record<string, unknown>>): Scenario => async function* (ctl) {
    yield init(ctl);
    yield toolUse('w1', 'Write', { file_path: 'src/x.ts', content: 'abc' });
    await ctl.canUse('Write', { file_path: 'src/x.ts', content: 'abc' }, 'w1'); // intenção registrada; sem tool_result
    yield* finish(ctl) as AsyncGenerator<never>;
  };

  it('interrupção limpa no meio de uma escrita', async () => {
    const h = mk({ scenarios: [writeThen(async function* (ctl) {
      await ctl.interrupted;
      yield result({ subtype: 'error_during_execution', is_error: true });
      await ctl.promptClosed;
    })] });
    const id = h.user.create();
    await h.user.start(id);
    await vi.waitFor(() => expect(h.store.effectsOf(id)).toHaveLength(1));
    await h.user.interrupt(id);
    await waitState(h, id, 'needs_reconcile');
    expect(h.store.effectsOf(id)[0]?.status).toBe('unconfirmed');
    await expect(h.user.resume(id)).rejects.toMatchObject({ code: 'RECONCILE_REQUIRED' });
  });

  it('falha de autenticação depois de uma escrita autorizada', async () => {
    const h = mk({ scenarios: [writeThen(async function* (ctl) {
      yield { type: 'assistant', error: 'authentication_failed', message: { content: [] } };
      yield result({ subtype: 'error_during_execution', is_error: true, errors: ['Not logged in'] });
      await ctl.promptClosed;
    })] });
    const id = h.user.create();
    await h.user.start(id);
    await waitState(h, id, 'needs_reconcile');
  });

  it('sem efeito pendente continua interrupted / auth_error normais; cancelar com efeito pendente continua cancelled', async () => {
    const h = mk({ scenarios: [writeThen(async function* (ctl) {
      await ctl.interrupted;
      yield result({ subtype: 'error_during_execution', is_error: true });
      await ctl.promptClosed;
    })] });
    const id = h.user.create();
    await h.user.start(id);
    await vi.waitFor(() => expect(h.store.effectsOf(id)).toHaveLength(1));
    await h.user.cancel(id);
    expect(state(h, id)).toBe('cancelled'); // o usuário escolheu encerrar: a decisão é dele
    const h2 = mk({ scenarios: [happy()] });
    const id2 = h2.user.create();
    await h2.user.start(id2);
    await waitState(h2, id2, 'review');
  });
});

describe('resumeTask após sessão expirada: fencing antes de mutar', () => {
  it('LOCK_BUSY não arquiva a sessão antiga nem reserva outra', async () => {
    const h = mk();
    const id = h.user.create();
    h.store.transition(id, 'running', { actor: 'user', reason: 't', gestureId: h.user.gesture(id, 'to:running') });
    const s = h.store.reserveSession(id);
    h.store.setSessionState(s.id, 'active', 't');
    h.store.setSessionState(s.id, 'expired', 'x');
    h.store.transition(id, 'session_expired', { actor: 'system', reason: 'SESSION_NOT_FOUND' });
    const other = await OsLock.acquire(lockName('session', s.id), 'intruso');
    await expect(h.user.resume(id, 'recomeçar', { newSession: true })).rejects.toMatchObject({ code: 'LOCK_BUSY' });
    expect(h.store.sessionsOf(id).map((x) => x.state)).toEqual(['expired']); // nada mudou
    expect(state(h, id)).toBe('session_expired');
    await other.release();
    await h.user.resume(id, 'recomeçar', { newSession: true });
    await waitState(h, id, 'review');
    expect(h.store.sessionsOf(id).map((x) => x.state).sort()).toEqual(['archived', 'idle']);
  });
});

describe('evidência com git só por gesto explícito', () => {
  it('canal próprio consome um gesto; o canal comum nunca roda git', async () => {
    const h = mk();
    const git = vi.fn(async () => ({ changedFiles: 1, files: ['x'], truncated: false }));
    (h.orch as unknown as { d: { git: unknown } }).d.git = git;
    const handlers = createPocketHandlers({
      forbiddenWorkdirs: () => [], orch: h.orch, store: h.store,
      status: () => ({ ready: true, claudeFound: true, containment: 'job-object', orphansKilled: 0 }), pickFolder: async () => null,
    });
    const call = (ch: PocketChannel, arg?: unknown) => runHandler(handlers[ch], arg);
    const id = ((await call(POCKET_IPC.create, { title: 't', prompt: 'p', cwd: h.ws })) as { data: TaskView }).data.id;
    expect((await call(POCKET_IPC.evidence, { taskId: id })).ok).toBe(true);
    expect(git).not.toHaveBeenCalled();
    const r = await call(POCKET_IPC.evidenceGit, { taskId: id });
    expect(r.ok).toBe(true);
    expect(git).toHaveBeenCalledTimes(1);
    expect(h.store.db.prepare('SELECT COUNT(*) AS n FROM gestures WHERE consumed_at IS NULL').get()).toMatchObject({ n: 0 });
  });
});
