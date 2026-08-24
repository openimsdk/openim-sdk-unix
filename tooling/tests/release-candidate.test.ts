import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const readJSON = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'))

test('Public 0.2.1 candidate metadata remains release-pending and non-approved', () => {
  const candidate = readJSON('tooling/release/public-candidate.json')
  const plugin = readJSON('uni_modules/unix-openim-sdk/package.json')

  assert.deepEqual(candidate, {
    schemaVersion: 1,
    edition: 'public',
    version: '0.2.1',
    status: 'release-pending',
    releaseApproved: false,
  })
  assert.equal(plugin.version, candidate.version)
  assert.match(
    readFileSync(resolve(root, 'uni_modules/unix-openim-sdk/changelog.md'), 'utf8'),
    /^# 更新日志\n\n## 0\.2\.1（待发布）/,
  )
})
