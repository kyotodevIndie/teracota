import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PocketStore } from '../core/store';
import { ClaudeCodeRunner } from '../../integrations/claude-code/pocket/claude-runner';
import type { RunContext } from '../runner/types';
import { FakeSdk, init, result, type Scenario } from '../../integrations/claude-code/pocket/fake-sdk';
import { clock, driveTo, step, tmpDir } from '../testing/helpers';
import { ApprovalService } from './approvals';
import { classifyShell } from './bash';
import { resolveAgainst, setProtectedPaths, workspaceRealpath } from './paths';
import { createPermissionHooks } from './permission-hooks';
import { classifyTool } from './policy';

const win = process.platform === 'win32';
const t = tmpDir('pocket-hard-');
let ws = '';
let wsReal = '';
beforeAll(() => {
  ws = path.join(t.dir, 'Édito ação');
  mkdirSync(path.join(ws, 'src'), { recursive: true });
  writeFileSync(path.join(ws, 'src', 'a.ts'), 'x');
  wsReal = workspaceRealpath(ws);
});
afterAll(() => { setProtectedPaths([]); t.cleanup(); });

const cls = (tool: string, input: Record<string, unknown>) => classifyTool(tool, input, wsReal, ws);

describe('revisão Opus: confinamento de caminhos', () => {
  it.runIf(win)('UNC com barras normais e caminhos de dispositivo são NEGADOS (sem pedir aprovação)', () => {
    for (const p of ['//servidor/share/x', '\\\\servidor\\share\\x', '//./C:/x', '//?/C:/Windows']) {
      expect(cls('Read', { file_path: p }).deny, `Read ${p}`).toBeTruthy();
      expect(cls('Write', { file_path: p, content: 'x' }).deny, `Write ${p}`).toBeTruthy();
      if (!p.includes('?') && !p.includes('\\')) expect(cls('Bash', { command: `cat ${p}` }).deny, `Bash ${p}`).toBeTruthy(); // '?' já torna o comando composto (aprovação)
    }
  });

  it('nome decomposto (NFD) não é aceito: a comparação do NTFS não normaliza Unicode', () => {
    const nfd = 'src/e\u0301.ts';
    expect(resolveAgainst(nfd, ws, wsReal).problem).toBe('invalid');
    expect(cls('Write', { file_path: nfd, content: 'x' })).toMatchObject({ auto: false, cls: 'external_write' });
  });

  it('workspace com acento: dentro continua dentro, em qualquer caixa (realpath canônico)', () => {
    expect(resolveAgainst('src/a.ts', ws, wsReal).inside).toBe(true);
    if (win) {
      const upper = path.join(ws, 'SRC', 'A.TS');
      expect(resolveAgainst(upper, ws, wsReal).inside).toBe(true);
    }
    expect(resolveAgainst(path.join(t.dir, 'Édito ação-irmão', 'x'), ws, wsReal).inside).toBe(false);
  });

  it('dados do Teracota e credenciais do Windows são intocáveis', () => {
    const data = path.join(t.dir, 'dados-teracota');
    mkdirSync(data, { recursive: true });
    setProtectedPaths([data]);
    expect(cls('Write', { file_path: path.join(data, 'pocket.db'), content: 'x' }).deny).toBeTruthy();
    expect(cls('Read', { file_path: path.join(data, 'pocket.db-wal') }).deny).toBeTruthy();
    for (const rel of ['.docker/config.json', '.kube/config', '.azure/x', '_netrc', '.pypirc']) {
      expect(cls('Read', { file_path: path.join(os.homedir(), rel) }).deny, rel).toBeTruthy();
    }
    setProtectedPaths([]);
  });

  it('.git/.husky/.vscode/.claude em QUALQUER profundidade exigem aprovação, em qualquer caixa', () => {
    mkdirSync(path.join(ws, 'pkg', '.git', 'hooks'), { recursive: true });
    for (const p of ['pkg/.git/hooks/pre-commit', 'pkg/sub/.husky/pre-push', 'a/.VSCODE/tasks.json', 'x/.claude/settings.json', 'a/.github/workflows/ci.yml']) {
      expect(cls('Write', { file_path: p, content: '#' }), p).toMatchObject({ cls: 'destructive', auto: false });
    }
  });

  it('Glob com pattern absoluto/.. fora do workspace não é automático; Grep glob também; credencial é negada', () => {
    expect(cls('Glob', { pattern: 'C:/Users/outro/**/*.txt' })).toMatchObject({ cls: 'external_read', auto: false });
    expect(cls('Glob', { pattern: '../**/*.env' })).toMatchObject({ auto: false });
    expect(cls('Grep', { pattern: 'x', glob: '../../*.json' })).toMatchObject({ auto: false });
    expect(cls('Glob', { pattern: `${os.homedir().replace(/\\/g, '/')}/.ssh/*` }).deny).toBeTruthy();
    expect(cls('Glob', { pattern: 'src/**/*.ts' })).toMatchObject({ cls: 'safe_read', auto: true });
    expect(cls('Grep', { pattern: '\\.\\./', glob: '*.ts' }).auto).toBe(true); // 'pattern' do Grep é regex, não caminho
  });
});

