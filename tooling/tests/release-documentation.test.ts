import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function text(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

test('Public release documentation matches the executable evidence policy', () => {
  const release = text('PUBLIC_MARKETPLACE_RELEASE.md')
  const readme = text('README.md')

  assert.match(release, /每个平台连续三次同一 series/)
  assert.match(release, /Android.*至少一次.*arm64.*真机.*Release/s)
  assert.match(release, /iOS.*不强制真机/s)
  assert.match(release, /schema-v3/)
  assert.match(release, /schema-v2.*历史/s)
  assert.match(release, /latest.*导航/s)
  assert.match(release, /Public 与 Private.*不能互相复用/s)
  assert.match(release, /Private Android\/iOS.*Enterprise Core/s)
  assert.match(release, /CI\/Release 资产/)
  assert.match(readme, /latest.*导航/s)
  assert.match(readme, /schema-v2.*历史/s)
})
