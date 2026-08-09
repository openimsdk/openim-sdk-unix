import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const common = readFileSync(resolve(root, 'uni_modules/unix-openim-sdk/utssdk/common/native-call-common.uts'), 'utf8')
const android = readFileSync(resolve(root, 'uni_modules/unix-openim-sdk/utssdk/app-android/native-call.uts'), 'utf8')

test('group application parsing preserves null and never fabricates zero for a missing groupType', () => {
  const parser = common.match(/function parseNativeGroupApplicationItem[\s\S]*?\n}\n\nfunction isValidParsedGroupApplicationList/)?.[0] ?? ''

  assert.match(parser, /const application : OpenIMGroupApplicationItem = \{/)
  assert.doesNotMatch(parser, /groupType: helpers\.readNumberParam/)
  assert.match(parser, /groupType: null/)
  assert.match(parser, /if \(hasNativeKey\(item, 'groupType'\)\)/)
  assert.match(parser, /application\.groupType = groupType == null \? null : helpers\.readNumberParam\(item, 'groupType'\)/)
})

test('group application validation treats groupType as optional but type checked', () => {
  const validator = common.match(/function isValidParsedGroupApplicationList[\s\S]*?\n}\n\nexport function parseNativeGroupApplicationListResultCommon/)?.[0] ?? ''
  const androidOptionalNumber = android.match(/function isOptionalNumberField[\s\S]*?\n}/)?.[0] ?? ''

  assert.doesNotMatch(validator, /isRequiredField\(raw, 'groupType'\)/)
  assert.match(validator, /isOptionalNumberField\(raw, 'groupType'\) == false/)
  assert.match(androidOptionalNumber, /raw == null \|\| isNativeNumberValue\(raw\)/)
})
