import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const common = readFileSync(resolve(root, 'uni_modules/unix-openim-sdk/utssdk/common/native-call-common.uts'), 'utf8')

test('user-status events normalize both list and Core single-object payloads to the public list wrapper', () => {
  const parser = common.match(/export function parseNativeUserStatusEventListCommon[\s\S]*?\n}\n\nfunction parseNativeFriendItem/)?.[0] ?? ''

  assert.match(parser, /helpers\.parseNativeJSONObjectListData\(data\)/)
  assert.match(parser, /helpers\.parseNativeAny\(data\)/)
  assert.doesNotMatch(parser, /NativeJSONValue/)
  assert.match(parser, /raw instanceof UTSJSONObject/)
  assert.match(parser, /rawList = \[raw\]/)
  assert.match(parser, /return \{ statuses: statuses \}/)
})
