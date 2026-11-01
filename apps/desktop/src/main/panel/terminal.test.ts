import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { EmbeddedTerminal, SCROLLBACK_LIMIT, type PtyLike, defaultShell, terminalEnv } from './terminal';

function fakePty() {
  let onData: (d: string) => void = () => {};
  let onExit: (e: { exitCode: number }) => void = () => {};
  const pty = {
    written: [] as string[],
    killed: false,
    size: [0, 0],
    onData: (cb: (d: string) => void) => { onData = cb; },
    onExit: (cb: (e: { exitCode: number }) => void) => { onExit = cb; },
    write(d: string) { this.written.push(d); },
    resize(c: number, r: number) { this.size = [c, r]; },
    kill() { this.killed = true; },
    emit: (d: string) => onData(d),
    exit: (code: number) => onExit({ exitCode: code }),
  };
  return pty;
}

function setup() {
  const ptys: ReturnType<typeof fakePty>[] = [];
  const spawns: { file: string; args: string[]; cwd: string }[] = [];
  const events = { data: vi.fn(), exit: vi.fn() };
  const term = new EmbeddedTerminal((file, args, opts) => {
    const p = fakePty();
    ptys.push(p);
    spawns.push({ file, args, cwd: opts.cwd });
    return p as PtyLike;
  }, events, { file: '/bin/bash', args: ['-l'] }, {});
  return { term, ptys, spawns, events };
}

describe('terminal embutido', () => {
  it('abre o shell na pasta escolhida e já roda o claude', () => {
    const { term, ptys, spawns } = setup();
    term.setFolder('/home/user/projeto');
    const snap = term.start(80, 24, true);
    expect(spawns[0]).toEqual({ file: '/bin/bash', args: ['-l'], cwd: '/home/user/projeto' });
    expect(ptys[0]!.written).toEqual(['claude\r']);
    expect(snap).toMatchObject({ running: true, cwdLabel: 'projeto' });
  });

  it('sem pasta escolhida: pasta pessoal; sem claude: só o shell', () => {
    const { term, ptys, spawns } = setup();
    term.start(80, 24, false);
    expect(spawns[0]!.cwd).toBe(os.homedir());
    expect(ptys[0]!.written).toEqual([]);
  });

  it('repassa a saída, guarda o histórico recente e avisa quando o shell sai', () => {
    const { term, ptys, events } = setup();
    term.start(80, 24, false);
    ptys[0]!.emit('olá');
    expect(events.data).toHaveBeenCalledWith('olá');
    expect(term.snapshot().scrollback).toBe('olá');
    ptys[0]!.emit('x'.repeat(SCROLLBACK_LIMIT));
    expect(term.snapshot().scrollback).toHaveLength(SCROLLBACK_LIMIT);
    ptys[0]!.exit(0);
    expect(events.exit).toHaveBeenCalledWith(0);
    expect(term.running).toBe(false);
  });

  it('reabrir mata o anterior e ignora a saída atrasada dele', () => {
    const { term, ptys, events } = setup();
    term.start(80, 24, false);
    term.start(80, 24, false);
    expect(ptys[0]!.killed).toBe(true);
    ptys[0]!.emit('velho');
    ptys[0]!.exit(1);
    expect(events.data).not.toHaveBeenCalledWith('velho');
    expect(events.exit).not.toHaveBeenCalled();
    expect(term.running).toBe(true);
  });

  it('entrada e tamanho vão pro terminal ativo; sem terminal, nada quebra', () => {
    const { term, ptys } = setup();
    term.write('ls\r');
    term.resize(100, 30);
    term.start(80, 24, false);
    term.write('ls\r');
    term.resize(100, 30);
    expect(ptys[0]!.written).toEqual(['ls\r']);
    expect(ptys[0]!.size).toEqual([100, 30]);
    term.kill();
    expect(ptys[0]!.killed).toBe(true);
    expect(term.running).toBe(false);
  });

  it('shell padrão e ambiente', () => {
    expect(defaultShell('win32', {})).toEqual({ file: 'powershell.exe', args: ['-NoLogo'] });
    expect(defaultShell('linux', { SHELL: '/usr/bin/zsh' })).toEqual({ file: '/usr/bin/zsh', args: ['-l'] });
    expect(defaultShell('linux', {})).toEqual({ file: '/bin/bash', args: ['-l'] });
    const env = terminalEnv({ PATH: '/x', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect', HOME: '/h' });
    expect(env).toEqual({ PATH: '/x', HOME: '/h', TERM: 'xterm-256color', COLORTERM: 'truecolor' });
  });
});
