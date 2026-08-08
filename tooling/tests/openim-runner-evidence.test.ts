import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'

const modulePath = new URL('../../scripts/lib/openim-runner-evidence.mjs', import.meta.url)
const runnerPath = new URL('../../scripts/run-openim-automation.mjs', import.meta.url)

test('Public runner makes contract evidence part of the process success gate', () => {
  const source = readFileSync(runnerPath, 'utf8')
  assert.match(source, /writeLatestAutomationEvidence\(\{/)
  assert.match(source, /startedAtMs: runStartedAtMs/)
  assert.match(source, /!evidence\.contractEvidence\.passed/)
  assert.match(source, /passed && evidenceFailure\.length === 0/)
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

test('Public runner evidence reads base authority and keeps response structure schema-authoritative', async () => {
  const { writeLatestAutomationEvidence } = await import(modulePath.href)
  const root = projectRoot()
  const report = {
    headline: 'Automation passed', total: 1, passed: 1, failed: 0, skipped: 0,
    cases: [{
      apiName: 'getLoginStatus', status: 'passed', invoked: true, resolved: true,
      responseEvidence: true, responseEncoding: 'uts-typed-json-v1', responseDetail: '3',
      structureValidated: true, semanticValidated: true,
    }],
    events: [],
  }
  const reportPath = resolve(root, 'test-results/openim-automation/openim-automation-new.json')
  writeFileSync(reportPath, JSON.stringify(report))

  const { evidence, evidencePath } = writeLatestAutomationEvidence({ projectRoot: root, platform: 'android' })
  assert.equal(evidence.contractEvidence.passed, true)
  assert.equal(JSON.parse(readFileSync(evidencePath, 'utf8')).contractEvidence.passed, true)
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
  })
  assert.match(evidence.redactedReport.token, /^<redacted:/)
  assert.match(evidence.redactedReport.userID, /^<redacted:/)
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
  })
  const encoded = evidence.redactedReport.events[0].payloadDetail
  assert.doesNotMatch(encoded, /unixagent1234567890abcdef|eyJhbGci|secret/)
  assert.match(encoded, /<redacted:/)
  assert.doesNotMatch(evidence.redactedReport.events[0].payloadDetails[0], /unixagent1234567890abcdef/)
  assert.doesNotMatch(evidence.redactedReport.events[0].lastPayload, /unixagent1234567890abcdef/)
  assert.match(evidence.redactedReport.cases[0].eventCorrelations[0].payloadIdentity, /^<redacted:/)
  assert.doesNotMatch(evidence.redactedReport.cases[0].eventCorrelations[0].eventPayloadDetail, /client-message-sensitive/)
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
