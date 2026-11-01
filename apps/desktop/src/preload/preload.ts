import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type CompanionApi } from '../shared/ipc';

const api: CompanionApi = {
  getSkin: () => ipcRenderer.invoke(IPC.getSkin),
  getFallbackSkin: () => ipcRenderer.invoke(IPC.getFallbackSkin),
  onEvent: (cb) => { ipcRenderer.on(IPC.event, (_e, event) => cb(event)); },
  onWalk: (cb) => { ipcRenderer.on(IPC.walk, (_e, info) => cb(info)); },
  onCursor: (cb) => { ipcRenderer.on(IPC.cursor, (_e, p) => cb(p)); },
  onMode: (cb) => { ipcRenderer.on(IPC.mode, (_e, info) => cb(info)); },
  onIdentity: (cb) => { ipcRenderer.on(IPC.identity, (_e, identity) => cb(identity)); },
  onLeave: (cb) => { ipcRenderer.on(IPC.leave, () => cb()); },
  onMotion: (cb) => { ipcRenderer.on(IPC.motion, (_e, info) => cb(info)); },
  setIgnoreMouse: (ignore) => ipcRenderer.send(IPC.setIgnoreMouse, ignore),
  setShape: (rects) => ipcRenderer.send(IPC.setShape, rects),
  openContextMenu: () => ipcRenderer.send(IPC.contextMenu),
  moveBy: (dx, dy) => ipcRenderer.send(IPC.moveBy, dx, dy),
  dragEnd: () => ipcRenderer.send(IPC.dragEnd),
  setWalkAllowed: (allowed) => ipcRenderer.send(IPC.walkAllowed, allowed),
  walkTo: (x, y) => ipcRenderer.send(IPC.walkTo, x, y),
  walkArrived: () => ipcRenderer.send(IPC.walkArrived),
  notifyClick: () => ipcRenderer.send(IPC.clicked),
};

contextBridge.exposeInMainWorld('teracota', api);
