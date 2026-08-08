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
        detail: '3',
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
        detail: '{}',
      },
    ],
  }, (path) => {
    const result = verifyPublicAutomationSummaryStructure(contract, path)
    assert.equal(result.verifiedCases, 1)
    assert.equal(result.failures.length, 1)
    assert.ok(result.failures[0]!.issues.length > 0)
  })
})

test('automation summary verifier flags structurally valid responses that were not recorded as validated', () => {
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
        detail: JSON.stringify('user_123'),
      },
    ],
  }, (path) => {
    const result = verifyPublicAutomationSummaryStructure(contract, path)
    assert.deepEqual(result.failures, [])
    assert.deepEqual(result.driftFailures, [])
    assert.deepEqual(result.missingRecordedStructureValidation, ['getLoginUserID'])
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
