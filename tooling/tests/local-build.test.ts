import assert from 'node:assert/strict'
import test from 'node:test'
import { isAppResourceSuccessful } from '../src/local-build.js'

test('accepts an explicit Android appResource export success', () => {
  assert.equal(
    isAppResourceSuccessful('android', '项目 demo（模块 unix-openim-sdk）编译成功。\n项目 demo 导出 android 成功。'),
    true,
  )
})

test('accepts an explicit iOS appResource export success', () => {
  assert.equal(isAppResourceSuccessful('ios', '项目 demo 导出 ios 成功。'), true)
})

test('rejects a success marker when the same log contains a failure', () => {
  assert.equal(
    isAppResourceSuccessful('android', 'UTS 插件编译失败。\n项目 demo 导出 android 成功。'),
    false,
  )
})

test('rejects a zero-error log without an explicit export success marker', () => {
  assert.equal(isAppResourceSuccessful('ios', '正在导出 ios 应用资源。'), false)
})
