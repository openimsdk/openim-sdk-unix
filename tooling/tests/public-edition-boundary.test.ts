import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'

const toolingRoot = resolve(import.meta.dirname, '../src')
const root = resolve(import.meta.dirname, '../..')

test('Public tooling contains no Private contract names or fixed HAR method counts', () => {
  const source = readdirSync(toolingRoot)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => readFileSync(join(toolingRoot, name), 'utf8'))
    .join('\n')
  assert.doesNotMatch(source, /\bOpenIM(?:Signaling|SpeechToText|TranslateText|SDKSession)/)
  assert.doesNotMatch(source, /\bonMigration(?:Start|Progress|Failed|Finished)\b/)
  assert.doesNotMatch(source, /\b(?:142|146)\b/)
})

test('Public repository authority contains no edition-owned operational data', () => {
  assert.equal(existsSync(resolve(root, 'HANDOFF_PUBLIC.md')), false)

  const toolchain = JSON.parse(readFileSync(resolve(root, 'toolchain.lock.json'), 'utf8')) as {
    minimumPlatforms: Record<string, unknown>
  }
  assert.equal(Object.hasOwn(toolchain.minimumPlatforms, 'harmonyApi'), false)

  const ledger = JSON.parse(readFileSync(resolve(root, 'tooling/compatibility/ledger.json'), 'utf8')) as {
    entries: Array<{ editions: string[] }>
  }
  assert.equal(ledger.entries.every((entry) => entry.editions.includes('public')), true)

  const differences = JSON.parse(
    readFileSync(resolve(root, 'tooling/compatibility/approved-behavior-differences.json'), 'utf8'),
  ) as { differences: Array<{ editions: string[] }> }
  assert.equal(differences.differences.every((entry) => entry.editions.includes('public')), true)
})

test('Public response parser authority is derived only from the Public contract', async () => {
  const { DRIVER_TYPED_RESPONSE_PARSERS } = await import('../src/generate.js')
  const contract = JSON.parse(readFileSync(resolve(root, 'contracts/base/contract.json'), 'utf8')) as {
    callables: Array<{ responseCodec: string }>
  }
  const publicCodecs = new Set(contract.callables.map((callable) => callable.responseCodec))
  const leaked = Object.keys(DRIVER_TYPED_RESPONSE_PARSERS).filter((codec) => !publicCodecs.has(codec))
  assert.deepEqual(leaked, [])
})

test('Harmony compiler validates inventories without fixed event counts', () => {
  const harmonySources = ['enterprise-contract.ts', 'harmony-bindings.ts']
    .map((name) => readFileSync(resolve(toolingRoot, name), 'utf8'))
    .join('\n')
  assert.doesNotMatch(harmonySources, /events\.length\s*===\s*\d+/)
  assert.doesNotMatch(harmonySources, /eventCount\s*===\s*\d+/)
})
