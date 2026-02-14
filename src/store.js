const Store = require('electron-store')

const store = new Store({
  defaults: {
    apiUrl: 'https://shipwave.app',
    // Legacy plain token key is kept for migration; new installs use encrypted storage.
    agentToken: '',
    agentTokenEncrypted: '',
    printerName: '',
    pollInterval: 30,
    autoLaunch: false,
    recentJobs: [],
  },
})

module.exports = store
