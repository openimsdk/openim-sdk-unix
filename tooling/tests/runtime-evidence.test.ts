import assert from 'node:assert/strict'
import test from 'node:test'
import {
  runtimeEvidenceFindings,
  type RuntimeEvidence,
} from '../src/runtime-evidence.js'

const revision = 'a'.repeat(40)

function evidence(overrides: Partial<RuntimeEvidence> = {}): RuntimeEvidence {
  return {
    schemaVersion: 2,
    runId: 'run-android-1',
    generatedAt: '2026-08-08T00:00:00.000Z',
    platform: 'android',
    fullRun: true,
    series: { id: 'android-release-series', sequence: 1, total: 3 },
    repository: { revision, dirty: false },
    runtime: {
      target: 'app-android',
      deviceID: 'physical-device-1',
      deviceKind: 'physical',
      osVersion: '16',
      architecture: 'arm64-v8a',
      buildConfiguration: 'Release',
    },
    sourceReport: {
      path: 'test-results/openim-automation/report.json',
      headline: 'Automation passed',
      total: 244,
      passed: 244,
      failed: 0,
      skipped: 0,
    },
    contractEvidence: { passed: true, strictPassed: true, knownIssueWaivers: [], issues: [] },
    responseStructureEvidence: { passed: true, detail: 'verified' },
    redactedReport: {},
    ...overrides,
  }
}

test('release runtime evidence binds a full clean run to its platform and repository revision', () => {
  assert.deepEqual(runtimeEvidenceFindings(
    [evidence()],
    { expectedPlatform: 'android', expectedRevision: revision, release: true },
  ), [])
})

test('release runtime evidence rejects approved known-issue waivers without erasing compatibility evidence', () => {
  const waived = evidence({
    contractEvidence: {
      passed: true,
      strictPassed: false,
      issues: [],
      knownIssueWaivers: [{
        caseId: 'event/onRecvNewMessage',
        axis: 'epoch',
        code: 'harmony-uninit-sdk-sigsegv',
        evidenceApiName: 'unInitSDK',
      }],
    },
  })

  assert.deepEqual(runtimeEvidenceFindings(
    [waived],
    { expectedPlatform: 'android', expectedRevision: revision },
  ), [])
  assert.ok(runtimeEvidenceFindings(
    [waived],
    { expectedPlatform: 'android', expectedRevision: revision, release: true },
  ).some((item) => item.includes('approved known-issue waivers')))
  assert.ok(runtimeEvidenceFindings(
    [waived],
    { expectedPlatform: 'android', expectedRevision: revision, release: true },
  ).some((item) => item.includes('not a strict pass')))
})

test('release runtime evidence rejects skipped work, dirty sources, and platform substitution', () => {
  const invalid = evidence({
    platform: 'ios',
    repository: { revision, dirty: true },
    sourceReport: {
      path: 'report.json', headline: 'partial', total: 244, passed: 243, failed: 0, skipped: 1,
    },
  })
  const findings = runtimeEvidenceFindings(
    [invalid],
    { expectedPlatform: 'android', expectedRevision: revision, release: true },
  )
  assert.ok(findings.some((item) => item.includes('expected platform android')))
  assert.ok(findings.some((item) => item.includes('repository is dirty')))
  assert.ok(findings.some((item) => item.includes('skipped 1')))
})

test('three-run gate rejects reused evidence and non-contiguous run series', () => {
  const findings = runtimeEvidenceFindings([
    evidence(),
    evidence({ series: { id: 'android-release-series', sequence: 3, total: 3 } }),
    evidence({ runId: 'run-android-3', series: { id: 'other-series', sequence: 3, total: 3 } }),
  ], {
    expectedPlatform: 'android',
    expectedRevision: revision,
    release: true,
    minimumRuns: 3,
  })
  assert.ok(findings.some((item) => item.includes('duplicate runId')))
  assert.ok(findings.some((item) => item.includes('one series')))
  assert.ok(findings.some((item) => item.includes('contiguous')))
})

test('arm64 physical Release gate excludes simulator and Debug evidence', () => {
  const findings = runtimeEvidenceFindings([
    evidence({
      runtime: {
        target: 'app-ios-simulator',
        deviceID: 'simulator-1',
        deviceKind: 'simulator',
        osVersion: '18.1',
        architecture: 'arm64',
        buildConfiguration: 'Debug',
      },
    }),
  ], {
    expectedPlatform: 'android',
    expectedRevision: revision,
    release: true,
    requireArm64PhysicalRelease: true,
  })
  assert.ok(findings.some((item) => item.includes('arm64 physical-device Release')))
})

test('three-run gate requires timestamps to increase with the declared sequence', () => {
  const findings = runtimeEvidenceFindings([
    evidence(),
    evidence({
      runId: 'run-android-2',
      generatedAt: '2026-08-07T23:59:59.000Z',
      series: { id: 'android-release-series', sequence: 2, total: 3 },
    }),
    evidence({
      runId: 'run-android-3',
      generatedAt: '2026-08-08T00:00:01.000Z',
      series: { id: 'android-release-series', sequence: 3, total: 3 },
    }),
  ], {
    expectedPlatform: 'android', expectedRevision: revision, release: true, minimumRuns: 3,
  })
  assert.ok(findings.some((item) => item.includes('timestamps must increase')))
})
