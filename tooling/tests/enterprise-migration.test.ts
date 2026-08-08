import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  applyEnterpriseMigration,
  canonicalEnterpriseMigrationContent,
  type EnterpriseMigrationPreview,
} from '../src/enterprise-migration.js'

test('Enterprise migration parity ignores JSON formatting and object key order', () => {
  assert.equal(
    canonicalEnterpriseMigrationContent('{"b": 2, "a": {"d": 4, "c": 3}}\n'),
    canonicalEnterpriseMigrationContent('{\n  "a": { "c": 3, "d": 4 },\n  "b": 2\n}'),
  )
})

test('Enterprise migration output cannot be written without exact approval', () => {
  const root = mkdtempSync(join(tmpdir(), 'openim-enterprise-approval-'))
  mkdirSync(join(root, 'contracts/enterprise'), { recursive: true })
  const preview: EnterpriseMigrationPreview = {
    schemaVersion: 1,
    fingerprint: 'exact',
    outputChanges: [{ path: 'contracts/enterprise/delta.json', beforeHash: 'old', afterHash: 'new' }],
    candidateOutputs: [{ path: 'contracts/enterprise/delta.json', content: 'candidate\n' }],
  }
  assert.throws(() => applyEnterpriseMigration(root, preview, undefined), /approval is required/)
  assert.throws(
    () => applyEnterpriseMigration(root, preview, { schemaVersion: 1, previewFingerprint: 'wrong', approvedBy: 'test', reason: 'test' }),
    /does not match/,
  )
  applyEnterpriseMigration(root, preview, { schemaVersion: 1, previewFingerprint: 'exact', approvedBy: 'test', reason: 'test' })
  assert.equal(readFileSync(join(root, 'contracts/enterprise/delta.json'), 'utf8'), 'candidate\n')
})
