// Janela da interface da Tera: moldura normal, redimensionável, fora do always-on-top.
// Uma só (abrir de novo traz pra frente). Fechar só esconde — a sessão do agente e o
// que estava na tela continuam; o encerramento de verdade é no "Encerrar sessão" ou ao
// sair do app. A personagem não depende desta janela.
import { BrowserWindow } from 'electron';
import path from 'node:path';
import { PANEL_IPC, type BridgeEvent } from '@tera/agent-bridge/contract';

export class PanelWindow {
  private win: BrowserWindow | null = null;
  private quitting = false;

  private get alive(): boolean {
    return !!this.win && !this.win.isDestroyed();
  }

  /** Janela nativa (pra ancorar diálogos), se existir */
  get native(): BrowserWindow | null {
    return this.alive ? this.win : null;
  }

  /** O remetente de um IPC é esta janela? */
  isSender(sender: unknown): boolean {
    return this.alive && this.win!.webContents === sender;
  }

  get visible(): boolean {
    return this.alive && this.win!.isVisible();
  }

  /** Abre (cria na primeira vez) e foca */
  show(): void {
    if (!this.alive) this.create();
    const win = this.win!;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  /** Recolhe sem encerrar nada */
  hide(): void {
    if (this.alive) this.win!.hide();
  }

  /** Repassa um evento do bridge; pedido de permissão com a janela escondida chama atenção sem roubar o foco */
  send(event: BridgeEvent): void {
    if (!this.alive) return;
    this.win!.webContents.send(PANEL_IPC.event, event);
    if (event.type === 'permission-request' && !this.win!.isVisible()) this.win!.showInactive();
  }

  /** Mensagem crua pra interface (ex.: saída do terminal); ignorada se a janela não existe */
  sendRaw(channel: string, payload: unknown): void {
    if (this.alive) this.win!.webContents.send(channel, payload);
  }

  /** Chamar no before-quit: a partir daí fechar fecha de verdade */
  markQuitting(): void {
    this.quitting = true;
  }

  destroy(): void {
    this.markQuitting();
    if (this.alive) this.win!.destroy();
  }

  private create(): void {
    const win = new BrowserWindow({
      width: 760,
      height: 680,
      minWidth: 420,
      minHeight: 480,
      title: 'Tera',
      // visual próprio (vidro): sem moldura do sistema, fundo transparente; a barra de
      // título é do HTML. Windows 11 e macOS desfocam o que está atrás de verdade; no Linux
      // o vidro desfoca o fundo desenhado na própria janela
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      ...(process.platform === 'win32' && { backgroundMaterial: 'acrylic' as const }),
      ...(process.platform === 'darwin' && { vibrancy: 'under-window' as const, visualEffectState: 'active' as const }),
      resizable: true,
      alwaysOnTop: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'panel-preload.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.setMenu?.(null);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.on('close', (e) => {
      if (this.quitting) return;
      e.preventDefault();
      win.hide();
    });
    win.on('closed', () => { if (this.win === win) this.win = null; });
    win.loadFile(path.join(__dirname, 'renderer', 'panel.html'));
    this.win = win;
  }
}
