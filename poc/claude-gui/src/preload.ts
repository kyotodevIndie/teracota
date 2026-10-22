import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('poc', {
  pickProject: () => ipcRenderer.invoke('pickProject'),
  listSessions: (dir: string) => ipcRenderer.invoke('listSessions', dir),
  open: (dir: string, resume: string | null, model: string | null) => ipcRenderer.invoke('open', dir, resume, model),
  send: (text: string, images: unknown[]) => ipcRenderer.invoke('send', text, images),
  respond: (id: string, allow: boolean, always: boolean) => ipcRenderer.invoke('respond', id, allow, always),
  interrupt: () => ipcRenderer.invoke('interrupt'),
  on: (cb: (channel: string, payload: unknown) => void) => ipcRenderer.on('poc', (_e, ch, p) => cb(ch, p)),
});
