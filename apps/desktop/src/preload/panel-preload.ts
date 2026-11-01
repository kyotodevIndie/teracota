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
  live: () => ipcRenderer.invoke(APP_PANEL_IPC.live),
  usage: () => ipcRenderer.invoke(APP_PANEL_IPC.usage),
  prefs: () => ipcRenderer.invoke(APP_PANEL_IPC.prefs),
  setPrefs: (patch) => ipcRenderer.invoke(APP_PANEL_IPC.setPrefs, patch),
  expand: () => ipcRenderer.invoke(APP_PANEL_IPC.expand),
  layout: (height, rects) => ipcRenderer.send(APP_PANEL_IPC.layout, { height, rects }),
  onLive: (cb) => { ipcRenderer.on(APP_PANEL_IPC.liveChanged, (_e, v) => cb(v)); },
  onUsage: (cb) => { ipcRenderer.on(APP_PANEL_IPC.usageChanged, (_e, v) => cb(v)); },
  onPrefs: (cb) => { ipcRenderer.on(APP_PANEL_IPC.prefsChanged, (_e, v) => cb(v)); },
  onPlacement: (cb) => { ipcRenderer.on(APP_PANEL_IPC.placement, (_e, v) => cb(v)); },
  plugins: () => ipcRenderer.invoke(APP_PANEL_IPC.plugins),
  setPlugin: (id, on) => ipcRenderer.invoke(APP_PANEL_IPC.setPlugin, { id, on }),
  setPluginValue: (id, key, value) => ipcRenderer.invoke(APP_PANEL_IPC.setPluginValue, { id, key, value }),
  openPluginsFolder: () => ipcRenderer.invoke(APP_PANEL_IPC.openPluginsFolder),
  rescanPlugins: () => ipcRenderer.invoke(APP_PANEL_IPC.rescanPlugins),
  onSpeech: (cb) => { ipcRenderer.on(APP_PANEL_IPC.speech, (_e, v) => cb(v)); },
  onPlugins: (cb) => { ipcRenderer.on(APP_PANEL_IPC.pluginsChanged, (_e, v) => cb(v)); },
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
