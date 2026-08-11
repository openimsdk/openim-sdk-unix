import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const nativeCall = new URL('../uni_modules/unix-openim-sdk/utssdk/app-ios/native-call.uts', import.meta.url)
const nativeSDK = new URL('../uni_modules/unix-openim-sdk/utssdk/app-ios/NativeOpenIMSDK.swift', import.meta.url)

test('iOS object arrays cross the UTS bridge as framed object JSON strings', async () => {
  const source = await readFile(nativeCall, 'utf8')
  assert.match(source, /NativeOpenIMSDK\.splitJSONObjectArray\(data\)/)
  assert.match(source, /framedText\.split\('\\n'\)/)
  assert.match(source, /JSON\.parseObject\(itemJSON\)/)
  assert.doesNotMatch(source, /JSON\.parseArray<UTSJSONObject>\(data\)/)
})

test('iOS Foundation booleans use the typed UTSJSONObject accessor', async () => {
  const source = await readFile(nativeCall, 'utf8')
  const swift = await readFile(nativeSDK, 'utf8')
  assert.match(source, /value instanceof UTSJSONObject/)
  assert.match(source, /value\.getBoolean\(key\)/)
  assert.match(source, /return value\.getBoolean\(key\) != null/)
  assert.doesNotMatch(swift, /(?:is|read)JSONObjectBoolean/)
})
