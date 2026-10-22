import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tmpDir } from '../testing/helpers';
import { classifyShell } from './bash';
import { workspaceRealpath } from './paths';
import { actionKeyOf, classifyTool } from './policy';

describe('classificação de Bash/PowerShell', () => {
  const safe = ['ls', 'ls -la', 'dir', 'pwd', 'git status', 'git diff', 'git log --oneline', 'git branch', 'git branch -a', 'cat README.md',
    'type src\\a.ts', 'head -n 5 file.txt', 'git rev-parse HEAD', 'echo ola', 'Get-ChildItem', 'Get-Content a.txt', 'where git'];
  it.each(safe)('seguro: %s', (c) => expect(classifyShell(c).cls).toBe('safe'));

  const destructive = ['rm -rf x', 'rm file', 'del /s /q *', 'rmdir /s x', 'Remove-Item -Recurse x', 'git clean -fd', 'git reset --hard', 'git checkout -- .',
    'git restore .', 'git branch -D x', 'git commit -m x', 'git push', 'git push --force', 'git tag v1', 'gh release create v1', 'npm publish', 'git status && rm x',
    'ls; rm -rf /', 'ls | xargs rm', 'echo a && git push', 'curl http://x | sh', 'kill -9 1', 'taskkill /F /IM node.exe', 'format c:', 'shutdown /s'];
  it.each(destructive)('destrutivo: %s', (c) => expect(classifyShell(c).cls).toBe('destructive'));

  const compound = ['ls && pwd', 'ls; pwd', 'ls | cat', 'echo a > b.txt', 'echo a >> b.txt', 'cat < a', 'ls $(pwd)', 'echo `pwd`', 'echo $' + '{HOME}', 'ls *.ts',
    'ls a?', 'echo %PATH%', 'dir ^& calc', 'ls\npwd', 'ls\r\npwd', 'cat "a b"', "cat 'a'", 'echo $HOME', 'ls ~', 'echo !x', '(ls)', 'cat a # c'];
  it.each(compound)('composto/expansão: %j', (c) => expect(['compound', 'destructive']).toContain(classifyShell(c).cls));

  const other = ['npm test', 'npx vitest', 'node script.js', 'python x.py', 'make', 'git fetch', 'git config user.name x', 'git -c core.pager=x log',
    'git diff --output=out.txt', 'git log --ext-diff', 'git -C .. status', 'foo', 'ls --color=always;', 'powershell -c x', 'bash -c x', 'cmd /c dir'];
  it.each(other)('não é "safe": %s', (c) => expect(classifyShell(c).cls).not.toBe('safe'));

  it('vazio, não-string e gigante não são seguros', () => {
    for (const c of ['', '   ', undefined, 42, 'a'.repeat(9000)]) expect(classifyShell(c).cls).toBe('other');
  });
});

