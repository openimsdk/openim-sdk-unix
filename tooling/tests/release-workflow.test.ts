import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const workflow = readFileSync(resolve(root, '.github/workflows/contract-gates.yml'), 'utf8')

test('Public release workflow requires three platform-bound evidence records per mobile platform', () => {
  for (const platform of ['ANDROID', 'IOS']) {
    for (const sequence of [1, 2, 3]) {
      assert.match(workflow, new RegExp(`OPENIM_PUBLIC_${platform}_EVIDENCE_${sequence}`))
    }
  }
  assert.match(workflow, /verify:runtime-evidence[^\n]*--expected-platform android[^\n]*--minimum-runs 3/)
  assert.match(workflow, /verify:runtime-evidence[^\n]*--expected-platform ios[^\n]*--minimum-runs 3/)
  assert.doesNotMatch(workflow, /OPENIM_PUBLIC_AUTOMATION_SUMMARY_/)
})

test('Public release workflow requires arm64 physical Release evidence inside a three-run platform series', () => {
  assert.match(workflow, /verify:runtime-evidence[^\n]*--expected-platform android[^\n]*--minimum-runs 3[^\n]*--require-arm64-physical-release/)
})
