const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aim', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload)),
  win: action => ipcRenderer.send('win', action),
});
