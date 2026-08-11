import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { verifyCompatibilityLedger, verifyReleaseNativeArtifacts } from '../src/policy.js'

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
  editions: ['public', 'enterprise'],
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

test('release compatibility debt is scoped to the edition being published', () => {
  const enterpriseOnlyBlocked = {
    ...certifiedEntry,
    editions: ['enterprise'],
    releaseStatus: 'blocked',
  }
  const root = writeLedger(enterpriseOnlyBlocked)

  assert.doesNotThrow(() => verifyCompatibilityLedger(root, true, '2026-08-08', 'public'))
  assert.throws(
    () => verifyCompatibilityLedger(root, true, '2026-08-08', 'enterprise'),
    /release-blocked/,
  )
})

test('compatibility entries require an explicit valid edition inventory', () => {
  assert.throws(
    () => verifyCompatibilityLedger(writeLedger({ ...certifiedEntry, editions: [] }), false, '2026-08-08'),
    /editions/,
  )
  assert.throws(
    () => verifyCompatibilityLedger(writeLedger({ ...certifiedEntry, editions: ['desktop'] }), false, '2026-08-08'),
    /editions/,
  )
})

function writeToolchain(publicNative: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'openim-release-artifacts-'))
  writeFileSync(join(root, 'toolchain.lock.json'), JSON.stringify({ schemaVersion: 2, publicNative }))
  return root
}

test('Public release blocks remote native artifacts without hash-equivalence evidence', () => {
  const root = writeToolchain({
    android: {
      sha256: 'a'.repeat(64),
      externalCoordinate: 'io.openim:core-sdk:test@aar',
      externalAbiStatus: 'release-blocked-until-proven-identical',
    },
    ios: {
      extractedInventorySha256: 'b'.repeat(64),
      externalPod: 'OpenIMSDKCore',
      externalVersion: 'test',
      externalAbiStatus: 'release-blocked-until-proven-identical',
    },
  })

  assert.throws(() => verifyReleaseNativeArtifacts(root, 'public'), /Android remote artifact.*not proven identical/)
})

test('Public release accepts only matching remote native artifact hashes', () => {
  const equivalent = {
    android: {
      sha256: 'a'.repeat(64),
      externalCoordinate: 'io.openim:core-sdk:test@aar',
      externalAbiStatus: 'proven-identical',
      externalArtifactSha256: 'a'.repeat(64),
    },
    ios: {
      extractedInventorySha256: 'b'.repeat(64),
      externalPod: 'OpenIMSDKCore',
      externalVersion: 'test',
      externalAbiStatus: 'proven-identical',
      externalInventorySha256: 'b'.repeat(64),
    },
  }
  assert.doesNotThrow(() => verifyReleaseNativeArtifacts(writeToolchain(equivalent), 'public'))
  assert.doesNotThrow(() => verifyReleaseNativeArtifacts(writeToolchain(equivalent), 'enterprise'))

  const mismatched = structuredClone(equivalent)
  mismatched.android.externalArtifactSha256 = 'c'.repeat(64)
  assert.throws(
    () => verifyReleaseNativeArtifacts(writeToolchain(mismatched), 'public'),
    /Android remote artifact hash does not match/,
  )
})
