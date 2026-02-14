const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('agent', {
  getState: () => ipcRenderer.invoke('get-state'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  testPrint: () => ipcRenderer.invoke('test-print'),
  pollNow: () => ipcRenderer.invoke('poll-now'),
  quit: () => ipcRenderer.invoke('quit'),
  onStateUpdate: (callback) => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('state-update', listener)
    return () => ipcRenderer.removeListener('state-update', listener)
  },
})
