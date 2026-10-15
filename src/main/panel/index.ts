// Liga o painel de conversa (experimental): bridge, IPC e janela. Desligado por padrão —
// só existe em desenvolvimento e com TERACOTA_AGENT_PANEL=1.
import { app, dialog, ipcMain } from 'electron';
import { BridgeManager } from '../bridge/manager';
import { BRIDGE_PROVIDERS } from '../integrations';
import { makePanelHandlers } from './ipc';
import { PanelWindow } from './window';

export const agentPanelEnabled = (): boolean => process.env.TERACOTA_AGENT_PANEL === '1' && !app.isPackaged;

export class AgentPanel {
  readonly bridge = new BridgeManager(BRIDGE_PROVIDERS);
  readonly window = new PanelWindow();

  constructor() {
    this.bridge.onEvent((e) => this.window.send(e));

    const handlers = makePanelHandlers({
      bridge: this.bridge,
      isPanelSender: (sender) => this.window.isSender((sender as { sender?: unknown } | null)?.sender),
      hide: () => this.window.hide(),
      pickFolder: async () => {
        // o seletor do sistema é o consentimento: o renderer nunca informa caminhos
        const opts: Electron.OpenDialogOptions = { title: 'Escolha a pasta do projeto', properties: ['openDirectory'] };
        const parent = this.window.native;
        const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
        return r.canceled ? null : (r.filePaths[0] ?? null);
      },
    });
    for (const [channel, handler] of Object.entries(handlers)) {
      ipcMain.handle(channel, (event, payload: unknown) => handler(event, payload));
    }

    app.on('before-quit', () => {
      this.window.markQuitting();
      this.bridge.closeAll();
    });
  }

  show(): void {
    this.window.show();
  }
}

let current: AgentPanel | null = null;

export const getAgentPanel = (): AgentPanel | null => current;

export function initAgentPanel(): AgentPanel | null {
  if (!agentPanelEnabled()) return null;
  current ??= new AgentPanel();
  return current;
}

