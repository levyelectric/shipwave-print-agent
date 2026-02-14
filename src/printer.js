const { execSync, spawn } = require('child_process')
const { randomBytes } = require('crypto')
const fs = require('fs')
const path = require('path')
const os = require('os')

function listPrinters() {
  try {
    const output = execSync('lpstat -a 2>/dev/null', { encoding: 'utf-8' })
    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const name = line.split(' ')[0]
        return name
      })
  } catch {
    return []
  }
}

function getDefaultPrinter() {
  try {
    const output = execSync('lpstat -d 2>/dev/null', { encoding: 'utf-8' })
    const match = output.match(/:\s*(.+)/)
    return match ? match[1].trim() : null
  } catch {
    return null
  }
}

async function downloadLabel(url) {
  let parsedUrl
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error('Label URL is invalid')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)

  const res = await fetch(parsedUrl.toString(), { signal: controller.signal })
    .finally(() => clearTimeout(timeout))
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)

  const buffer = Buffer.from(await res.arrayBuffer())
  const contentType = (res.headers.get('content-type') || '').toLowerCase()
  const lowerPath = parsedUrl.pathname.toLowerCase()
  let ext = '.bin'
  if (lowerPath.includes('.zpl') || contentType.includes('zpl')) ext = '.zpl'
  else if (lowerPath.includes('.epl') || contentType.includes('epl')) ext = '.epl'
  else if (lowerPath.includes('.png') || contentType.includes('png')) ext = '.png'
  else if (lowerPath.includes('.pdf') || contentType.includes('pdf')) ext = '.pdf'

  const tmpFile = path.join(
    os.tmpdir(),
    `shipwave-label-${Date.now()}-${randomBytes(4).toString('hex')}${ext}`
  )
  fs.writeFileSync(tmpFile, buffer)
  return tmpFile
}

function printLabel(filePath, printerName, labelFormat) {
  return new Promise((resolve, reject) => {
    if (!printerName) {
      reject(new Error('No printer configured'))
      return
    }

    const ext = path.extname(filePath).toLowerCase()
    const isRaw = ext === '.zpl' || ext === '.epl' || labelFormat === 'zpl' || labelFormat === 'epl2'

    const args = ['-d', printerName, '-o', isRaw ? 'raw' : 'fit-to-page', filePath]
    const child = spawn('lp', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (err) => {
      // Clean up temp file
      try { fs.unlinkSync(filePath) } catch {}
      reject(new Error(`Print failed: ${err.message}`))
    })

    child.on('close', (code) => {
      // Clean up temp file
      try { fs.unlinkSync(filePath) } catch {}

      if (code !== 0) {
        reject(new Error(`Print failed: ${stderr || stdout || `lp exited with code ${code}`}`))
      } else {
        resolve(stdout.trim())
      }
    })
  })
}

module.exports = { listPrinters, getDefaultPrinter, downloadLabel, printLabel }
