const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('parityBridge', {
  call: (cmd, args) => ipcRenderer.invoke('p', cmd, args),
});
