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
import { generateIndex } from '../src/generate.js'

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
      { id: 2139, name: 'createTextMessage' },
      { id: 2158, name: 'sendMessage' },
      { id: 2159, name: 'sendMessageNotOss' },
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
    'createTextMessage',
    'sendMessage',
    'sendMessageNotOss',
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
    for (const id of [2051, 2052, 2053, 2054, 2055, 2056, 2058, 2139, 2158, 2159]) assert.match(source, new RegExp(`(?:case |${platform === 'android' ? '' : 'case '})${id}`))
    assert.doesNotMatch(source, /400\d{3}/)
    assert.match(source, /Unsupported OpenIM callable ID/)
    assert.match(source, /NativeOpenIMSDK\.createTextMessage/)
    assert.match(source, /NativeOpenIMSDK\.sendMessage\(/)
    assert.match(source, /NativeOpenIMSDK\.sendMessageNotOss\(/)
    if (platform === 'ios') assert.match(source, /\\\(callableID\)/)
  }
})

test('first compiler slice stores lowering data instead of platform implementation bodies', () => {
  for (const name of [...PLATFORM_DRIVER_SLICE_NAMES, 'off', 'offAll']) {
    const callable = contract.callables.find((candidate) => candidate.name === name)
    assert.notEqual(callable, undefined)
    assert.equal('declaration' in callable!, false)
    assert.notEqual(callable!.lowering, undefined)
  }

  const serialized = JSON.stringify(contract.callables.filter((callable) => (
    PLATFORM_DRIVER_SLICE_NAMES.includes(callable.name as typeof PLATFORM_DRIVER_SLICE_NAMES[number])
    || callable.name === 'off'
    || callable.name === 'offAll'
  )))
  assert.doesNotMatch(serialized, /driverCall(?:Async|Sync)|off(?:All)?SDKEvent/)
})

test('first compiler slice is rendered from lowering data for both Public platforms', () => {
  for (const platform of ['android', 'ios'] as const) {
    const source = generateIndex(root, contract, platform)
    assert.match(source, /export function off\(subscription : OpenIMSDKEventSubscription\)/)
    assert.match(source, /export function offAll\(eventName : OpenIMSDKEventName\)/)
    assert.match(source, /driverCallAsync\(2051, normalizeOperationID\(operationID\), normalizeInitConfig\(config\)/)
    assert.match(source, /driverCallAsync\(2052, normalizeOperationID\(operationID\), requestJSON/)
    assert.match(source, /driverCallSync\(2056, '', '\{\}'\)/)
    assert.match(source, /driverCallAsync\(2139, op, requestJSON/)
    assert.match(source, /driverCallAsync\(2158, readOperationID\(options\), requestJSON/)
    assert.match(source, /driverCallAsync\(2159, readOperationID\(options\), requestJSON/)
    assert.match(source, /resolveSendMessageData\(data, 'sendMessage'/)
    assert.match(source, /resolveSendMessageData\(data, 'sendMessageNotOss'/)
    for (const name of PLATFORM_DRIVER_SLICE_NAMES) {
      const declaration = source.split('\n').find((line) => line.startsWith(`export const ${name} =`))
      assert.notEqual(declaration, undefined)
      assert.doesNotMatch(declaration!, /NativeOpenIMSDK/)
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
