const {
  app,
  ipcMain,
  nativeImage,
  Notification,
  Tray,
  BrowserWindow,
  safeStorage,
  Menu,
} = require('electron')
const path = require('path')
const store = require('./store')
const { fetchPendingJobs, updateJobStatus } = require('./api-client')
const { listPrinters, downloadLabel, printLabel } = require('./printer')

// No dock icon — tray only.
app.dock?.hide()

let tray = null
let windowRef = null
let pollTimer = null
let pollInFlight = false
let isQuitting = false

const state = {
  connected: false,
  polling: false,
  lastCheck: null,
  queueSize: 0,
  error: null,
  recentJobs: store.get('recentJobs') || [],
}

function sendState() {
  if (windowRef?.webContents && !windowRef.isDestroyed()) {
    windowRef.webContents.send('state-update', state)
  }
}

function addRecentJob(job, status) {
  const entry = {
    id: job.id,
    trackingCode: job.trackingCode || '',
    orderNumber: job.orderNumber || '',
    status,
    timestamp: new Date().toISOString(),
  }
  state.recentJobs = [entry, ...state.recentJobs].slice(0, 20)
  store.set('recentJobs', state.recentJobs)
}

function trimErrorMessage(message) {
  const normalized = String(message || '').trim()
  return normalized ? normalized.slice(0, 500) : 'Unknown print error'
}

function normalizeApiUrl(apiUrl) {
  const value = String(apiUrl || '').trim()
  if (!value) {
    throw new Error('API URL is required')
  }

  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('API URL must be a valid URL')
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('API URL must use http or https')
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  return parsed.toString().replace(/\/+$/, '')
}

function normalizePollInterval(raw) {
  const value = Number(raw)
  if (!Number.isFinite(value)) return 30
  return Math.max(10, Math.min(300, Math.floor(value)))
}

function getStoredToken() {
  const encrypted = store.get('agentTokenEncrypted')
  if (typeof encrypted === 'string' && encrypted) {
    if (!safeStorage.isEncryptionAvailable()) {
      return ''
    }
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch {
      return ''
    }
  }

  const legacy = String(store.get('agentToken') || '').trim()
  if (legacy && safeStorage.isEncryptionAvailable()) {
    setStoredToken(legacy)
    store.delete('agentToken')
  }

  return legacy
}

function setStoredToken(token) {
  const value = String(token || '').trim()
  if (!value) {
    store.delete('agentTokenEncrypted')
    store.delete('agentToken')
    return
  }

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(value).toString('base64')
    store.set('agentTokenEncrypted', encrypted)
    store.delete('agentToken')
  } else {
    store.set('agentToken', value)
    store.delete('agentTokenEncrypted')
  }
}

function getAgentConfig() {
  const apiUrl = normalizeApiUrl(store.get('apiUrl'))
  const token = getStoredToken()
  return { apiUrl, token }
}

function isAlreadyClaimedError(error) {
  return error && error.status === 409 && error.errorCode === 'already_claimed'
}

function isInvalidTransitionError(error) {
  return error && error.status === 409 && error.errorCode === 'invalid_transition'
}

async function processJob(job, serverSettings) {
  let claimed = false

  try {
    const config = getAgentConfig()

    // Atomically claim this pending job.
    await updateJobStatus(config, job.id, 'printing')
    claimed = true

    if (!job.labelUrl) {
      throw new Error('No label URL')
    }

    const printerName = store.get('printerName') || job.printerName || serverSettings.defaultPrinterName
    if (!printerName) {
      throw new Error('No printer configured')
    }

    const filePath = await downloadLabel(job.labelUrl)
    await printLabel(filePath, printerName, job.labelFormat)

    await updateJobStatus(config, job.id, 'completed')
    addRecentJob(job, 'completed')

    try {
      new Notification({
        title: 'Label Printed',
        body: `${job.trackingCode || job.orderNumber || 'Label'} sent to ${printerName}`,
      }).show()
    } catch {
      // Notification failures should not fail job handling.
    }
  } catch (err) {
    if (isAlreadyClaimedError(err) || isInvalidTransitionError(err)) {
      return
    }

    console.error(`Job ${job.id} failed:`, err.message)

    if (claimed) {
      const failureMessage = trimErrorMessage(err.message)
      try {
        const config = getAgentConfig()
        await updateJobStatus(config, job.id, 'failed', failureMessage)
      } catch {
        // Ignore status update failures; stale recovery will eventually requeue if needed.
      }
    }

    addRecentJob(job, 'failed')
  }
}

async function pollJobs() {
  if (pollInFlight) return

  let config
  try {
    config = getAgentConfig()
  } catch (err) {
    state.connected = false
    state.error = err.message
    sendState()
    return
  }

  if (!config.token) {
    state.connected = false
    state.error = 'No agent token configured'
    sendState()
    return
  }

  pollInFlight = true
  state.polling = true
  sendState()

  try {
    const data = await fetchPendingJobs(config)
    const jobs = Array.isArray(data.jobs) ? data.jobs : []

    state.connected = true
    state.error = null
    state.lastCheck = new Date().toISOString()
    state.queueSize = jobs.length

    for (const [index, job] of jobs.entries()) {
      await processJob(job, data.settings || {})
      state.queueSize = Math.max(jobs.length - (index + 1), 0)
      sendState()
    }
  } catch (err) {
    console.error('Poll error:', err.message)
    state.connected = false
    state.error = err.message
  } finally {
    state.polling = false
    pollInFlight = false
    sendState()
  }
}

