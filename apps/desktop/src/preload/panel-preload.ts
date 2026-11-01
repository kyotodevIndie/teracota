// Preload da interface da Tera: APIs estreitas; o renderer não enxerga ipcRenderer.
import { contextBridge, ipcRenderer } from 'electron';
import { PANEL_IPC, type BridgeEvent, type PanelApi } from '@tera/agent-bridge/contract';
import { APP_PANEL_IPC, type AppPanelApi } from '../shared/app-panel';

const api: PanelApi = {
  listProviders: () => ipcRenderer.invoke(PANEL_IPC.listProviders),
  pickFolder: (providerId) => ipcRenderer.invoke(PANEL_IPC.pickFolder, { providerId }),
  startSession: (providerId, resumeId) => ipcRenderer.invoke(PANEL_IPC.startSession, { providerId, ...(resumeId ? { resumeId } : {}) }),
  send: (handle, text) => ipcRenderer.invoke(PANEL_IPC.send, { handle, text }),
  respondPermission: (handle, requestId, allow) => ipcRenderer.invoke(PANEL_IPC.respondPermission, { handle, requestId, allow }),
  interrupt: (handle) => ipcRenderer.invoke(PANEL_IPC.interrupt, { handle }),
  closeSession: (handle) => ipcRenderer.invoke(PANEL_IPC.closeSession, { handle }),
  snapshot: () => ipcRenderer.invoke(PANEL_IPC.snapshot),
  hide: () => ipcRenderer.invoke(PANEL_IPC.hide),
  onEvent: (cb) => { ipcRenderer.on(PANEL_IPC.event, (_e, ev: BridgeEvent) => cb(ev)); },
};

contextBridge.exposeInMainWorld('teracotaPanel', api);

const appApi: AppPanelApi = {
  connections: () => ipcRenderer.invoke(APP_PANEL_IPC.connections),
  connect: (id) => ipcRenderer.invoke(APP_PANEL_IPC.connect, { id }),
  setSpeech: (id, on) => ipcRenderer.invoke(APP_PANEL_IPC.setSpeech, { id, on }),
  copyOpenSessions: (id) => ipcRenderer.invoke(APP_PANEL_IPC.copyOpenSessions, { id }),
  minimize: () => ipcRenderer.invoke(APP_PANEL_IPC.minimize),
  terminal: {
    pickFolder: () => ipcRenderer.invoke(APP_PANEL_IPC.terminalPickFolder),
    start: (cols, rows, claude) => ipcRenderer.invoke(APP_PANEL_IPC.terminalStart, { cols, rows, claude }),
    input: (data) => ipcRenderer.send(APP_PANEL_IPC.terminalInput, data),
    resize: (cols, rows) => ipcRenderer.send(APP_PANEL_IPC.terminalResize, { cols, rows }),
    kill: () => ipcRenderer.invoke(APP_PANEL_IPC.terminalKill),
    snapshot: () => ipcRenderer.invoke(APP_PANEL_IPC.terminalSnapshot),
    onData: (cb) => { ipcRenderer.on(APP_PANEL_IPC.terminalData, (_e, data: string) => cb(data)); },
    onExit: (cb) => { ipcRenderer.on(APP_PANEL_IPC.terminalExit, (_e, code: number) => cb(code)); },
  },
};

contextBridge.exposeInMainWorld('teracotaApp', appApi);
