import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { verifyCompatibilityLedger } from '../src/policy.js'

function writeLedger(entry: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'openim-compatibility-ledger-'))
  mkdirSync(join(root, 'tooling/compatibility'), { recursive: true })
  writeFileSync(join(root, 'tooling/compatibility/ledger.json'), JSON.stringify({
    version: 1,
    toolchain: 'test',
    entries: [entry],
  }))
  return root
}

const certifiedEntry = {
  id: 'UTS-COMPAT-TEST-001',
  classification: 'proven-workaround',
  platforms: ['ios'],
  reason: 'test',
  versions: ['test'],
  probe: 'test',
  removeWhen: 'test',
  owner: 'SDK team',
  status: 'active',
  releaseStatus: 'certified',
  lastVerified: '2026-08-01',
  nextCheck: '2026-09-01',
}

test('compatibility ledger requires fresh ownership and release metadata', () => {
  assert.doesNotThrow(() => verifyCompatibilityLedger(writeLedger(certifiedEntry), false, '2026-08-08'))
  assert.throws(
    () => verifyCompatibilityLedger(writeLedger({ ...certifiedEntry, owner: '' }), false, '2026-08-08'),
    /owner/,
  )
  assert.throws(
    () => verifyCompatibilityLedger(writeLedger({ ...certifiedEntry, nextCheck: '2026-08-07' }), false, '2026-08-08'),
    /review is overdue/,
  )
})

test('release policy blocks unresolved and expired compatibility entries', () => {
  assert.throws(
    () => verifyCompatibilityLedger(writeLedger({ ...certifiedEntry, releaseStatus: 'blocked' }), true, '2026-08-08'),
    /release-blocked/,
  )
  assert.throws(
    () => verifyCompatibilityLedger(writeLedger({ ...certifiedEntry, classification: 'experimental', expiry: '2026-08-07' }), false, '2026-08-08'),
    /expired/,
  )
})
