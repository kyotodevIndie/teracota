// Liga o painel de conversa (experimental): bridge, IPC e janela. Desligado por padrão —
// só existe em desenvolvimento e com TERACOTA_AGENT_PANEL=1.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, dialog, ipcMain } from 'electron';
import { BridgeManager } from '../bridge/manager';
import { createSimulatedProvider } from '../bridge/simulated';
import { linkBridgeToCompanion } from '../bridge/companion-link';
import type { AgentSignal } from '../integrations/types';
import { BRIDGE_PROVIDERS } from '../integrations';
import { makePanelHandlers } from './ipc';
import { resolvePickFolder } from './pick-folder';
import { PanelWindow } from './window';

export const agentPanelEnabled = (): boolean => process.env.TERACOTA_AGENT_PANEL === '1' && !app.isPackaged;

/** Provider de simulação (sem agente, sem custo): só com o painel ligado e TERACOTA_AGENT_PANEL_SIM=1 */
export const simEnabled = (): boolean => agentPanelEnabled() && process.env.TERACOTA_AGENT_PANEL_SIM === '1';

const SIM_DIR_PREFIX = 'teracota-sim-';

export interface AgentPanelOptions {
  /** Recebe os sinais da Tera derivados da sessão do painel (Companion Core) */
  onSignal?(signal: AgentSignal): void;
}

export class AgentPanel {
  readonly bridge = new BridgeManager([...BRIDGE_PROVIDERS, ...(simEnabled() ? [createSimulatedProvider()] : [])]);
  readonly window = new PanelWindow();
  /** Pastas temporárias da simulação criadas por este app (removidas ao sair) */
  private readonly simDirs = new Set<string>();

  constructor(opts: AgentPanelOptions = {}) {
    this.bridge.onEvent((e) => this.window.send(e));
    if (opts.onSignal) linkBridgeToCompanion(this.bridge, opts.onSignal, (h) => this.bridge.describe(h));

    const handlers = makePanelHandlers({
      bridge: this.bridge,
      isPanelSender: (sender) => this.window.isSender((sender as { sender?: unknown } | null)?.sender),
      hide: () => this.window.hide(),
      pickFolder: (providerId) => resolvePickFolder(providerId, simEnabled(), {
        // simulação: pasta temporária descartável, sem diálogo (nada do usuário é tocado)
        makeTemp: () => {
          const dir = fs.mkdtempSync(path.join(os.tmpdir(), SIM_DIR_PREFIX));
          this.simDirs.add(dir);
          return dir;
        },
        // o seletor do sistema é o consentimento: o renderer nunca informa caminhos
        openDialog: async () => {
          const opts: Electron.OpenDialogOptions = { title: 'Escolha a pasta do projeto', properties: ['openDirectory'] };
          const parent = this.window.native;
          const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
          return r.canceled ? null : (r.filePaths[0] ?? null);
        },
      }),
    });
    for (const [channel, handler] of Object.entries(handlers)) {
      ipcMain.handle(channel, (event, payload: unknown) => handler(event, payload));
    }

    app.on('before-quit', () => {
      this.window.markQuitting();
      this.bridge.closeAll();
      this.cleanSimDirs();
    });
  }

  /** Remove só o que o app criou, dentro de os.tmpdir() e com o prefixo da simulação */
  private cleanSimDirs(): void {
    const tmp = path.resolve(os.tmpdir());
    for (const dir of this.simDirs) {
      const abs = path.resolve(dir);
      if (path.dirname(abs) === tmp && path.basename(abs).startsWith(SIM_DIR_PREFIX)) {
        try { fs.rmSync(abs, { recursive: true, force: true }); } catch { /* melhor esforço */ }
      }
    }
    this.simDirs.clear();
  }

  show(): void {
    this.window.show();
  }
}

let current: AgentPanel | null = null;

export const getAgentPanel = (): AgentPanel | null => current;

export function initAgentPanel(opts: AgentPanelOptions = {}): AgentPanel | null {
  if (!agentPanelEnabled()) return null;
  if (!current) {
    current = new AgentPanel(opts);
    if (simEnabled()) current.show(); // homologação: abre já o painel
  }
  return current;
}

