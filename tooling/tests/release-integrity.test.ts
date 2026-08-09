import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildReleaseIntegrityReport,
  releaseIntegrityFindings,
  scanReleaseSecrets,
  verifyComponentLicenses,
  type ReleaseComponent,
} from '../src/release-integrity.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

test('Public release integrity report is deterministic and inventories every locked dependency', () => {
  const first = buildReleaseIntegrityReport(root, 'public', {
    repository: { revision: 'test-revision', dirty: false },
  })
  const second = buildReleaseIntegrityReport(root, 'public', {
    repository: { revision: 'test-revision', dirty: false },
  })
  assert.deepEqual(first, second)
  assert.equal(first.sbom.bomFormat, 'CycloneDX')
  assert.equal(first.sbom.specVersion, '1.6')
  assert.equal(first.edition, 'public')
  assert.equal(first.repository.dirty, false)

  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, unknown>
  }
  const npmPackageCount = Object.keys(lock.packages).filter((path) => path !== '').length
  assert.equal(first.sbom.components.length, npmPackageCount + 3, 'workspace plugin plus npm and two Public native components')
  assert.equal(new Set(first.sbom.components.map((item) => item['bom-ref'])).size, first.sbom.components.length)
  assert.ok(first.sbom.components.some((item) => item.purl?.startsWith('pkg:maven/io.openim/core-sdk@')))
  assert.ok(first.sbom.components.some((item) => item.purl?.startsWith('pkg:cocoapods/OpenIMSDKCore@')))
  assert.equal(first.licenses.findings.length, 0)
  assert.equal(first.secrets.findings.length, 0)
  assert.deepEqual(releaseIntegrityFindings(first, true), [])
  const dirty = structuredClone(first)
  dirty.repository.dirty = true
  assert.deepEqual(releaseIntegrityFindings(dirty, true), ['repository is dirty'])
})

test('license verification blocks missing and unapproved component licenses', () => {
  const component = (license: string): ReleaseComponent => ({
    type: 'library',
    name: 'fixture',
    version: '1.0.0',
    'bom-ref': 'fixture@1.0.0',
    licenses: license.length === 0 ? [] : [{ license: { id: license } }],
  })
  assert.deepEqual(verifyComponentLicenses([component('MIT')], new Set(['MIT'])), [])
  assert.match(verifyComponentLicenses([component('')], new Set(['MIT']))[0] ?? '', /missing license/)
  assert.match(verifyComponentLicenses([component('GPL-2.0-only')], new Set(['MIT']))[0] ?? '', /not approved/)
})

test('secret scan requires an exact path, rule, and match hash allowlist', () => {
  const syntheticJWT = ['eyJhbGciOiJIUzI1NiJ9', 'synthetic', 'payload'].join('.')
  const files = [{ path: 'fixture.ts', content: `const token = '${syntheticJWT}'` }]
  const blocked = scanReleaseSecrets(files, [])
  assert.equal(blocked.findings.length, 1)
  assert.equal(blocked.findings[0]?.rule, 'jwt')

  const allowed = scanReleaseSecrets(files, [{
    path: 'fixture.ts',
    rule: 'jwt',
    matchSha256: blocked.findings[0]!.matchSha256,
    reason: 'synthetic redaction fixture',
  }])
  assert.equal(allowed.findings.length, 0)
  assert.equal(allowed.allowlisted.length, 1)

  const changed = scanReleaseSecrets(
    [{ path: 'fixture.ts', content: `const token = '${syntheticJWT}changed'` }],
    allowed.allowlisted,
  )
  assert.equal(changed.findings.length, 1)
})
