// Preload do painel de conversa: API estreita; o renderer não enxerga ipcRenderer.
import { contextBridge, ipcRenderer } from 'electron';
import { PANEL_IPC, type BridgeEvent, type PanelApi } from '../shared/bridge';

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
