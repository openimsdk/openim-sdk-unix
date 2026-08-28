import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const common = readFileSync(resolve(root, 'uni_modules/unix-openim-sdk/utssdk/common/native-call-common.uts'), 'utf8')
const ios = readFileSync(resolve(root, 'uni_modules/unix-openim-sdk/utssdk/app-ios/native-call.uts'), 'utf8')
const iosIndex = readFileSync(resolve(root, 'uni_modules/unix-openim-sdk/utssdk/app-ios/index.uts'), 'utf8')
const androidIndex = readFileSync(resolve(root, 'uni_modules/unix-openim-sdk/utssdk/app-android/index.uts'), 'utf8')
const writerSource = readFileSync(resolve(root, 'uni_modules/unix-openim-sdk/utssdk/common/message-json-writer.uts'), 'utf8')
const contract = JSON.parse(readFileSync(resolve(root, 'contracts/base/contract.json'), 'utf8')) as {
  types: Array<{ name: string; declaration: string }>
}

test('public video message schema carries the snapshotType field exported by the locked Core', () => {
  const video = contract.types.find((item) => item.name === 'OpenIMVideoElem')
  assert.ok(video)
  assert.match(video.declaration, /snapshotType \?: string \| null/)

  const parser = common.match(/function parseNativeVideoElem[\s\S]*?\n}\n\nfunction parseNativeFileElem/)?.[0] ?? ''
  assert.match(parser, /snapshotType: helpers\.readStringParam\(value, 'snapshotType'\)/)

  const writer = writerSource.match(/export function stringifyOpenIMVideoElem[\s\S]*?\n}\n\nfunction stringifyOpenIMVideoElemForMessage/)?.[0] ?? ''
  assert.match(writer, /appendOptionalJSONStringText\(text, 'snapshotType', value\.snapshotType\)/)
  assert.match(ios, /export \{[^}]*stringifyOpenIMMessagePayload[^}]*\} from '\.\.\/common\/message-json-writer\.uts'/)
})

test('advanced history parser does not fabricate the removed lastMinSeq field', () => {
  const parser = common.match(/export function parseNativeAdvancedHistoryMessageListCommon[\s\S]*?\n}\n\nexport function parseNativeAdvancedHistoryMessageListFallbackCommon[\s\S]*?\n}/)?.[0] ?? ''
  assert.notEqual(parser, '')
  assert.doesNotMatch(parser, /lastMinSeq/)
})

test('typed native messages are reconstructed through the declared public message schema', () => {
  const parser = common.match(/export function parseNativeMessageCommon[\s\S]*?\n}\n\nexport function parseNativeAdvancedHistoryMessageListCommon/)?.[0] ?? ''

  assert.match(parser, /parseObjectFromValue\(typedMessage, helpers\)/)
  assert.match(parser, /parseNativeMessageItem\(typedRaw, helpers\)/)
  assert.doesNotMatch(parser, /return typedMessage\s*}/)
  assert.doesNotMatch(parser, /return typedList\[0\]\s*}/)
  assert.match(ios, /const parsed = value\.getNumber\(key\)/)
  assert.match(ios, /parseFloat\(\(parsed as number\)\.toString\(\)\)/)
  assert.match(ios, /return value\.getNumber\(key\) != null/)
})

test('public message writers normalize every item instead of forwarding raw Core JSON', () => {
  assert.doesNotMatch(writerSource, /rememberOpenIMMessageJSON/)
  assert.match(writerSource, /items\.push\(stringifyOpenIMMessage\(message\)\)/)
  assert.doesNotMatch(ios, /rememberNativeMessageJSON/)
  assert.match(writerSource, /export function stringifyOpenIMMessageEvidencePayload/)
  assert.match(writerSource, /'descriptionText', value\.descriptionText/)
  assert.match(writerSource, /'extensionText', value\.extensionText/)
})

test('quote producers preserve the public canonical message JSON string contract', () => {
  for (const source of [iosIndex, androidIndex]) {
    const quote = source.match(/export const createQuoteMessage[\s\S]*?export const createAdvancedQuoteMessage/)?.[0] ?? ''
    const advanced = source.match(/export const createAdvancedQuoteMessage[\s\S]*?export const createAdvancedTextMessage/)?.[0] ?? ''
    assert.match(quote, /stringifyJSON\(params\.message\)/)
    assert.match(advanced, /stringifyJSON\(params\.message\)/)
  }
})
