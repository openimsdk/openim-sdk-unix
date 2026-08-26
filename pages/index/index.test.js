const fs = require('fs')
const os = require('os')
const path = require('path')
const readline = require('readline')
const { execFileSync, spawn } = require('child_process')
const { randomUUID } = require('crypto')
const { formatAutomationEvidenceIssues, validateAutomationEvidence } = require('../../tooling/runtime/automation-evidence.cjs')

const projectRoot = path.resolve(__dirname, '../..')
const configPath = path.join(projectRoot, '.openim-test-accounts.json')
const fixtureScriptPath = path.join(projectRoot, 'scripts/register-openim-test-accounts.mjs')
const testDispositionPath = path.join(projectRoot, 'contracts/base/test-disposition.json')
const responseSchemasPath = path.join(projectRoot, 'contracts/base/response-schemas.json')
const runTimeoutMs = Number(process.env.OPENIM_AUTOMATION_TIMEOUT_MS || 20 * 60 * 1000)

jest.setTimeout(runTimeoutMs + 60 * 1000)

const artifactDir = path.join(projectRoot, 'test-results/openim-automation')

function readPublicPeerPlatformID() {
  const uniOSName = String(process.env.UNI_OS_NAME || '').toLowerCase()
  const fallback = uniOSName === 'ios' ? 2 : 1
  const value = Number(process.env.OPENIM_AUTOMATION_PEER_PLATFORM_ID || fallback)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('OPENIM_AUTOMATION_PEER_PLATFORM_ID must be a positive integer')
  }
  return value
}

function readPublicPeerToken(config, accountName, platformID) {
  const token = String(config?.accounts?.[accountName]?.imTokens?.[String(platformID)] || '')
  if (token.length === 0) {
    throw new Error(`Public automation fixture lacks ${accountName} token for peer platform ${platformID}`)
  }
  return token
}

function buildPublicPeer(tempRoot, configuredCoreRoot) {
  const sourceRoot = path.join(projectRoot, 'tooling/public-peer')
  const coreRoot = path.resolve(String(configuredCoreRoot || ''))
  if (!path.isAbsolute(coreRoot) || !fs.existsSync(path.join(coreRoot, 'go.mod'))) {
    throw new Error('Public peer requires an exact OPENIM_PUBLIC_CORE_DIR authority')
  }
  const status = execFileSync('git', ['-C', coreRoot, 'status', '--porcelain'], { encoding: 'utf8' })
  if (status.trim().length > 0) {
    throw new Error('Public peer Core authority must be clean')
  }
  const buildRoot = path.join(tempRoot, 'build')
  fs.mkdirSync(buildRoot, { recursive: true, mode: 0o700 })
  for (const name of ['go.mod', 'go.sum', 'main.go', 'peer.go', 'protocol.go']) {
    fs.copyFileSync(path.join(sourceRoot, name), path.join(buildRoot, name))
  }
  const goBinary = process.env.GO_BINARY || 'go'
  const runGo = (args, timeout) => execFileSync(goBinary, args, {
    cwd: buildRoot,
    env: { ...process.env, GOTELEMETRY: 'off', GOWORK: 'off' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  })
  runGo(['mod', 'edit', `-replace=github.com/openimsdk/openim-sdk-core/v3=${coreRoot}`], 30 * 1000)
  runGo(['mod', 'verify'], 5 * 60 * 1000)
  runGo(['test', '-mod=readonly', './...'], 5 * 60 * 1000)
  const binaryPath = path.join(tempRoot, 'public-peer')
  runGo(['build', '-trimpath', '-mod=readonly', '-o', binaryPath, '.'], 5 * 60 * 1000)
  fs.chmodSync(binaryPath, 0o700)
  return binaryPath
}

function createPublicPeerClient(binaryPath, name, loginPayload) {
  const child = spawn(binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  const output = readline.createInterface({ input: child.stdout })
  const pending = new Map()
  let sequence = 0
  let exited = false
  output.on('line', (line) => {
    let response
    try { response = JSON.parse(line) } catch { return }
    const id = String(response.id || '')
    const entry = pending.get(id)
    if (entry == null) return
    pending.delete(id)
    clearTimeout(entry.timer)
    if (response.ok === true) entry.resolve(response.result || {})
    else {
      const safeCode = /^[a-z_]+$/.test(String(response.error?.code || '')) ? response.error.code : 'command_failed'
      entry.reject(new Error(`public peer ${name} command failed (${safeCode})`))
    }
  })
  child.on('exit', () => {
    exited = true
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error(`public peer ${name} exited`))
    }
    pending.clear()
  })
  function request(command, payload = {}, timeoutMs = 75 * 1000) {
    if (exited) return Promise.reject(new Error(`public peer ${name} is not running`))
    sequence += 1
    const id = `${name}-${sequence}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`public peer ${name} command timed out`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, command, payload })}\n`)
    })
  }
  return {
    request,
    login: () => request('login', loginPayload),
    shutdown: async () => {
      if (!exited) {
        try { await request('shutdown', {}, 10 * 1000) } catch {}
      }
      if (!exited) child.kill('SIGTERM')
    },
  }
}

