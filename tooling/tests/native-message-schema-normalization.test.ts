import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const common = readFileSync(resolve(root, 'uni_modules/unix-openim-sdk/utssdk/common/native-call-common.uts'), 'utf8')
const ios = readFileSync(resolve(root, 'uni_modules/unix-openim-sdk/utssdk/app-ios/native-call.uts'), 'utf8')
const contract = JSON.parse(readFileSync(resolve(root, 'contracts/base/contract.json'), 'utf8')) as {
  types: Array<{ name: string; declaration: string }>
}

test('public video message schema carries the snapshotType field exported by the locked Core', () => {
  const video = contract.types.find((item) => item.name === 'OpenIMVideoElem')
  assert.ok(video)
  assert.match(video.declaration, /snapshotType \?: string \| null/)

  const parser = common.match(/function parseNativeVideoElem[\s\S]*?\n}\n\nfunction parseNativeFileElem/)?.[0] ?? ''
  assert.match(parser, /snapshotType: helpers\.readStringParam\(value, 'snapshotType'\)/)

  const writer = ios.match(/export function stringifyOpenIMVideoElem[\s\S]*?\n}\n\nfunction stringifyOpenIMVideoElemForMessage/)?.[0] ?? ''
  assert.match(writer, /appendOptionalJSONStringText\(text, 'snapshotType', value\.snapshotType\)/)
})

test('typed native messages are reconstructed through the declared public message schema', () => {
  const parser = common.match(/export function parseNativeMessageCommon[\s\S]*?\n}\n\nexport function parseNativeAdvancedHistoryMessageListCommon/)?.[0] ?? ''

  assert.match(parser, /parseObjectFromValue\(typedMessage, helpers\)/)
  assert.match(parser, /parseNativeMessageItem\(typedRaw, helpers\)/)
  assert.doesNotMatch(parser, /return typedMessage\s*}/)
  assert.doesNotMatch(parser, /return typedList\[0\]\s*}/)
})
