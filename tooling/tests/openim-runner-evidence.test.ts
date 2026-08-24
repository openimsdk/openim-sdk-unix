import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'

const modulePath = new URL('../../scripts/lib/openim-runner-evidence.mjs', import.meta.url)
const lockModulePath = new URL('../../scripts/lib/automation-runner-lock.mjs', import.meta.url)
const runnerPath = new URL('../../scripts/run-openim-automation.mjs', import.meta.url)
const provenanceModulePath = new URL('../runtime/automation-run-provenance.cjs', import.meta.url)
const manifestModulePath = new URL('../../scripts/lib/automation-run-manifest.mjs', import.meta.url)

test('Public runner makes contract evidence part of the process success gate', () => {
  const source = readFileSync(runnerPath, 'utf8')
  assert.match(source, /writeLatestAutomationEvidence\(\{/)
  assert.match(source, /startedAtMs: runStartedAtMs/)
  assert.match(source, /runtime: \{/)
  assert.match(source, /target,/)
  assert.match(source, /deviceID,/)
  assert.match(source, /!evidence\.contractEvidence\.passed/)
  assert.match(source, /readPublicCoreAuthority/)
  assert.match(source, /readHBuilderToolchainAuthority/)
  assert.match(source, /nativeArtifactSha256/)
  assert.match(source, /runManifestPath/)
  assert.match(source, /writeAutomationRunManifestSet/)
  assert.match(source, /runManifest\.result = \{[\s\S]*finalizationComplete:/)
  assert.match(source, /runManifest,/)
  assert.match(source, /runManifestPath:/)
  assert.match(source, /passed && evidenceFailure\.length === 0/)
  assert.match(source, /runUnderAutomationRunnerLock\(\{ projectRoot \}\)/)
  assert.match(source, /restoreJestConfig/)
  assert.match(source, /process\.on\('exit',[\s\S]*restoreJestConfig\(\)/)
  assert.ok(source.indexOf('runUnderAutomationRunnerLock({ projectRoot })') < source.indexOf('assertManifestWebSocket();'))
})

test('run manifests finalize once and latest remains a navigation pointer', async () => {
  const { writeAutomationRunManifestSet } = await import(manifestModulePath.href)
  const root = projectRoot()
  const perRunPath = resolve(root, 'test-results/openim-automation/android-fixture-manifest.json')
  const latestPath = resolve(root, 'test-results/openim-automation/android-latest-manifest.json')
  const running = { schemaVersion: 1, runId: 'fixture', platform: 'android', result: { status: 'running', finalizationComplete: false } }
  writeAutomationRunManifestSet({ perRunPath, latestPath, manifest: running })
  const finished = { ...running, result: { status: 'passed', finalizationComplete: true } }
  writeAutomationRunManifestSet({ perRunPath, latestPath, manifest: finished })

  const latest = JSON.parse(readFileSync(latestPath, 'utf8'))
  assert.equal(latest.navigationOnly, true)
  assert.equal(latest.runId, 'fixture')
  assert.equal(Object.hasOwn(latest, 'result'), false)
  assert.throws(
    () => writeAutomationRunManifestSet({ perRunPath, latestPath, manifest: { ...finished, finishedAt: 'changed' } }),
    /immutable finalized run manifest/,
  )
})

test('Public runner delegates once through a kept non-blocking macOS lockf lock', async () => {
  const { automationRunnerLockPath, runUnderAutomationRunnerLock } = await import(lockModulePath.href)
  const root = projectRoot()
  const calls: Array<{ command: string, args: string[], options: Record<string, unknown> }> = []
  const status = runUnderAutomationRunnerLock({
    projectRoot: root,
    argv: ['/node', '/project/scripts/run-openim-automation.mjs', 'android', '--device-id', 'device-1'],
    env: { SAFE_VALUE: 'kept' },
    execPath: '/node',
    osPlatform: 'darwin',
    lockfPath: '/usr/bin/lockf',
    spawnSyncImpl: (command: string, args: string[], options: Record<string, unknown>) => {
      calls.push({ command, args, options })
      return { status: 0, signal: null }
    },
  })
  const lockPath = automationRunnerLockPath(root)
  const [call] = calls

  assert.equal(status, 0)
  assert.equal(calls.length, 1)
  assert.ok(call)
  assert.equal(call.command, '/usr/bin/lockf')
  assert.deepEqual(call.args, [
    '-k', '-t', '0', lockPath, '/node',
    '/project/scripts/run-openim-automation.mjs', 'android', '--device-id', 'device-1',
  ])
  assert.deepEqual(call.options, {
    cwd: root,
    env: { SAFE_VALUE: 'kept', OPENIM_AUTOMATION_RUNNER_LOCK_PATH: lockPath },
    stdio: 'inherit',
  })
})

test('Public runner executes inside lockf without recursively delegating', async () => {
  const { automationRunnerLockPath, runUnderAutomationRunnerLock } = await import(lockModulePath.href)
  const root = projectRoot()
  const lockPath = automationRunnerLockPath(root)
  let spawned = false

  const status = runUnderAutomationRunnerLock({
    projectRoot: root,
    env: { OPENIM_AUTOMATION_RUNNER_LOCK_PATH: lockPath },
    spawnSyncImpl: () => {
      spawned = true
      return { status: 0, signal: null }
    },
  })

  assert.equal(status, null)
  assert.equal(spawned, false)
})

test('Public runner reports lockf contention without entering the runner', async () => {
  const { runUnderAutomationRunnerLock } = await import(lockModulePath.href)
  const root = projectRoot()

  assert.throws(
    () => runUnderAutomationRunnerLock({
      projectRoot: root,
      osPlatform: 'darwin',
      lockfPath: '/usr/bin/lockf',
      spawnSyncImpl: () => ({ status: 75, signal: null }),
    }),
    /another automation runner holds the project lock/,
  )
})

function manifest() {
  return {
    schemaVersion: 2,
    edition: 'public',
    counts: { callables: 1, events: 0 },
    callables: [{
      caseId: 'api/getLoginStatus',
      apiName: 'getLoginStatus',
      platforms: { android: 'required', ios: 'required' },
      semanticProfile: 'lifecycle-state',
      sideEffectProbe: 'none',
      validationAxes: ['completion', 'structure', 'semantic'],
    }],
    events: [],
  }
}

function projectRoot() {
  const root = mkdtempSync(resolve(tmpdir(), 'openim-public-evidence-'))
  mkdirSync(resolve(root, 'contracts/base'), { recursive: true })
  mkdirSync(resolve(root, 'test-results/openim-automation'), { recursive: true })
  writeFileSync(resolve(root, 'contracts/base/test-disposition.json'), JSON.stringify(manifest()))
  writeFileSync(resolve(root, 'contracts/base/response-schemas.json'), JSON.stringify({
    schemaVersion: 1,
    edition: 'public',
    schemas: {},
    callables: { getLoginStatus: { codec: 'number', schema: { kind: 'number' } } },
    events: {},
  }))
  return root
}

function runManifest(platform = 'android', runId = 'fixture-run') {
  return {
    schemaVersion: 1,
    runId,
    platform,
    vapor: true,
    sdk: { head: 'a'.repeat(40), dirty: false },
    core: { head: 'b'.repeat(40), dirty: false },
    customBase: {
      sha256: 'c'.repeat(64),
      nativeArtifactKind: platform === 'ios' ? 'xcframework-inventory' : 'aar',
      nativeArtifactSha256: 'd'.repeat(64),
    },
    hbuilderx: { version: '5.23-test', cliSha256: 'e'.repeat(64) },
    runtime: {
      target: platform === 'ios' ? 'app-ios-simulator' : 'app-android',
      deviceID: 'fixture-device',
      deviceKind: platform === 'ios' ? 'simulator' : 'emulator',
      osVersion: '1',
      architecture: 'arm64',
      buildConfiguration: 'Debug',
    },
    series: { id: 'fixture-series', sequence: 1, total: 1 },
    result: { status: 'running', finalizationComplete: false },
  }
}

test('release provenance is deterministic and binds native artifacts and runtime identity', async () => {
  const { buildAutomationRunProvenance } = await import(provenanceModulePath.href)
  const manifest = runManifest()
  const first = buildAutomationRunProvenance(manifest)
  const second = buildAutomationRunProvenance({ ...manifest })
  const changed = buildAutomationRunProvenance({
    ...manifest,
    runtime: { ...manifest.runtime, buildConfiguration: 'Release' },
  })

  assert.equal(first.sha256, second.sha256)
  assert.notEqual(first.sha256, changed.sha256)
  assert.equal(first.data.artifact.nativeArtifactSha256, 'd'.repeat(64))
  assert.equal(first.data.runtime.deviceID, 'fixture-device')
})

test('Public runner evidence reads base authority and keeps response structure schema-authoritative', async () => {
  const { writeLatestAutomationEvidence } = await import(modulePath.href)
  const root = projectRoot()
  const report = {
    headline: 'Automation passed', total: 1, passed: 1, failed: 0, skipped: 0,
    cases: [{
      apiName: 'getLoginStatus', status: 'passed', invoked: true, resolved: true,
      responseEvidence: true, responseEncoding: 'uts-typed-json-v1', responseDetail: '3',
      structureValidated: true, semanticValidated: true,
      assertions: [{ axis: 'semantic', profile: 'lifecycle-state', rule: 'login-status-is-logged', expected: '3', actual: '3', ok: true }],
    }],
    events: [],
  }
  const reportPath = resolve(root, 'test-results/openim-automation/openim-automation-new.json')
  writeFileSync(reportPath, JSON.stringify(report))

  const { evidence, evidencePath } = writeLatestAutomationEvidence({
    projectRoot: root,
    platform: 'android',
    repositoryOverride: { revision: 'a'.repeat(40), dirty: false },
    runtime: {
      target: 'app-android', deviceID: 'emulator-1', deviceKind: 'emulator',
      osVersion: '16', architecture: 'x86_64', buildConfiguration: 'Debug',
    },
    series: { id: 'fixture-series', sequence: 1, total: 1 },
    runId: 'fixture-run',
    runManifest: runManifest('android', 'fixture-run'),
    runManifestPath: 'test-results/openim-automation/android-fixture-run-manifest.json',
  })
  assert.equal(evidence.contractEvidence.passed, true)
  const persisted = JSON.parse(readFileSync(evidencePath, 'utf8'))
  assert.equal(persisted.schemaVersion, 3)
  assert.equal(persisted.runManifest.runId, 'fixture-run')
  assert.match(persisted.runManifest.provenance.sha256, /^[0-9a-f]{64}$/)
  assert.equal(persisted.repository.dirty, false)
  assert.equal(persisted.runtime.deviceID, 'emulator-1')
  assert.equal(persisted.contractEvidence.passed, true)
  assert.match(evidencePath, /android-[A-Za-z0-9-]+-evidence\.json$/)
})

test('Public runner evidence redacts credentials and payload identities', async () => {
  const { createAutomationEvidenceRecord } = await import(modulePath.href)
  const root = projectRoot()
  const evidence = createAutomationEvidenceRecord({
    projectRoot: root,
    platform: 'ios',
    report: { token: 'eyJhbGciOiJIUzI1NiJ9.secret.payload', userID: 'unixagent1234567890abcdef', cases: [], events: [] },
    reportPath: resolve(root, 'test-results/openim-automation/openim-automation-1.json'),
    manifestOverride: manifest(),
    runId: 'fixture-run',
    runManifest: runManifest('ios', 'fixture-run'),
  })
  assert.match(evidence.redactedReport.token, /^<redacted:/)
  assert.match(evidence.redactedReport.userID, /^<redacted:/)
})

test('Public runner evidence redacts disposable user IDs embedded in narrative strings', async () => {
  const { createAutomationEvidenceRecord } = await import(modulePath.href)
  const root = projectRoot()
  const evidence = createAutomationEvidenceRecord({
    projectRoot: root,
    platform: 'android',
    report: {
      cases: [{
        group: 'setup',
        name: 'login',
        message: 'read-after-login matched unixagent260812022313vi62eza before cleanup',
      }],
      events: [],
    },
    reportPath: resolve(root, 'test-results/openim-automation/openim-automation-1.json'),
    manifestOverride: manifest(),
    runId: 'fixture-run',
    runManifest: runManifest('android', 'fixture-run'),
  })
  const encoded = JSON.stringify(evidence.redactedReport)
  assert.doesNotMatch(encoded, /unixagent260812022313vi62eza/)
  assert.match(encoded, /<redacted:/)
})

test('Public runner evidence recursively redacts encoded response payloads', async () => {
  const { createAutomationEvidenceRecord } = await import(modulePath.href)
  const root = projectRoot()
  const evidence = createAutomationEvidenceRecord({
    projectRoot: root,
    platform: 'ios',
    report: {
      cases: [{
        responseDetail: JSON.stringify({
          userID: 'unixagent1234567890abcdef',
          token: 'eyJhbGciOiJIUzI1NiJ9.secret.payload',
          uploadURL: 'http://internal.example/object/unixagent1234567890abcdef/file?X-Amz-Signature=secret',
        }),
      }],
      events: [],
    },
    reportPath: resolve(root, 'test-results/openim-automation/openim-automation-1.json'),
    manifestOverride: manifest(),
    runId: 'fixture-run',
    runManifest: runManifest('ios', 'fixture-run'),
  })
  const encoded = evidence.redactedReport.cases[0].responseDetail
  assert.doesNotMatch(encoded, /unixagent1234567890abcdef|eyJhbGci|X-Amz-Signature|secret/)
  assert.match(encoded, /<redacted:/)
})

test('Public runner evidence recursively redacts encoded event payloads', async () => {
  const { createAutomationEvidenceRecord } = await import(modulePath.href)
  const root = projectRoot()
  const evidence = createAutomationEvidenceRecord({
    projectRoot: root,
    platform: 'ios',
    report: {
      events: [{ lastPayload: JSON.stringify({ userID: 'unixagent1234567890abcdef' }), payloadDetail: JSON.stringify({ userID: 'unixagent1234567890abcdef', token: 'eyJhbGciOiJIUzI1NiJ9.secret.payload' }), payloadDetails: [JSON.stringify({ userID: 'unixagent1234567890abcdef' })] }],
      cases: [{ eventCorrelations: [{ payloadIdentity: 'client-message-sensitive', eventPayloadDetail: JSON.stringify({ clientMsgID: 'client-message-sensitive' }) }] }],
    },
    reportPath: resolve(root, 'test-results/openim-automation/openim-automation-1.json'),
    manifestOverride: manifest(),
    runId: 'fixture-run',
    runManifest: runManifest('ios', 'fixture-run'),
  })
  const encoded = evidence.redactedReport.events[0].payloadDetail
  assert.doesNotMatch(encoded, /unixagent1234567890abcdef|eyJhbGci|secret/)
  assert.match(encoded, /<redacted:/)
  assert.doesNotMatch(evidence.redactedReport.events[0].payloadDetails[0], /unixagent1234567890abcdef/)
  assert.doesNotMatch(evidence.redactedReport.events[0].lastPayload, /unixagent1234567890abcdef/)
  assert.match(evidence.redactedReport.cases[0].eventCorrelations[0].payloadIdentity, /^<redacted:/)
  assert.doesNotMatch(evidence.redactedReport.cases[0].eventCorrelations[0].eventPayloadDetail, /client-message-sensitive/)
})

test('Public runner evidence preserves composite group-member correlation after redaction', async () => {
  const { createAutomationEvidenceRecord } = await import(modulePath.href)
  const root = projectRoot()
  const evidence = createAutomationEvidenceRecord({
    projectRoot: root,
    platform: 'android',
    report: {
      cases: [{
        eventCorrelations: [{
          eventName: 'onGroupMemberAdded',
          payloadIdentity: 'group-sensitive:user-sensitive',
          eventPayloadDetail: JSON.stringify({ groupID: 'group-sensitive', userID: 'user-sensitive' }),
        }],
      }],
      events: [],
    },
    reportPath: resolve(root, 'test-results/openim-automation/openim-automation-1.json'),
    manifestOverride: manifest(),
    runId: 'fixture-run',
    runManifest: runManifest('android', 'fixture-run'),
  })
  const correlation = evidence.redactedReport.cases[0].eventCorrelations[0]
  const payload = JSON.parse(correlation.eventPayloadDetail)

  assert.equal(correlation.payloadIdentity, `${payload.groupID}:${payload.userID}`)
  assert.doesNotMatch(JSON.stringify(evidence.redactedReport), /group-sensitive|user-sensitive/)
})

test('Public runner evidence rejects missing semantic proof', async () => {
  const { createAutomationEvidenceRecord, evidenceFailureMessage } = await import(modulePath.href)
  const root = projectRoot()
  const evidence = createAutomationEvidenceRecord({
    projectRoot: root,
    platform: 'android',
    report: { cases: [{ apiName: 'getLoginStatus', status: 'passed', invoked: true, resolved: true, responseEvidence: true, responseDetail: '3', structureValidated: true, semanticValidated: false }], events: [] },
    reportPath: resolve(root, 'test-results/openim-automation/openim-automation-1.json'),
    manifestOverride: manifest(),
    runId: 'fixture-run',
    runManifest: runManifest('android', 'fixture-run'),
  })
  assert.equal(evidence.contractEvidence.passed, false)
  assert.match(evidenceFailureMessage(evidence), /getLoginStatus/)
})

test('Public runner never reuses an automation report from before this run', async () => {
  const { findLatestAutomationReport } = await import(modulePath.href)
  const root = projectRoot()
  const reportPath = resolve(root, 'test-results/openim-automation/openim-automation-stale.json')
  writeFileSync(reportPath, JSON.stringify({ headline: 'Automation passed' }))
  const staleTime = new Date(Date.now() - 10_000)
  utimesSync(reportPath, staleTime, staleTime)

  assert.equal(findLatestAutomationReport(root, Date.now()), null)
})

test('latest evidence is navigation only and cannot replace immutable run evidence', async () => {
  const { writeLatestAutomationEvidence } = await import(modulePath.href)
  const root = projectRoot()
  const reportPath = resolve(root, 'test-results/openim-automation/openim-automation-new.json')
  writeFileSync(reportPath, JSON.stringify({ headline: 'Automation failed', total: 1, passed: 0, failed: 1, skipped: 0, cases: [], events: [] }))
  const result = writeLatestAutomationEvidence({
    projectRoot: root,
    platform: 'android',
    manifestOverride: { ...manifest(), counts: { callables: 0, events: 0 }, callables: [], events: [] },
    runId: 'immutable-run',
    runManifest: runManifest('android', 'immutable-run'),
    runManifestPath: 'test-results/openim-automation/android-immutable-run-manifest.json',
  })
  const latest = JSON.parse(readFileSync(result.latestEvidencePath, 'utf8'))

  assert.equal(latest.navigationOnly, true)
  assert.equal(latest.runId, 'immutable-run')
  assert.equal(Object.hasOwn(latest, 'redactedReport'), false)
  assert.match(latest.path, /android-immutable-run-evidence\.json$/)
})