async function startPublicPeerBridge(config) {
  const tempRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'openim-public-peer-'))
  fs.chmodSync(tempRoot, 0o700)
  const binaryPath = buildPublicPeer(tempRoot, config._publicPeerCoreRoot)
  const platformID = readPublicPeerPlatformID()
  const makePayload = (accountName) => ({
    apiAddr: config.apiAddr,
    wsAddr: config.wsAddr,
    userID: config[`${accountName}UserID`],
    token: readPublicPeerToken(config, accountName, platformID),
    platform: platformID,
    dataDir: path.join(tempRoot, `${accountName}-data`),
    logFilePath: path.join(tempRoot, `${accountName}-logs`),
    operationID: `public_peer_${accountName}_login`,
    syncTimeoutMs: 60 * 1000,
  })
  const primary = createPublicPeerClient(binaryPath, 'primary', makePayload('primary'))
  const secondary = createPublicPeerClient(binaryPath, 'secondary', makePayload('secondary'))
  try {
    await Promise.all([primary.login(), secondary.login()])
  } catch (error) {
    await Promise.allSettled([primary.shutdown(), secondary.shutdown()])
    fs.rmSync(tempRoot, { recursive: true, force: true })
    throw error
  }
  let stopped = false
  return {
    pageConfig: {
      peerBridgeEnabled: true,
      peerBridgeRunNonce: randomUUID().replace(/-/g, ''),
    },
    async run(page, runNonce) {
      let lastRequestID = ''
      while (!stopped) {
        const raw = await page.callMethod('handleAutomationPeerBridgeReadRequest', runNonce)
        if (typeof raw === 'string' && raw.length > 0) {
          const request = JSON.parse(raw)
          const requestID = String(request.id || '')
          if (requestID.length > 0 && requestID !== lastRequestID) {
            const payload = request.payload && typeof request.payload === 'object' ? { ...request.payload } : {}
            const target = payload.target === 'primary' ? primary : secondary
            delete payload.target
            let response
            try {
              const result = await target.request(request.command, payload, Number(payload.timeoutMs || 60 * 1000) + 5000)
              response = { kind: 'response', id: requestID, ok: true, result }
            } catch {
              response = { kind: 'response', id: requestID, ok: false, error: { code: 'command_failed', message: 'public peer command failed' } }
            }
            await page.callMethod('handleAutomationPeerBridgeWriteResponse', JSON.stringify(response))
            lastRequestID = requestID
          }
        }
        if (!stopped) await new Promise((resolve) => setTimeout(resolve, 100))
      }
    },
    async stop() {
      stopped = true
      await Promise.allSettled([primary.shutdown(), secondary.shutdown()])
      fs.rmSync(tempRoot, { recursive: true, force: true })
    },
  }
}

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
  if (fs.existsSync(configPath)) {
    const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    if (Object.prototype.hasOwnProperty.call(existing, 'suiteFilter') || process.env.OPENIM_AUTOMATION_REUSE === '1') {
      return
    }
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

function validateReportAgainstContract(summary, fullRun) {
  const uniOSName = String(process.env.UNI_OS_NAME || '').toLowerCase()
  const platform = uniOSName === 'ios' ? 'ios' : 'android'
  const manifest = JSON.parse(fs.readFileSync(testDispositionPath, 'utf8'))
  const responseSchemas = JSON.parse(fs.readFileSync(responseSchemasPath, 'utf8'))
  return validateAutomationEvidence({ manifest, responseSchemas, report: summary, platform, fullRun })
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
    const requestedSuiteFilter = String(config.suiteFilter || '').trim()
    const peerBridge = await startPublicPeerBridge(config)
    const pageConfigBase = { ...config }
    delete pageConfigBase._publicPeerCoreRoot
    const automationConfig = {
      ...pageConfigBase,
      ...peerBridge.pageConfig,
      autorun: 'false',
      suiteFilter: requestedSuiteFilter,
    }
    await program.callUniMethod('setStorageSync', 'openim-test-config', automationConfig)
    let peerRunPromise = null
    try {
      const page = await program.reLaunch('/pages/index/index')
      await page.waitFor(500)

      const baseName = createArtifactBaseName()
      const pageRunPromise = withRunGuard(page.callMethod('handleRunAutomation'), 'OpenIM automation')
      peerRunPromise = peerBridge.run(page, peerBridge.pageConfig.peerBridgeRunNonce)
      const summary = await pageRunPromise
      if (typeof summary === 'string') {
        throw new Error('OpenIM automation returned legacy text without per-axis contract evidence')
      }

      expect(summary).toBeTruthy()
      summary.contractEvidence = validateReportAgainstContract(summary, requestedSuiteFilter.length === 0)
      const artifacts = writeAutomationArtifacts(baseName, summary)
      await writeAutomationScreenshot(baseName)
      if (summary.failed !== 0) {
        const failures = Array.isArray(summary.cases)
          ? summary.cases
            .filter((item) => item && item.status === 'failed')
            .map((item) => `${item.group || item.suite}/${item.name}: ${item.message || item.detail || 'no detail'}`)
          : []
        throw new Error(`OpenIM automation reported ${summary.failed} failure(s): ${failures.join('; ') || 'no case details'}; artifacts: ${artifacts.jsonPath}, ${artifacts.logPath}`)
      }
      if (requestedSuiteFilter.length === 0 && !summary.contractEvidence.passed) {
        throw new Error(`OpenIM automation contract evidence failed: ${formatAutomationEvidenceIssues(summary.contractEvidence)}; artifacts: ${artifacts.jsonPath}, ${artifacts.logPath}`)
      }
      expect(summary.failed).toBe(0)
      if (requestedSuiteFilter.length === 0) {
        expect(summary.contractEvidence.passed).toBe(true)
      } else {
        expect(summary.contractEvidence.checkedCallables).toBeGreaterThan(0)
      }
      expect(summary.passed).toBeGreaterThan(0)
      expect(summary.coverageMissing).toEqual([])
      expect(summary.unexpectedSkipped).toEqual([])
      expect(summary.validatedUnexpectedMissing).toEqual([])
      expect(Array.isArray(summary.groups)).toBe(true)
      expect(Array.isArray(summary.cases)).toBe(true)
      expect(summary.logFilePath || artifacts.logPath).toBeTruthy()
      expect(String(summary.headline || summary.summaryText)).toContain('Automation passed')
    } finally {
      await peerBridge.stop()
      if (peerRunPromise != null) await peerRunPromise
      await program.callUniMethod('removeStorageSync', 'openim-test-config')
    }
  })
})
