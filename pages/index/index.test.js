const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const projectRoot = path.resolve(__dirname, '../..')
const configPath = path.join(projectRoot, '.openim-test-accounts.json')
const fixtureScriptPath = path.join(projectRoot, 'scripts/register-openim-test-accounts.mjs')
const runTimeoutMs = Number(process.env.OPENIM_AUTOMATION_TIMEOUT_MS || 20 * 60 * 1000)

jest.setTimeout(runTimeoutMs + 60 * 1000)

const artifactDir = path.join(projectRoot, 'test-results/openim-automation')

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
    if (isLoopbackHost(url.hostname) || (next.source === 'openim-test-fixture' && knownLocalHosts.has(url.hostname))) {
      next[key] = replaceURLHost(next[key], localLANIP)
    }
  }
  next.localLANIP = localLANIP
  return next
}

function readAutomationConfig() {
  if (!fs.existsSync(configPath)) {
    return null
  }
  return normalizeEndpointForDevice(JSON.parse(fs.readFileSync(configPath, 'utf8')))
}

function provisionAutomationConfig() {
  if (process.env.OPENIM_AUTOMATION_REUSE === '1' && fs.existsSync(configPath)) {
    return
  }
  execFileSync(process.execPath, [fixtureScriptPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      OUTPUT: configPath,
      STATIC_OUTPUT: 'false',
      PLATFORM_IDS: process.env.PLATFORM_IDS || '1,2',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60 * 1000,
  })
}

function withRunGuard(promise, label) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const heartbeat = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000)
      console.log(`[openim-test] ${label} still running (${elapsedSeconds}s)`)
    }, 15 * 1000)
    const timeout = setTimeout(() => {
      clearInterval(heartbeat)
      reject(new Error(`${label} exceeded hard timeout ${runTimeoutMs}ms`))
    }, runTimeoutMs)
    promise.then((value) => {
      clearInterval(heartbeat)
      clearTimeout(timeout)
      resolve(value)
    }, (error) => {
      clearInterval(heartbeat)
      clearTimeout(timeout)
      reject(error)
    })
  })
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
    provisionAutomationConfig()
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

    console.log('[openim-test] automator connected; starting OpenIM flow')
    const automationConfig = { ...config, autorun: 'false' }
    await program.callUniMethod('setStorageSync', 'openim-test-config', automationConfig)
    try {
      const page = await program.reLaunch('/pages/index/index')
      await page.waitFor(500)

      const baseName = createArtifactBaseName()
      const summary = await withRunGuard(page.callMethod('handleRunAutomation'), 'OpenIM automation')
      const artifacts = writeAutomationArtifacts(baseName, summary)
      await writeAutomationScreenshot(baseName)

      if (typeof summary === 'string') {
        expect(summary).toContain('Automation passed')
        return
      }

      expect(summary).toBeTruthy()
      if (summary.failed !== 0) {
        const failures = Array.isArray(summary.cases)
          ? summary.cases
            .filter((item) => item && item.ok === false && item.skipped !== true)
            .map((item) => `${item.group || item.suite}/${item.name}: ${item.message || item.detail || 'no detail'}`)
          : []
        throw new Error(`OpenIM automation reported ${summary.failed} failure(s): ${failures.join('; ') || 'no case details'}; artifacts: ${artifacts.jsonPath}, ${artifacts.logPath}`)
      }
      expect(summary.failed).toBe(0)
      expect(summary.passed).toBeGreaterThan(0)
      expect(summary.coverageMissing).toEqual([])
      expect(summary.unexpectedSkipped).toEqual([])
      expect(summary.validatedUnexpectedMissing).toEqual([])
      expect(Array.isArray(summary.groups)).toBe(true)
      expect(Array.isArray(summary.cases)).toBe(true)
      expect(summary.logFilePath || artifacts.logPath).toBeTruthy()
      expect(String(summary.headline || summary.summaryText)).toContain('Automation passed')
    } finally {
      await program.callUniMethod('removeStorageSync', 'openim-test-config')
    }
  })
})
