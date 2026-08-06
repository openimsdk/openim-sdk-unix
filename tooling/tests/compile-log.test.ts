import assert from 'node:assert/strict'
import test from 'node:test'
import { isSuccessful } from '../src/compile.js'

test('accepts Harmony only after both UTS and HAP stages succeed', () => {
  assert.equal(isSuccessful('harmony', '项目 demo UTS编译完毕。\n运行包制作成功'), true)
  assert.equal(isSuccessful('harmony', '项目 demo UTS编译完毕。'), false)
  assert.equal(isSuccessful('harmony', '运行包制作成功'), false)
})

test('does not treat a generic Harmony compile phrase as full-app success', () => {
  assert.equal(isSuccessful('harmony', '项目 demo 编译成功。'), false)
})
