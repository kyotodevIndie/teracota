import { linkSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tmpDir } from '../testing/helpers';
import { isCredentialPath, isExecutionSensitive, isInside, resolveAgainst, workspaceRealpath } from './paths';

const win = process.platform === 'win32';
const t = tmpDir('pocket-sec-');
let ws = '';
let outside = '';
let wsReal = '';

beforeAll(() => {
  ws = path.join(t.dir, 'ws');
  outside = path.join(t.dir, 'outside');
  mkdirSync(path.join(ws, 'sub'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(outside, 'secret.txt'), 'x');
  writeFileSync(path.join(ws, 'sub', 'a.txt'), 'a');
  wsReal = workspaceRealpath(ws);
});
afterAll(() => t.cleanup());

const r = (p: string, write = false) => resolveAgainst(p, ws, wsReal, { forWrite: write });

describe('confinamento ao workspace', () => {
  it('dentro: relativo, absoluto, inexistente em subpasta nova, ./ e .. que volta', () => {
    expect(r('sub/a.txt').inside).toBe(true);
    expect(r(path.join(ws, 'sub', 'a.txt')).inside).toBe(true);
    expect(r('novo/dir/fundo/f.ts', true)).toMatchObject({ inside: true, exists: false });
    expect(r('./sub/../sub/a.txt').inside).toBe(true);
    expect(r('.').inside).toBe(true);
  });

  it('fora: .., absoluto externo, prefixo irmão ("ws-evil"), raiz e disco', () => {
    expect(r('../outside/secret.txt')).toMatchObject({ inside: false, problem: 'outside' });
    expect(r(path.join(outside, 'secret.txt')).inside).toBe(false);
    expect(r(`${ws}-evil${path.sep}x`).inside).toBe(false);
    expect(r(path.parse(ws).root).inside).toBe(false);
    expect(r('sub/../../outside/x').inside).toBe(false);
  });

  it.runIf(win)('Windows: maiúsculas/minúsculas não enganam; formas enganosas são recusadas', () => {
    expect(r(path.join(ws, 'SUB', 'A.TXT').toUpperCase()).inside).toBe(true);
    expect(r(path.join(outside, 'SECRET.TXT').toUpperCase()).inside).toBe(false);
    expect(r('sub\\a.txt:stream')).toMatchObject({ inside: false, problem: 'alternate_data_stream' });
    expect(r('CON')).toMatchObject({ problem: 'reserved_name' });
    expect(r('sub\\nul.txt')).toMatchObject({ problem: 'reserved_name' });
    expect(r('sub\\a.txt.')).toMatchObject({ problem: 'trailing_dot_space' });
    expect(r('sub\\a.txt ')).toMatchObject({ problem: 'trailing_dot_space' });
    expect(r('\\\\.\\C:\\x')).toMatchObject({ problem: 'device_path' });
    expect(r('\\\\?\\C:\\Windows')).toMatchObject({ problem: 'device_path' });
    expect(r('\\\\servidor\\share\\x')).toMatchObject({ inside: false, problem: 'unc' });
  });

  it('entradas inválidas: NUL, vazio, não-string', () => {
    expect(r('a\0b').problem).toBe('invalid');
    expect(r('').problem).toBe('invalid');
    expect(resolveAgainst(undefined, ws, wsReal).problem).toBe('invalid');
    expect(resolveAgainst(42, ws, wsReal).problem).toBe('invalid');
  });

  it('junction dentro do workspace apontando para fora é detectada pelo caminho real', () => {
    const link = path.join(ws, 'portal');
    symlinkSync(outside, link, 'junction');
    try {
      const res = r('portal/secret.txt');
      expect(res.inside).toBe(false);
      expect(res.real.toLowerCase()).toContain('outside');
      const novo = r('portal/novo.txt', true); // arquivo que ainda não existe, mas cairia fora
      expect(novo.inside).toBe(false);
    } finally { rmSync(link, { recursive: true, force: true }); }
  });

  it('junction que aponta para dentro continua dentro', () => {
    const link = path.join(ws, 'atalho');
    symlinkSync(path.join(ws, 'sub'), link, 'junction');
    try { expect(r('atalho/a.txt').inside).toBe(true); } finally { rmSync(link, { recursive: true, force: true }); }
  });

  it('link pendente (alvo removido) é recusado, não tratado como arquivo novo', () => {
    const alvo = path.join(t.dir, 'alvo-temporario');
    mkdirSync(alvo);
    const link = path.join(ws, 'pendente');
    symlinkSync(alvo, link, 'junction');
    rmSync(alvo, { recursive: true });
    try {
      expect(r('pendente/novo.txt', true)).toMatchObject({ inside: false });
      expect(['dangling_link', 'unresolvable']).toContain(r('pendente/novo.txt', true).problem);
    } finally { rmSync(link, { recursive: true, force: true }); }
  });

  it('symlink de arquivo para fora (se o SO permitir criar) é detectado', () => {
    const link = path.join(ws, 'file-link.txt');
    try { symlinkSync(path.join(outside, 'secret.txt'), link, 'file'); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EPERM') return; // sem privilégio: junction já cobre o caso
      throw e;
    }
    try { expect(r('file-link.txt', true).inside).toBe(false); } finally { rmSync(link, { force: true }); }
  });

  it('hardlink de dentro para um arquivo de fora é tratado como fora na escrita', () => {
    const hl = path.join(ws, 'hard.txt');
    linkSync(path.join(outside, 'secret.txt'), hl);
    try {
      expect(r('hard.txt', true)).toMatchObject({ inside: false, problem: 'hardlink' });
      expect(r('hard.txt', false).inside).toBe(true); // leitura de arquivo no workspace não exige isso
    } finally { rmSync(hl, { force: true }); }
  });

  it('isInside compara por caminho, não por prefixo de texto', () => {
    expect(isInside('/a/b', '/a/b/c')).toBe(true);
    expect(isInside('/a/b', '/a/bc')).toBe(false);
    expect(isInside('/a/b', '/a/b/../x')).toBe(false);
  });
});

describe('caminhos sensíveis', () => {
  it('credenciais nunca são oferecidas', () => {
    const h = os.homedir();
    expect(isCredentialPath(path.join(h, '.ssh', 'id_ed25519'))).toBe(true);
    expect(isCredentialPath(path.join(h, '.aws', 'credentials'))).toBe(true);
    expect(isCredentialPath(path.join(h, '.claude', '.credentials.json'))).toBe(true);
    expect(isCredentialPath(path.join(h, '.git-credentials'))).toBe(true);
    expect(isCredentialPath(path.join(h, 'projetos', 'x.ts'))).toBe(false);
  });

  it('pastas que executam código/configuração dentro do workspace exigem aprovação', () => {
    for (const p of ['.git/hooks/pre-commit', '.claude/settings.json', '.husky/pre-push', '.vscode/tasks.json', '.github/workflows/ci.yml', '.GIT/config']) {
      expect(isExecutionSensitive(ws, path.join(ws, p)), p).toBe(true);
    }
    expect(isExecutionSensitive(ws, path.join(ws, 'src', 'git.ts'))).toBe(false);
    expect(isExecutionSensitive(ws, path.join(ws, '.github', 'ISSUE_TEMPLATE', 'x.md'))).toBe(false);
  });
});
