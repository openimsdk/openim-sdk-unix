import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const cliSource = readFileSync(new URL('../src/cli.ts', import.meta.url), 'utf8')

function commandBlock(command: string, nextCommand: string): string {
  const start = cliSource.indexOf(`case '${command}':`)
  const end = cliSource.indexOf(`case '${nextCommand}':`, start)
  assert.ok(start >= 0 && end > start, `cannot locate CLI block ${command}`)
  return cliSource.slice(start, end)
}

test('private compile builds a candidate without trusting stale release certification', () => {
  const block = commandBlock('compile-private', 'build-private')
  assert.ok(block.includes('verifyHarmonyCertification: false'))
  assert.ok(!block.includes("platforms.includes('harmony')"))
})

test('Enterprise verify remains the release certification gate', () => {
  const block = commandBlock('enterprise:verify', 'enterprise:bootstrap')
  assert.ok(block.includes('verifyEnterpriseDelta(root, privateRoot)'))
  assert.ok(!block.includes('verifyHarmonyCertification: false'))
})
