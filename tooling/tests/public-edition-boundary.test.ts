import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'

const toolingRoot = resolve(import.meta.dirname, '../src')

test('Public tooling contains no Private contract names or fixed HAR method counts', () => {
  const source = readdirSync(toolingRoot)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => readFileSync(join(toolingRoot, name), 'utf8'))
    .join('\n')
  for (const forbidden of [
    'getSDKSessionSnapshot', 'onSDKSessionChanged',
    'onMigrationStart', 'onMigrationProgress', 'onMigrationFailed', 'onMigrationFinished',
    'getArchivedConversationList', 'translateMessage', 'translateText', 'updateToken',
  ]) {
    assert.equal(source.includes(forbidden), false, `Public tooling hardcodes Private API ${forbidden}`)
  }
  assert.doesNotMatch(source, /\b(?:142|146)\b/)
})
