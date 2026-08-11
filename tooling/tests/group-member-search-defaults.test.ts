import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const android = readFileSync(resolve(root, 'uni_modules/unix-openim-sdk/utssdk/app-android/NativeOpenIMSDK.kt'), 'utf8')
const ios = readFileSync(resolve(root, 'uni_modules/unix-openim-sdk/utssdk/app-ios/NativeOpenIMSDK.swift'), 'utf8')

test('group-member search supplies a non-zero native page when the public request omits pagination', () => {
  assert.match(android, /buildSearchGroupMembersPayload/)
  assert.match(android, /if \(!raw\.has\("offset"\) \|\| raw\.isNull\("offset"\)\)[\s\S]*payload\.put\("offset", 0\)/)
  assert.match(android, /if \(!raw\.has\("count"\) \|\| raw\.isNull\("count"\) \|\| raw\.optInt\("count", 0\) <= 0\)[\s\S]*payload\.put\("count", 100\)/)
  assert.match(android, /Open_im_sdk\.searchGroupMembers\([^\n]+payload\)/)

  assert.match(ios, /buildSearchGroupMembersPayload/)
  assert.match(ios, /raw\["offset"\] == nil[\s\S]*payload\["offset"\] = 0/)
  assert.match(ios, /raw\["count"\] == nil[\s\S]*payload\["count"\] = 100/)
  assert.match(ios, /Open_im_sdkSearchGroupMembers\([^\n]+payload\)/)
})
