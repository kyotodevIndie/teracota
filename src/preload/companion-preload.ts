import { contextBridge, ipcRenderer } from 'electron';
import { COMPANION_IPC, type CompanionApi } from '../shared/companion';

const api: CompanionApi = {
  getSkin: () => ipcRenderer.invoke(COMPANION_IPC.getSkin),
  onView: (cb) => { ipcRenderer.on(COMPANION_IPC.view, (_e, view) => cb(view)); },
  onCursor: (cb) => { ipcRenderer.on(COMPANION_IPC.cursor, (_e, p) => cb(p)); },
  setIgnoreMouse: (ignore) => ipcRenderer.send(COMPANION_IPC.setIgnoreMouse, ignore),
  input: (input) => ipcRenderer.send(COMPANION_IPC.input, input),
  moveBy: (dx, dy) => ipcRenderer.send(COMPANION_IPC.moveBy, dx, dy),
  dragEnd: () => ipcRenderer.send(COMPANION_IPC.dragEnd),
  openContextMenu: () => ipcRenderer.send(COMPANION_IPC.contextMenu),
  simulate: (scenario) => ipcRenderer.send(COMPANION_IPC.simulate, scenario),
};

contextBridge.exposeInMainWorld('teracotaCompanion', api);
