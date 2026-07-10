const fs = require('fs')
const os = require('os')
const path = require('path')

jest.setTimeout(30 * 60 * 1000)

const artifactDir = path.resolve(__dirname, '../../test-results/openim-automation')

function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '::1'
}

function isPrivateIPv4(address) {
  if (address.startsWith('10.')) {
    return true
  }
  if (address.startsWith('192.168.')) {
    return true
  }
  const parts = address.split('.').map((part) => Number(part))
  return parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31
}

function getLocalLANIP() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const item of entries || []) {
      if (item.family === 'IPv4' && !item.internal && isPrivateIPv4(item.address)) {
        return item.address
      }
    }
  }
  return ''
}

function replaceURLHost(value, host) {
  if (typeof value !== 'string' || value.length === 0 || host.length === 0) {
    return value
  }
  const url = new URL(value)
  url.hostname = host
  return url.toString().replace(/\/+$/, '')
}

function normalizeEndpointForDevice(config) {
  const localLANIP = getLocalLANIP()
  if (localLANIP.length === 0) {
    return config
  }

  const next = { ...config }
  const knownLocalHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', config.localLANIP])
  for (const key of ['apiAddr', 'wsAddr']) {
    if (typeof next[key] !== 'string' || next[key].length === 0) {
      continue
    }
    const url = new URL(next[key])
    if (isLoopbackHost(url.hostname) || (next.source === 'register-openim-test-accounts' && knownLocalHosts.has(url.hostname))) {
      next[key] = replaceURLHost(next[key], localLANIP)
    }
  }
  next.localLANIP = localLANIP
  return next
}

function readAutomationConfig() {
  const filePath = path.resolve(__dirname, '../../.openim-test-accounts.json')
  if (!fs.existsSync(filePath)) {
    return null
  }
  return normalizeEndpointForDevice(JSON.parse(fs.readFileSync(filePath, 'utf8')))
}

function ensureArtifactDir() {
  fs.mkdirSync(artifactDir, { recursive: true })
}

function createArtifactBaseName() {
  return `openim-automation-${new Date().toISOString().replace(/[:.]/g, '-')}`
}

function writeAutomationArtifacts(baseName, summary) {
  ensureArtifactDir()
  const jsonPath = path.join(artifactDir, `${baseName}.json`)
  const logPath = path.join(artifactDir, `${baseName}.log`)
  const logText = summary && typeof summary.summaryText === 'string'
    ? summary.summaryText
    : JSON.stringify(summary, null, 2)
  fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`)
  fs.writeFileSync(logPath, `${logText}\n`)
  return { jsonPath, logPath }
}

async function writeAutomationScreenshot(baseName) {
  try {
    ensureArtifactDir()
    await program.screenshot({
      path: path.relative(path.resolve(__dirname, '../..'), path.join(artifactDir, `${baseName}.png`)),
    })
  } catch (error) {
    console.warn(`Skipping automation screenshot: ${error && error.message ? error.message : error}`)
  }
}

describe('OpenIM SDK demo automation', () => {
  it('runs the index page API smoke flow when local accounts are configured', async () => {
    const config = readAutomationConfig()
    if (config == null) {
      const summary = {
        headline: 'Automation skipped',
        summaryText: 'Automation skipped: .openim-test-accounts.json is missing.',
        total: 1,
        passed: 0,
        failed: 0,
        skipped: 1,
        groups: ['setup'],
        cases: [{
          group: 'setup',
          name: 'read config',
          status: 'skipped',
          message: '.openim-test-accounts.json is missing.',
          durationMs: 0,
        }],
        logFilePath: '',
      }
      const baseName = createArtifactBaseName()
      writeAutomationArtifacts(baseName, summary)
      if (process.env.OPENIM_AUTOMATION_SKIP === '1') {
        console.warn('Skipping OpenIM API smoke flow: .openim-test-accounts.json is missing.')
        return
      }
      throw new Error('Missing .openim-test-accounts.json. Run scripts/register-openim-test-accounts.mjs first, or set OPENIM_AUTOMATION_SKIP=1 to skip explicitly.')
    }

    await program.reLaunch('/pages/index/index')
    const page = await program.currentPage()
    await program.callUniMethod('setStorageSync', 'openim-test-config', config)

    const baseName = createArtifactBaseName()
    const summary = await page.callMethod('handleRunAutomation')
    const artifacts = writeAutomationArtifacts(baseName, summary)
    await writeAutomationScreenshot(baseName)

    if (typeof summary === 'string') {
      expect(summary).toContain('Automation passed')
      return
    }

    expect(summary).toBeTruthy()
    expect(summary.failed).toBe(0)
    expect(summary.passed).toBeGreaterThan(0)
    expect(summary.coverageMissing).toEqual([])
    expect(summary.unexpectedSkipped).toEqual([])
    expect(summary.validatedUnexpectedMissing).toEqual([])
    expect(Array.isArray(summary.groups)).toBe(true)
    expect(Array.isArray(summary.cases)).toBe(true)
    expect(summary.logFilePath || artifacts.logPath).toBeTruthy()
    expect(String(summary.headline || summary.summaryText)).toContain('Automation passed')
  })
})
