import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)

test('HBuilderX can require the root Jest configuration while tooling remains ESM', () => {
  const rootPackage = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { type?: string }
  const toolingPackage = JSON.parse(readFileSync(resolve(root, 'tooling/package.json'), 'utf8')) as { type?: string }

  assert.notEqual(rootPackage.type, 'module')
  assert.equal(toolingPackage.type, 'module')

  const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'openim-hbuilderx-jest-'))
  try {
    copyFileSync(resolve(root, 'jest.config.js'), resolve(fixtureRoot, 'jest.config.js'))
    writeFileSync(resolve(fixtureRoot, 'env.js'), 'module.exports = {}\n')
    const config = require(resolve(fixtureRoot, 'jest.config.js')) as { testMatch?: unknown }
    assert.equal(Array.isArray(config.testMatch), true)
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})
