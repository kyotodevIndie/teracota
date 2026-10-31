// A interface da Tera (abre ao clicar nela): conexão com agentes + sessões do Agent
// Bridge. Uma janela só, separada da janela da personagem; fechar só esconde.
// O provider simulado (sem agente, sem custo) só existe em desenvolvimento, com
// TERACOTA_AGENT_PANEL_SIM=1.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, dialog, ipcMain } from 'electron';
import { BridgeManager } from '@tera/agent-bridge';
import { createSimulatedProvider } from '@tera/agent-bridge';
import { linkBridgeToCompanion } from '../bridge/companion-link';
import type { AgentSignal } from '../integrations/types';
import { BRIDGE_PROVIDERS } from '../integrations';
import type { EntityManager } from '../manager';
import { adapterById, connectAgent, connectionStatus, connectOpenSessions, setSpeech } from '../connect-flow';
import { makeAppPanelHandlers } from './app-ipc';
import { makePanelHandlers } from './ipc';
import { resolvePickFolder } from './pick-folder';
import { PanelWindow } from './window';

/** Provider de simulação (sem agente, sem custo): só em desenvolvimento e com TERACOTA_AGENT_PANEL_SIM=1 */
export const simEnabled = (): boolean => !app.isPackaged && process.env.TERACOTA_AGENT_PANEL_SIM === '1';

const SIM_DIR_PREFIX = 'teracota-sim-';

export interface AgentPanelOptions {
  /** Recebe os sinais da Tera derivados da sessão do painel (Companion Core) */
  onSignal?(signal: AgentSignal): void;
  /** Pra conectar agentes pela interface (a Tera conta como foi) */
  manager?: EntityManager;
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

    const manager = opts.manager;
    const appHandlers = makeAppPanelHandlers({
      isPanelSender: (sender) => this.window.isSender((sender as { sender?: unknown } | null)?.sender),
      connections: connectionStatus,
      connect: async (id) => {
        const adapter = adapterById(id);
        if (!adapter || !manager) return false;
        await connectAgent(manager, adapter);
        return true;
      },
      setSpeech: async (id, on) => {
        const adapter = adapterById(id);
        if (!adapter || !manager) return false;
        await setSpeech(manager, adapter, on);
        return true;
      },
      copyOpenSessions: (id) => {
        const adapter = adapterById(id);
        if (!adapter || !manager) return false;
        connectOpenSessions(manager, adapter);
        return true;
      },
    });
    for (const [channel, handler] of Object.entries(appHandlers)) {
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

export function initAgentPanel(opts: AgentPanelOptions = {}): AgentPanel {
  if (!current) {
    current = new AgentPanel(opts);
    if (simEnabled()) current.show(); // homologação: abre já o painel
  }
  return current;
}

