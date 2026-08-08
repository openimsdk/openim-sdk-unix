import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import type { ContractDocument } from '../src/model.js'
import {
  PLATFORM_DRIVER_SLICE_NAMES,
  platformDriverBindings,
  renderNativeCoreAdapter,
  renderPlatformDriverUTS,
} from '../src/platform-driver.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const contract = JSON.parse(readFileSync(resolve(root, 'contracts/base/contract.json'), 'utf8')) as ContractDocument

test('first PlatformDriver slice keeps canonical contract IDs', () => {
  assert.deepEqual(
    platformDriverBindings(contract).map(({ id, name }) => ({ id, name })),
    [
      { id: 2051, name: 'initSDK' },
      { id: 2052, name: 'login' },
      { id: 2053, name: 'logout' },
      { id: 2054, name: 'getLoginStatus' },
      { id: 2055, name: 'getLoginUserID' },
      { id: 2056, name: 'getSdkVersion' },
      { id: 2058, name: 'unInitSDK' },
    ],
  )
  assert.deepEqual(PLATFORM_DRIVER_SLICE_NAMES, [
    'initSDK',
    'login',
    'logout',
    'getLoginStatus',
    'getLoginUserID',
    'getSdkVersion',
    'unInitSDK',
  ])
})

test('UTS PlatformDriver exposes exactly the three free-function entries', () => {
  for (const platform of ['android', 'ios'] as const) {
    const source = renderPlatformDriverUTS(platform)
    assert.match(source, /export function driverCallAsync\(/)
    assert.match(source, /export function driverCallSync\(/)
    assert.match(source, /export function driverBindEventSink\(/)
    assert.doesNotMatch(source, /\b(?:class|interface)\b/)
    assert.doesNotMatch(source, /400\d{3}/)
  }
})

test('native CoreAdapters dispatch the first slice by canonical callable ID', () => {
  for (const platform of ['android', 'ios'] as const) {
    const source = renderNativeCoreAdapter(contract, platform)
    for (const id of [2051, 2052, 2053, 2054, 2055, 2056, 2058]) assert.match(source, new RegExp(`(?:case |${platform === 'android' ? '' : 'case '})${id}`))
    assert.doesNotMatch(source, /400\d{3}/)
    assert.match(source, /Unsupported OpenIM callable ID/)
    if (platform === 'ios') assert.match(source, /\\\(callableID\)/)
  }
})

test('migrated Public declarations call only the PlatformDriver seam', () => {
  for (const name of PLATFORM_DRIVER_SLICE_NAMES) {
    const callable = contract.callables.find((candidate) => candidate.name === name)
    assert.notEqual(callable, undefined)
    for (const platform of ['android', 'ios'] as const) {
      const declaration = callable!.declaration[platform]
      assert.match(declaration, name === 'getSdkVersion' ? /driverCallSync\(2056,/ : /driverCallAsync\(/)
      assert.doesNotMatch(declaration, /NativeOpenIMSDK/)
    }
  }
})

test('Android wire validators use Java wrapper classes instead of unsupported typeof any', () => {
  const source = readFileSync(
    resolve(root, 'uni_modules/unix-openim-sdk/utssdk/app-android/native-call.uts'),
    'utf8',
  )
  assert.match(source, /UTSAndroid\.getJavaClass\(value\)\.name/)
  assert.match(source, /isNativeNumberValue\(raw\)/)
  assert.doesNotMatch(source, /typeof raw/)
})