describe('revisão Opus (rodada 2): Git Bash, MSYS, chaves, configuração do agente', () => {
  it('barra invertida no Bash é escape (traversal \\.\\./): nunca automático; no PowerShell é separador normal', () => {
    expect(cls('Bash', { command: 'cat .\\./.\\./.\\./Users/x/.ssh/id_rsa' }).auto).toBe(false);
    expect(cls('Bash', { command: 'cat src\\a.ts' }).auto).toBe(false);
    expect(cls('PowerShell', { command: 'Get-Content src\\a.ts' }).auto).toBe(true);
  });

  it.runIf(win)('caminhos MSYS/WSL de credenciais são NEGADOS, não oferecidos', () => {
    const key = path.join(os.homedir(), '.ssh', 'id_rsa');
    const msys = key.replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`).replace(/\\/g, '/');
    expect(cls('Bash', { command: `cat ${msys}` }).deny).toBeTruthy();
    expect(cls('Bash', { command: `cat /mnt${msys}` }).deny).toBeTruthy();
    expect(cls('Bash', { command: 'cat /c/Windows/win.ini' })).toMatchObject({ auto: false, cls: 'external_read' });
  });

  it('Glob com alternativas de chaves não escapa da checagem; chaves comuns seguem livres', () => {
    expect(cls('Glob', { pattern: '{../x,src}/**' }).auto).toBe(false);
    expect(cls('Glob', { pattern: '{src,C:/Users/o}/**' }).auto).toBe(false);
    expect(cls('Glob', { pattern: 'src/**/*.{ts,tsx}' })).toMatchObject({ auto: true });
  });

  it('escrever na configuração do Claude Code (hooks, settings) é NEGADO; dados do Teracota também depois de setProtectedPaths(realpath)', () => {
    expect(cls('Write', { file_path: path.join(os.homedir(), '.claude', 'settings.json'), content: '{}' }).deny).toBeTruthy();
    expect(cls('Edit', { file_path: path.join(os.homedir(), '.claude.json') }).deny).toBeTruthy();
    const data = path.join(t.dir, 'dados-real');
    mkdirSync(data, { recursive: true });
    setProtectedPaths([data]);
    expect(cls('Read', { file_path: path.join(data, 'x.db') }).deny).toBeTruthy();
    setProtectedPaths([]);
  });
});

describe('revisão Opus: Bash', () => {
  it('parâmetro com valor colado (-Path:C:\\...) e caminhos relativos ao drive são conferidos', () => {
    expect(classifyShell('Get-Content -Path:C:\\Windows\\win.ini').pathArgs).toContain('C:\\Windows\\win.ini');
    expect(cls('PowerShell', { command: 'Get-Content -Path:C:\\Windows\\win.ini' }).auto).toBe(false);
    expect(cls('Bash', { command: 'cat --file=../x' }).auto).toBe(false);
    expect(cls('Bash', { command: 'cat C:foo' }).auto).toBe(win); // relativo ao cwd do drive: resolve para dentro quando o cwd está no mesmo drive
    expect(cls('Bash', { command: 'cat src/a.ts' }).auto).toBe(true);
  });

  const safeGit = ['git status', 'git status --porcelain', 'git status -s -b', 'git log --oneline -5', 'git log --graph --oneline --decorate', 'git diff --stat',
    'git diff --name-only --cached', 'git show --stat HEAD', 'git rev-parse --short HEAD', 'git ls-files', 'git branch', 'git branch -a'];
  it.each(safeGit)('git permitido: %s', (c) => expect(classifyShell(c).cls).toBe('safe'));
  const otherGit = ['git log --pretty=format:%H', 'git diff --out=x', 'git diff --output=x', 'git --config-env=a=b status', 'git -c core.pager=x log', 'git status --ignored',
    'git log --exec-path', 'git diff --ext-diff', 'git diff --no-ext-diff --textconv', 'git config user.name x', 'git ls-files --deleted --exclude-from=x', 'git branch -m x', 'git log --all-match'];
  it.each(otherGit)('git NÃO permitido: %s', (c) => expect(classifyShell(c).cls).not.toBe('safe'));
});

describe('revisão Opus: portão PreToolUse, aprovação presa à ferramenta', () => {
  const stores: PocketStore[] = [];
  afterEach(() => { while (stores.length) stores.pop()?.close(); });
  function setup() {
    const c = clock();
    const store = PocketStore.open(':memory:', { now: c });
    stores.push(store);
    const task = driveTo(store, 'running', ws);
    const sess = store.reserveSession(task.id);
    const run = store.beginRun({ taskId: task.id, sessionId: sess.id, kind: 'start' });
    const approvals = new ApprovalService(store);
    let held = true;
    const hooks = createPermissionHooks({ store, approvals, lockHeld: () => held });
    const ctx: RunContext = { taskId: task.id, sessionId: sess.id, runId: run.id, cwd: ws, policy: { approvalTtlMs: 1 }, attempt: 1, resumed: false };
    const req = (toolName: string, input: Record<string, unknown>, toolUseId = 'tu1') => ({ toolName, input, toolUseId, signal: new AbortController().signal });
    return { store, task, run, approvals, hooks, ctx, req, setHeld: (v: boolean) => { held = v; } };
  }

  it('precheck: nega credenciais, perda de lock e R6; libera o resto para o fluxo normal', () => {
    const s = setup();
    expect(s.hooks.precheck(s.ctx, s.req('Read', { file_path: path.join(os.homedir(), '.ssh', 'id_rsa') }))).toMatchObject({ kind: 'deny', code: 'POLICY_DENIED' });
    expect(s.hooks.precheck(s.ctx, s.req('Write', { file_path: 'src/n.ts', content: 'x' }))).toBe('ask'); // escreve: o canUseTool precisa registrar a intenção
    expect(s.hooks.precheck(s.ctx, s.req('Read', { file_path: 'src/a.ts' }))).toBeNull();
    expect(s.hooks.precheck(s.ctx, s.req('Bash', { command: 'rm -rf x' }))).toBe('ask');
    s.setHeld(false);
    expect(s.hooks.precheck(s.ctx, s.req('Read', { file_path: 'src/a.ts' }))).toMatchObject({ kind: 'deny', interrupt: true, code: 'LOCK_LOST' });
  });

  it('finalize recusa se o toolUseId ou a ferramenta forem outros que os aprovados', async () => {
    const s = setup();
    step(s.store, s.task.id, 'awaiting_approval');
    const cmd = { command: 'rm -rf build' };
    const a = await s.hooks.decide(s.ctx, s.req('Bash', cmd, 'tu-A'));
    if (a.kind !== 'ask') throw new Error('esperava ask');
    const signed = s.approvals.decideByUser(a.approvalRequestId, 'allow', s.store.issueGesture('approval', s.task.id, `approval:${a.approvalRequestId}`));
    expect(await s.hooks.finalize(s.ctx, s.req('Bash', cmd, 'tu-OUTRO'), signed)).toMatchObject({ kind: 'deny' });
    expect(await s.hooks.finalize(s.ctx, s.req('PowerShell', cmd, 'tu-A'), signed)).toMatchObject({ kind: 'deny' });
    expect(await s.hooks.finalize(s.ctx, s.req('Bash', cmd, 'tu-A'), signed)).toEqual({ kind: 'allow' }); // as recusas não consumiram
  });

  it('o runner instala o PreToolUse (só nega) e desliga Task/Agent/Skill; o hook nega credenciais ANTES do canUseTool', async () => {
    const s = setup();
    const sdk = new FakeSdk();
    const probe: { deny?: Record<string, unknown>; pass?: Record<string, unknown> } = {};
    const sc: Scenario = async function* (ctl) {
      yield init(ctl);
      probe.deny = await ctl.preToolUse('Read', { file_path: path.join(os.homedir(), '.aws', 'credentials') }, 'tu1');
      probe.pass = await ctl.preToolUse('Read', { file_path: 'src/a.ts' }, 'tu2');
      yield result();
      await ctl.promptClosed;
    };
    sdk.next(sc);
    const runner = new ClaudeCodeRunner({
      sdk, hooks: s.hooks, env: { PATH: 'x' },
      sink: ((runId: string, type: never, payload: never) => s.store.appendEvent(runId, type, payload)) as never,
    });
    await runner.start({ taskId: s.task.id, runId: s.run.id, sessionId: s.ctx.sessionId, cwd: ws, prompt: 'p', policy: { approvalTtlMs: 1 } });
    await runner.idle();
    expect(probe.deny).toMatchObject({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' } });
    expect(probe.pass).toEqual({});
    expect(sdk.calls[0]?.options.disallowedTools).toEqual(expect.arrayContaining(['Task', 'Agent', 'Skill']));
  });
});
