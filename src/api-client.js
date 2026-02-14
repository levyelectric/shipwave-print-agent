const REQUEST_TIMEOUT_MS = 20000

function parseBody(res) {
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return res.json().catch(() => null)
  }
  return res.text().catch(() => '')
}

function createApiError(message, status, body) {
  const err = new Error(message)
  err.status = status
  if (body && typeof body === 'object') {
    err.errorCode = body.errorCode
    err.currentStatus = body.currentStatus
  }
  err.body = body
  return err
}

function getBaseUrl(apiUrl) {
  const raw = String(apiUrl || '').trim()
  if (!raw) {
    throw new Error('No API URL configured')
  }
  return raw.replace(/\/+$/, '')
}

async function requestJson(config, path, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(`${getBaseUrl(config.apiUrl)}${path}`, {
      ...options,
      signal: controller.signal,
    })

    const body = await parseBody(res)
    if (!res.ok) {
      const detail = typeof body === 'object' && body && body.error
        ? body.error
        : typeof body === 'string' && body
          ? body
          : 'Request failed'
      throw createApiError(`API error ${res.status}: ${detail}`, res.status, body)
    }

    if (typeof body === 'object' && body !== null) {
      return body
    }

    throw new Error('API response was not JSON')
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('API request timed out')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function ensureToken(config) {
  const token = String(config?.token || '').trim()
  if (!token) throw new Error('No agent token configured')
  return token
}

async function fetchPendingJobs(config) {
  const token = ensureToken(config)
  return requestJson(config, '/api/agent/jobs', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

async function updateJobStatus(config, jobId, status, errorMessage) {
  const token = ensureToken(config)

  const body = { status }
  if (errorMessage) body.errorMessage = errorMessage

  return requestJson(config, `/api/agent/jobs/${jobId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

module.exports = { fetchPendingJobs, updateJobStatus }
