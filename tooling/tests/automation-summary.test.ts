import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { verifyPublicAutomationSummaryStructure } from '../src/automation-summary.js'
import { readAndValidateContract } from '../src/verify-contract.js'

const contract = readAndValidateContract(process.cwd())

function withSummary(summary: object, run: (path: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'openim-automation-summary-'))
  const path = join(directory, 'summary.json')
  try {
    writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`)
    run(path)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('automation summary verifier accepts a matching primitive response', () => {
  withSummary({
    cases: [
      {
        caseId: 'setup/getLoginStatus',
        suite: 'setup',
        name: 'getLoginStatus',
        apiName: 'getLoginStatus',
        ok: true,
        skipped: false,
        resolved: true,
        structureValidated: true,
        responseEvidence: true,
        responseDetail: '3',
        detail: 'login status response',
      },
    ],
  }, (path) => {
    const result = verifyPublicAutomationSummaryStructure(contract, path)
    assert.equal(result.verifiedCases, 1)
    assert.deepEqual(result.failures, [])
    assert.deepEqual(result.driftFailures, [])
    assert.deepEqual(result.missingRecordedStructureValidation, [])
  })
})

test('automation summary verifier rejects a typed response missing required fields', () => {
  withSummary({
    cases: [
      {
        caseId: 'message/sendMessage',
        suite: 'message',
        name: 'sendMessage',
        apiName: 'sendMessage',
        ok: true,
        skipped: false,
        resolved: true,
        structureValidated: false,
        responseEvidence: true,
        responseDetail: '{}',
        detail: 'send response',
      },
    ],
  }, (path) => {
    const result = verifyPublicAutomationSummaryStructure(contract, path)
    assert.equal(result.verifiedCases, 1)
    assert.equal(result.failures.length, 1)
    assert.ok(result.failures[0]!.issues.length > 0)
  })
})

test('automation summary verifier itself certifies an explicit structurally valid response', () => {
  withSummary({
    cases: [
      {
        caseId: 'setup/getLoginUserID',
        suite: 'setup',
        name: 'getLoginUserID',
        apiName: 'getLoginUserID',
        ok: true,
        skipped: false,
        resolved: true,
        structureValidated: false,
        responseEvidence: true,
        responseDetail: JSON.stringify('user_123'),
        detail: 'login user response',
      },
    ],
  }, (path) => {
    const result = verifyPublicAutomationSummaryStructure(contract, path)
    assert.deepEqual(result.failures, [])
    assert.deepEqual(result.driftFailures, [])
    assert.deepEqual(result.missingRecordedStructureValidation, [])
  })
})

test('automation summary verifier strips only explicitly encoded UTS typed-json metadata', () => {
  withSummary({
    cases: [{
      caseId: 'user/getSelfUserInfo',
      apiName: 'getSelfUserInfo',
      ok: true,
      resolved: true,
      responseEvidence: true,
      responseEncoding: 'uts-typed-json-v1',
      responseDetail: JSON.stringify({
        userID: 'user-1',
        nickname: 'User',
        faceURL: '',
        ex: '',
        propertyFields: [{}, {}],
      }),
    }],
  }, (path) => {
    const result = verifyPublicAutomationSummaryStructure(contract, path)
    assert.deepEqual(result.failures, [])
    assert.deepEqual(result.driftFailures, [])
  })
})

test('automation summary verifier never parses a side-effect narrative as an API response', () => {
  withSummary({
    cases: [
      {
        caseId: 'setup/initSDKResponse',
        apiName: 'initSDK',
        ok: true,
        resolved: true,
        structureValidated: true,
        responseEvidence: true,
        responseDetail: 'true',
        detail: 'native init response',
      },
      {
        caseId: 'setup/initSDKSideEffect',
        apiName: 'initSDK',
        ok: true,
        resolved: true,
        structureValidated: true,
        responseEvidence: false,
        responseDetail: '',
        detail: 'successful login and initial sync observed after initSDK',
      },
    ],
  }, (path) => {
    const result = verifyPublicAutomationSummaryStructure(contract, path)
    assert.equal(result.verifiedCases, 1)
    assert.equal(result.skippedCases, 1)
    assert.deepEqual(result.failures, [])
    assert.deepEqual(result.missingRecordedStructureValidation, [])
  })
})

test('automation summary verifier ignores event subscription coverage notes', () => {
  withSummary({
    cases: [
      {
        caseId: 'events/onConnecting',
        suite: 'events',
        name: 'onConnecting',
        apiName: 'onConnecting',
        ok: true,
        skipped: false,
        resolved: true,
        structureValidated: false,
        detail: 'event subscription handle returned',
      },
    ],
  }, (path) => {
    const result = verifyPublicAutomationSummaryStructure(contract, path)
    assert.equal(result.verifiedCases, 0)
    assert.equal(result.skippedCases, 1)
  })
})
