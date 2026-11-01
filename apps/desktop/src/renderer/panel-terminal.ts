// Aba "Terminal" da interface: xterm.js ligado ao pseudo-terminal do main (shell do
// usuário + o `claude` dele). A janela só esconde ao fechar, então o terminal continua
// aqui; se a página recarregar, o histórico recente volta do main.
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import type { AppPanelApi, PanelResultLike, TerminalSnapshot } from '../shared/app-panel';

export interface TerminalTabOptions {
  api: AppPanelApi['terminal'];
  /** Erro do IPC vira a faixa de erro da interface */
  unwrap<T>(r: PanelResultLike<T>): T | undefined;
}

export function mountTerminalTab({ api, unwrap }: TerminalTabOptions): { show(): void } {
  const $ = (id: string) => document.getElementById(id)!;
  const box = $('term');
  const empty = $('term-empty');
  const cwdEl = $('term-cwd');
  const claudeBtn = $('term-claude') as HTMLButtonElement;
  const shellBtn = $('term-shell') as HTMLButtonElement;
  const killBtn = $('term-kill') as HTMLButtonElement;
  const folderBtn = $('term-folder') as HTMLButtonElement;

  const term = new Terminal({
    fontFamily: 'ui-monospace, "Cascadia Mono", "DejaVu Sans Mono", monospace',
    fontSize: 13,
    cursorBlink: true,
    scrollback: 5000,
    allowTransparency: true, // o vidro da interface aparece por trás do terminal
    theme: {
      background: 'rgba(10, 9, 16, 0.55)', foreground: '#ecebf5', cursor: '#f0a07c', cursorAccent: '#1a1424',
      selectionBackground: 'rgba(217, 119, 87, 0.35)',
    },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  let opened = false;
  let running = false;

  /** O xterm só mede direito depois de visível */
  const ensureOpen = () => {
    if (opened) return;
    box.hidden = false;
    term.open(box);
    opened = true;
  };

  const refit = () => {
    if (!opened || box.hidden || !box.clientWidth) return;
    fit.fit();
    if (running) api.resize(term.cols, term.rows);
  };

  function render(snapshot?: TerminalSnapshot): void {
    if (snapshot) cwdEl.textContent = snapshot.cwdLabel ?? 'pasta pessoal';
    empty.hidden = running || opened;
    box.hidden = !(running || opened);
    killBtn.hidden = !running;
    claudeBtn.textContent = running ? 'Reabrir com o Claude' : 'Abrir o Claude';
    shellBtn.textContent = running ? 'Reabrir só o terminal' : 'Só o terminal';
  }

  async function start(claude: boolean): Promise<void> {
    ensureOpen();
    render();
    fit.fit();
    const snap = unwrap(await api.start(term.cols, term.rows, claude));
    if (!snap) return;
    term.reset();
    running = true;
    render(snap);
    term.focus();
  }

  // Ctrl+Shift+C / Ctrl+Shift+V: copiar e colar (Ctrl+C continua indo pro terminal)
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey) return true;
    if (e.code === 'KeyC' && term.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection());
      return false;
    }
    if (e.code === 'KeyV') {
      void navigator.clipboard.readText().then((t) => { if (t) term.paste(t); });
      return false;
    }
    return true;
  });

  term.onData((data) => { if (running) api.input(data); });
  api.onData((data) => {
    ensureOpen();
    term.write(data);
  });
  api.onExit((code) => {
    running = false;
    term.write(`\r\n\x1b[2m[terminal encerrado${code ? ` (código ${code})` : ''}]\x1b[0m\r\n`);
    render();
  });

  claudeBtn.onclick = () => void start(true);
  shellBtn.onclick = () => void start(false);
  killBtn.onclick = async () => { unwrap(await api.kill()); };
  folderBtn.onclick = async () => {
    const label = unwrap(await api.pickFolder());
    if (label) cwdEl.textContent = running ? `${label} (vale ao reabrir)` : label;
  };

  new ResizeObserver(() => refit()).observe(box);

  // a página recarregou com o terminal vivo: redesenha o que estava na tela
  void api.snapshot().then((r) => {
    const snap = unwrap(r);
    if (!snap) return;
    running = snap.running;
    if (running) {
      ensureOpen();
      term.write(snap.scrollback);
    }
    render(snap);
    refit();
  });

  return {
    show() {
      requestAnimationFrame(() => {
        refit();
        if (running) term.focus();
      });
    },
  };
}
