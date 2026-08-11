import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src/harmony-bindings.ts', import.meta.url), 'utf8')
const composerSource = readFileSync(new URL('../src/enterprise-compose.ts', import.meta.url), 'utf8')

test('generated Harmony bindings retain method and operation identity on rejection', () => {
  assert.ok(source.includes("trackStringPromise(nativePromise, '${method.name}', operationID)"))
  assert.ok(!source.includes("'    return OpenIMHarmonyDriver.trackStringPromise(nativePromise)',"))
})

test('Enterprise generation keeps the Harmony Driver authority equal to its projection', () => {
  assert.ok(composerSource.includes("writeText(join(privateRoot, 'sdk-src/native/harmony/OpenIMHarmonyDriver.ets'), harmonyDriverOutput.content)"))
})