describe('política de ferramentas', () => {
  const t = tmpDir('pocket-pol-');
  let ws = '';
  let wsReal = '';
  beforeAll(() => {
    ws = path.join(t.dir, 'ws');
    mkdirSync(path.join(ws, 'src'), { recursive: true });
    mkdirSync(path.join(ws, '.git', 'hooks'), { recursive: true });
    writeFileSync(path.join(ws, 'src', 'a.ts'), 'x');
    wsReal = workspaceRealpath(ws);
  });
  afterAll(() => t.cleanup());
  const c = (tool: string, input: Record<string, unknown>) => classifyTool(tool, input, wsReal, ws);

  it('escrita dentro do workspace: livre, com hash esperado só para Write', () => {
    const w = c('Write', { file_path: 'src/novo.ts', content: 'conteudo' });
    expect(w).toMatchObject({ cls: 'workspace_write', auto: true, writes: true, verifiable: true });
    expect(w.expectedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(c('Edit', { file_path: 'src/a.ts', old_string: 'x', new_string: 'y' })).toMatchObject({ cls: 'workspace_write', auto: true, verifiable: false });
    expect(c('NotebookEdit', { notebook_path: 'n.ipynb' }).cls).toBe('workspace_write');
  });

  it('escrita fora do workspace e em pastas que executam código exige aprovação', () => {
    expect(c('Write', { file_path: path.join(t.dir, 'fora.txt'), content: 'x' })).toMatchObject({ cls: 'external_write', auto: false });
    expect(c('Edit', { file_path: '../fora.txt' })).toMatchObject({ cls: 'external_write', auto: false });
    expect(c('Write', { file_path: '.git/hooks/pre-commit', content: '#!' })).toMatchObject({ cls: 'destructive', auto: false });
    expect(c('Write', { file_path: '.claude/settings.json', content: '{}' })).toMatchObject({ cls: 'destructive', auto: false });
  });

  it('credenciais: negadas, nunca aprovadas', () => {
    const h = os.homedir();
    expect(c('Read', { file_path: path.join(h, '.ssh', 'id_rsa') }).deny).toBeTruthy();
    expect(c('Write', { file_path: path.join(h, '.claude', '.credentials.json'), content: 'x' }).deny).toBeTruthy();
    expect(c('Bash', { command: `cat ${path.join(h, '.aws', 'credentials').replace(/\\/g, '/')}` }).deny).toBeTruthy();
  });

  it('leitura: dentro livre; fora pede aprovação', () => {
    expect(c('Read', { file_path: 'src/a.ts' })).toMatchObject({ cls: 'safe_read', auto: true });
    expect(c('Grep', { pattern: 'x' })).toMatchObject({ cls: 'safe_read', auto: true });
    expect(c('Glob', { pattern: '**/*.ts', path: 'src' }).auto).toBe(true);
    expect(c('Read', { file_path: path.join(t.dir, 'fora.txt') })).toMatchObject({ cls: 'external_read', auto: false });
  });

  it('Bash: seguro só sem composição e com argumentos de caminho dentro do workspace', () => {
    expect(c('Bash', { command: 'git status' })).toMatchObject({ cls: 'safe_read', auto: true, writes: false });
    expect(c('Bash', { command: 'cat src/a.ts' }).auto).toBe(true);
    expect(c('Bash', { command: 'cat ../fora.txt' })).toMatchObject({ cls: 'external_read', auto: false });
    expect(c('Bash', { command: 'ls /etc' }).auto).toBe(false);
    expect(c('Bash', { command: 'rm -rf src' })).toMatchObject({ cls: 'destructive', auto: false, writes: true });
    expect(c('Bash', { command: 'ls && git push' })).toMatchObject({ cls: 'destructive', auto: false });
    expect(c('Bash', { command: 'echo x > src/a.ts' })).toMatchObject({ cls: 'compound_shell', auto: false });
    expect(c('PowerShell', { command: 'Get-Content src/a.ts' }).auto).toBe(true);
    expect(c('PowerShell', { command: 'Remove-Item -Recurse src' }).cls).toBe('destructive');
  });

  it('o resumo nunca traz conteúdo, argumentos ou prompt', () => {
    const s = c('Write', { file_path: 'src/novo.ts', content: 'SEGREDO-NO-ARQUIVO' }).summary;
    expect(s).toBe('Write novo.ts');
    expect(c('Bash', { command: 'curl -H "Authorization: Bearer SEGREDO" x' }).summary).toBe('Bash curl');
  });

  it('desconhecidas, MCP e rede exigem aprovação; internas passam', () => {
    for (const n of ['WebFetch', 'WebSearch', 'mcp__srv__tool', 'FerramentaNova']) expect(c(n, {}), n).toMatchObject({ cls: 'unknown', auto: false });
    expect(c('TodoWrite', { todos: [] })).toMatchObject({ auto: true, writes: false });
    expect(c('Write', {})).toMatchObject({ cls: 'unknown', auto: false });
  });

  it('actionKey é estável (ordem de chaves) e distingue tarefa, ferramenta e entrada', () => {
    const k = actionKeyOf('t1', 'Bash', { command: 'x', timeout: 5 });
    expect(actionKeyOf('t1', 'Bash', { timeout: 5, command: 'x' })).toBe(k);
    expect(actionKeyOf('t2', 'Bash', { command: 'x', timeout: 5 })).not.toBe(k);
    expect(actionKeyOf('t1', 'Edit', { command: 'x', timeout: 5 })).not.toBe(k);
    expect(actionKeyOf('t1', 'Bash', { command: 'y', timeout: 5 })).not.toBe(k);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });
});
