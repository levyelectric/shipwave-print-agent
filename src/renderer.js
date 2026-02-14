// Tab switching
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'))
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'))
    tab.classList.add('active')
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active')
  })
})

// State updates
const statusDot = document.getElementById('statusDot')
const connStatus = document.getElementById('connStatus')
const queueSize = document.getElementById('queueSize')
const lastCheck = document.getElementById('lastCheck')
const printerDisplay = document.getElementById('printerDisplay')
const errorRow = document.getElementById('errorRow')
const errorMsg = document.getElementById('errorMsg')
const jobsList = document.getElementById('jobsList')
const actionMsg = document.getElementById('actionMsg')

let actionMsgTimer = null

function showActionMessage(message, isError = false) {
  if (!actionMsg) return
  actionMsg.textContent = message || ''
  actionMsg.className = isError ? 'action-msg error' : 'action-msg'
  if (actionMsgTimer) clearTimeout(actionMsgTimer)
  actionMsgTimer = setTimeout(() => {
    actionMsg.textContent = ''
    actionMsg.className = 'action-msg'
  }, 2500)
}

function renderRecentJobs(jobs) {
  jobsList.replaceChildren()

  if (!jobs?.length) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = 'No recent print jobs'
    jobsList.appendChild(empty)
    return
  }

  jobs.slice(0, 10).forEach((job) => {
    const item = document.createElement('div')
    item.className = 'job-item'

    const left = document.createElement('div')
    const tracking = document.createElement('div')
    tracking.className = 'job-tracking'
    tracking.textContent = String(job.trackingCode || job.orderNumber || String(job.id || '').slice(0, 8))

    const time = document.createElement('div')
    time.className = 'job-time'
    time.textContent = new Date(job.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    left.appendChild(tracking)
    left.appendChild(time)

    const status = String(job.status || 'unknown')
    const badge = document.createElement('span')
    badge.className = `badge ${status === 'completed' || status === 'failed' ? status : 'pending'}`
    badge.textContent = status

    item.appendChild(left)
    item.appendChild(badge)
    jobsList.appendChild(item)
  })
}

function updateUI(state) {
  // Status dot
  statusDot.className = 'dot'
  if (state.polling) {
    statusDot.classList.add('yellow')
  } else if (state.connected) {
    statusDot.classList.add('green')
  } else {
    statusDot.classList.add('red')
  }

  // Connection
  connStatus.textContent = state.connected ? 'Connected' : 'Disconnected'

  // Queue
  queueSize.textContent = `${state.queueSize} job${state.queueSize !== 1 ? 's' : ''}`

  // Last check
  if (state.lastCheck) {
    const d = new Date(state.lastCheck)
    lastCheck.textContent = d.toLocaleTimeString()
  }

  // Error
  if (state.error) {
    errorRow.style.display = 'flex'
    errorMsg.textContent = state.error
  } else {
    errorRow.style.display = 'none'
  }

  // Recent jobs
  renderRecentJobs(state.recentJobs)
}

window.agent.onStateUpdate(updateUI)

// Load initial state
async function init() {
  try {
    const state = await window.agent.getState()
    updateUI(state)

    // Load settings
    const settings = await window.agent.getSettings()
    document.getElementById('apiUrl').value = settings.apiUrl || ''
    document.getElementById('agentToken').value = settings.agentToken || ''
    document.getElementById('pollInterval').value = settings.pollInterval || 30
    document.getElementById('autoLaunch').checked = settings.autoLaunch || false
    printerDisplay.textContent = settings.printerName || 'Not set'

    // Load printers
    const printers = await window.agent.getPrinters()
    const select = document.getElementById('printerSelect')
    select.replaceChildren()
    const placeholder = document.createElement('option')
    placeholder.value = ''
    placeholder.textContent = 'Select a printer...'
    select.appendChild(placeholder)

    printers.forEach((name) => {
      const opt = document.createElement('option')
      opt.value = name
      opt.textContent = name
      if (name === settings.printerName) opt.selected = true
      select.appendChild(opt)
    })
  } catch (error) {
    showActionMessage(error.message || 'Failed to load app state', true)
  }
}

init()

// Save settings
document.getElementById('saveBtn').addEventListener('click', async () => {
  const btn = document.getElementById('saveBtn')
  btn.textContent = 'Saving...'
  btn.disabled = true

  try {
    await window.agent.saveSettings({
      apiUrl: document.getElementById('apiUrl').value.trim(),
      agentToken: document.getElementById('agentToken').value.trim(),
      printerName: document.getElementById('printerSelect').value,
      pollInterval: parseInt(document.getElementById('pollInterval').value, 10) || 30,
      autoLaunch: document.getElementById('autoLaunch').checked,
    })
    printerDisplay.textContent = document.getElementById('printerSelect').value || 'Not set'
    btn.textContent = 'Saved!'
    showActionMessage('Settings saved')
  } catch (error) {
    btn.textContent = 'Save Failed'
    showActionMessage(error.message || 'Failed to save settings', true)
  } finally {
    setTimeout(() => {
      btn.textContent = 'Save Settings'
      btn.disabled = false
    }, 1500)
  }
})

// Actions
document.getElementById('pollNowBtn').addEventListener('click', async () => {
  const btn = document.getElementById('pollNowBtn')
  btn.textContent = 'Checking...'
  btn.disabled = true
  try {
    await window.agent.pollNow()
    showActionMessage('Queue check complete')
  } catch (error) {
    showActionMessage(error.message || 'Queue check failed', true)
  } finally {
    btn.textContent = 'Check Now'
    btn.disabled = false
  }
})

document.getElementById('testPrintBtn').addEventListener('click', async () => {
  const btn = document.getElementById('testPrintBtn')
  btn.textContent = 'Printing...'
  btn.disabled = true
  try {
    await window.agent.testPrint()
    btn.textContent = 'Sent!'
    showActionMessage('Test print sent')
  } catch (e) {
    btn.textContent = 'Failed'
    showActionMessage(e.message || 'Test print failed', true)
  }
  setTimeout(() => {
    btn.textContent = 'Test Print'
    btn.disabled = false
  }, 1500)
})

document.getElementById('quitBtn').addEventListener('click', () => {
  window.agent.quit()
})