function startPolling() {
  stopPolling()
  const interval = normalizePollInterval(store.get('pollInterval')) * 1000
  void pollJobs()
  pollTimer = setInterval(() => {
    void pollJobs()
  }, interval)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function createTrayIcon() {
  const candidates = [
    path.join(__dirname, '..', 'assets', 'iconTemplate.png'),
    path.join(__dirname, '..', 'assets', 'icon.png'),
  ]

  for (const file of candidates) {
    const icon = nativeImage.createFromPath(file)
    if (!icon.isEmpty()) {
      const resized = icon.resize({ width: 18, height: 18 })
      resized.setTemplateImage(true)
      return resized
    }
  }

  return nativeImage.createFromBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAaklEQVR4Ae2TsQ0AIAwD8/+nAIGU' +
      'LJBBDOBFbogsZ8U0aRIIoQj8FwCaZGOt6i4ze2YugJlxk6QEAECSJCR1d2bGvbT1hO4OM3MGiK' +
      'gGMDOYGUlI0t1ZlqWq4FtIP+N9x//8DzfwABYNhNpMJ94fAAAAAElFTkSuQmCC',
      'base64'
    )
  )
}

function createWindow() {
  windowRef = new BrowserWindow({
    width: 360,
    height: 560,
    show: false,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    frame: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  windowRef.loadFile(path.join(__dirname, 'index.html'))

  windowRef.on('blur', () => {
    if (!isQuitting && windowRef && !windowRef.webContents.isDevToolsOpened()) {
      windowRef.hide()
    }
  })

  windowRef.on('closed', () => {
    windowRef = null
  })
}

function positionAndShowWindow() {
  if (!tray || !windowRef) return

  const trayBounds = tray.getBounds()
  const windowBounds = windowRef.getBounds()

  const x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2)
  const y = process.platform === 'darwin'
    ? Math.round(trayBounds.y + trayBounds.height + 4)
    : Math.round(trayBounds.y + trayBounds.height)

  windowRef.setPosition(x, y, false)
  windowRef.show()
  windowRef.focus()
}

function toggleWindow() {
  if (!windowRef) return
  if (windowRef.isVisible()) {
    windowRef.hide()
  } else {
    positionAndShowWindow()
  }
}

function createTray() {
  tray = new Tray(createTrayIcon())
  tray.setToolTip('ShipWave Print Agent')

  tray.on('click', () => {
    toggleWindow()
  })

  tray.on('double-click', () => {
    toggleWindow()
  })

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open ShipWave Print Agent', click: () => positionAndShowWindow() },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true
          app.quit()
        },
      },
    ])
  )
}

// IPC Handlers
ipcMain.handle('get-state', () => state)

ipcMain.handle('get-settings', () => ({
  apiUrl: store.get('apiUrl'),
  agentToken: getStoredToken(),
  printerName: store.get('printerName'),
  pollInterval: normalizePollInterval(store.get('pollInterval')),
  autoLaunch: Boolean(store.get('autoLaunch')),
}))

ipcMain.handle('save-settings', (_event, settings) => {
  if (settings.apiUrl !== undefined) {
    store.set('apiUrl', normalizeApiUrl(settings.apiUrl))
  }

  if (settings.agentToken !== undefined) {
    setStoredToken(settings.agentToken)
  }

  if (settings.printerName !== undefined) {
    store.set('printerName', String(settings.printerName || '').trim())
  }

  if (settings.pollInterval !== undefined) {
    store.set('pollInterval', normalizePollInterval(settings.pollInterval))
  }

  if (settings.autoLaunch !== undefined) {
    store.set('autoLaunch', Boolean(settings.autoLaunch))
    app.setLoginItemSettings({
      openAtLogin: Boolean(settings.autoLaunch),
      openAsHidden: true,
    })
  }

  startPolling()
  return true
})

ipcMain.handle('get-printers', () => listPrinters())

ipcMain.handle('test-print', async () => {
  const printerName = store.get('printerName')
  if (!printerName) throw new Error('No printer selected')

  const fs = require('fs')
  const os = require('os')
  const tmpFile = path.join(os.tmpdir(), 'shipwave-test.txt')
  fs.writeFileSync(tmpFile, 'ShipWave Print Agent — Test Print\n\nIf you can read this, printing is working!\n')

  await printLabel(tmpFile, printerName, 'txt')
  return true
})

ipcMain.handle('poll-now', async () => {
  await pollJobs()
  return true
})

ipcMain.handle('quit', () => {
  isQuitting = true
  app.quit()
})

app.on('before-quit', () => {
  isQuitting = true
})

app.whenReady().then(() => {
  createWindow()
  createTray()

  const autoLaunch = Boolean(store.get('autoLaunch'))
  app.setLoginItemSettings({ openAtLogin: autoLaunch, openAsHidden: true })

  if (getStoredToken()) {
    startPolling()
  }
})

app.on('activate', () => {
  if (!windowRef) {
    createWindow()
  }
  positionAndShowWindow()
})

app.on('window-all-closed', (e) => {
  e.preventDefault()
})
