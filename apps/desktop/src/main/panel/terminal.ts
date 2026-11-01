// Terminal embutido na interface da Tera: um pseudo-terminal (node-pty) com o shell do
// usuário, que pode já abrir o `claude` — o CLI oficial, com o login que o usuário já
// tem. Não é o Agent SDK: o app não autentica nada, só hospeda o terminal. Os hooks do
// plugin funcionam como em qualquer terminal, então a Tera reage a esta sessão também.
//
// Um terminal por vez. Fechar a janela da interface não mata o terminal; sair do app sim.
import os from 'node:os';
import path from 'node:path';
import type { TerminalSnapshot } from '../../shared/app-panel';

export interface PtyLike {
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export type SpawnPty = (file: string, args: string[], opts: { cwd: string; cols: number; rows: number; env: NodeJS.ProcessEnv; name: string }) => PtyLike;

export interface TerminalEvents {
  data(data: string): void;
  exit(code: number): void;
}

/** Quanto da saída recente fica guardado pra redesenhar a tela (caracteres) */
export const SCROLLBACK_LIMIT = 256 * 1024;

/** Shell padrão do usuário: o do sistema, em modo login (carrega o PATH onde o `claude` costuma estar) */
export function defaultShell(platform = process.platform, env = process.env): { file: string; args: string[] } {
  if (platform === 'win32') return { file: 'powershell.exe', args: ['-NoLogo'] };
  return { file: env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash'), args: ['-l'] };
}

/** Ambiente do terminal: o do usuário, sem variáveis que mudariam o comportamento do Electron/Node */
export function terminalEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  for (const key of Object.keys(out)) {
    if (key.startsWith('ELECTRON_') || key === 'NODE_OPTIONS' || key.startsWith('CHROME_')) delete out[key];
  }
  return out;
}

export class EmbeddedTerminal {
  private pty: PtyLike | null = null;
  private cwd: string | null = null;
  private scrollback = '';

  constructor(
    private readonly spawn: SpawnPty,
    private readonly events: TerminalEvents,
    private readonly shell = defaultShell(),
    private readonly env = terminalEnv(process.env),
  ) {}

  get running(): boolean {
    return this.pty !== null;
  }

  /** Pasta escolhida no seletor do sistema (o renderer nunca informa caminhos) */
  setFolder(dir: string): void {
    this.cwd = dir;
  }

  snapshot(): TerminalSnapshot {
    return { running: this.running, cwdLabel: this.cwd ? path.basename(this.cwd) || this.cwd : null, scrollback: this.scrollback };
  }

  /** Abre (ou reabre) o terminal. claude = já digita `claude` no shell */
  start(cols: number, rows: number, claude: boolean): TerminalSnapshot {
    this.kill();
    this.scrollback = '';
    const pty = this.spawn(this.shell.file, this.shell.args, {
      cwd: this.cwd ?? os.homedir(), cols, rows, env: this.env, name: 'xterm-256color',
    });
    this.pty = pty;
    pty.onData((data) => {
      if (this.pty !== pty) return; // saída atrasada de um terminal que já foi trocado
      this.scrollback = (this.scrollback + data).slice(-SCROLLBACK_LIMIT);
      this.events.data(data);
    });
    pty.onExit(({ exitCode }) => {
      if (this.pty !== pty) return;
      this.pty = null;
      this.events.exit(exitCode);
    });
    // o shell guarda o que chega antes do prompt: o comando roda assim que ele estiver pronto
    if (claude) pty.write('claude\r');
    return this.snapshot();
  }

  write(data: string): void {
    this.pty?.write(data);
  }

  resize(cols: number, rows: number): void {
    this.pty?.resize(cols, rows);
  }

  kill(): void {
    const pty = this.pty;
    this.pty = null;
    try {
      pty?.kill();
    } catch {
      // já tinha saído
    }
  }
}
