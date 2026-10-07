import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { platformFor } from '.';

describe('linux', () => {
  const { relaunchArgs } = platformFor('linux');

  it('reabre via XWayland em sessão Wayland, sem repetir a flag', () => {
    const argv = ['electron', '.'];
    const args = relaunchArgs({ XDG_SESSION_TYPE: 'wayland' }, argv);
    expect(args).toEqual(['.', '--ozone-platform=x11']);
    expect(relaunchArgs({ XDG_SESSION_TYPE: 'wayland' }, [...argv, ...args!])).toBeNull();
  });

  it('não reabre em X11', () => {
    expect(relaunchArgs({ XDG_SESSION_TYPE: 'x11' }, ['electron', '.'])).toBeNull();
    expect(relaunchArgs({}, ['electron', '.'])).toBeNull();
  });

  it('não tem autostart', () => {
    expect(platformFor('linux').autostart.supported).toBe(false);
  });
});

describe('windows', () => {
  const { needsShell, whichCommand } = platformFor('win32');

  it('só shims .cmd e .bat precisam de shell', () => {
    expect(needsShell('C:\\npm\\claude.cmd')).toBe(true);
    expect(needsShell('C:\\bin\\claude.EXE')).toBe(false);
    expect(whichCommand).toBe('where.exe');
  });
});

it('sistema sem arquivo próprio cai no linux', () => {
  expect(platformFor('freebsd')).toBe(platformFor('linux'));
});

/** Regra: detecção de SO e compositor só dentro de src/main/platform/ */
describe('regra: plataforma fica em platform/', () => {
  const src = path.resolve(__dirname, '../..');
  const PLATFORM_SPECIFIC = [/process\.platform/, /['"](win32|darwin)['"]/, /where\.exe/, /XDG_(SESSION_TYPE|CURRENT_DESKTOP)/];

  function files(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return full.includes(`${path.sep}platform`) ? [] : files(full);
      return /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [full] : [];
    });
  }

  it.each(files(src).map((f) => [path.relative(src, f), f]))('%s', (_name, file) => {
    const code = fs.readFileSync(file, 'utf8');
    for (const pattern of PLATFORM_SPECIFIC) expect(code, `${pattern} em ${file}`).not.toMatch(pattern);
  });
});
