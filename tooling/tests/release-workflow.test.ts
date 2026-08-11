import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const workflow = readFileSync(resolve(root, '.github/workflows/contract-gates.yml'), 'utf8')
const editionVariablePrefix = existsSync(resolve(root, 'contracts/enterprise/delta.json'))
  ? 'OPENIM_ENTERPRISE'
  : 'OPENIM_PUBLIC'

test('release workflow uses edition-owned evidence variables for three runs per mobile platform', () => {
  for (const platform of ['ANDROID', 'IOS']) {
    for (const sequence of [1, 2, 3]) {
      assert.match(workflow, new RegExp(`${editionVariablePrefix}_${platform}_EVIDENCE_${sequence}`))
    }
  }
  assert.match(workflow, /verify:runtime-evidence[^\n]*--expected-platform android[^\n]*--minimum-runs 3/)
  assert.match(workflow, /verify:runtime-evidence[^\n]*--expected-platform ios[^\n]*--minimum-runs 3/)
  assert.doesNotMatch(workflow, /OPENIM_(?:PUBLIC|ENTERPRISE)_AUTOMATION_SUMMARY_/)
})

test('release workflow requires arm64 physical Release evidence inside a three-run platform series', () => {
  assert.match(workflow, /verify:runtime-evidence[^\n]*--expected-platform android[^\n]*--minimum-runs 3[^\n]*--require-arm64-physical-release/)
})
