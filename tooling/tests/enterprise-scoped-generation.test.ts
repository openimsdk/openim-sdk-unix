import assert from 'node:assert/strict'
import test from 'node:test'
import { ENTERPRISE_APPLE_ANDROID_GENERATOR_AUTHORITY_INPUTS } from '../src/enterprise-generated-manifest.js'
import { ENTERPRISE_HARMONY_PROJECTION_PATH } from '../src/enterprise-compose.js'
import { canonicalCapabilityNames, countHarmonyBoundEvents } from '../src/enterprise-contract.js'

test('apple-android generation keeps the contract projection but excludes Harmony native inputs', () => {
  assert.equal(ENTERPRISE_HARMONY_PROJECTION_PATH, 'sdk-src/uts/app-harmony/facade-projection.json')
  assert.ok(ENTERPRISE_APPLE_ANDROID_GENERATOR_AUTHORITY_INPUTS.includes('contracts/base/contract.json'))
  assert.ok(ENTERPRISE_APPLE_ANDROID_GENERATOR_AUTHORITY_INPUTS.includes('sdk-src/native/ios/OpenIMDriverRuntime.swift'))
  assert.ok(ENTERPRISE_APPLE_ANDROID_GENERATOR_AUTHORITY_INPUTS.includes('sdk-src/uts/app-harmony/facade-projection.json'))
  assert.equal(
    ENTERPRISE_APPLE_ANDROID_GENERATOR_AUTHORITY_INPUTS.some((path) => path.includes('app-harmony/libs') || path.includes('native/harmony')),
    false,
  )
})

test('edition capability inventories compare as canonical sets', () => {
  assert.deepEqual(canonicalCapabilityNames(['second', 'first', 'second']), ['first', 'second'])
})

test('Harmony native event count excludes projected and unsupported events', () => {
  assert.equal(countHarmonyBoundEvents([
    { binding: 'bound' },
    { binding: 'projected' },
    { binding: 'unsupported-by-native-abi' },
  ]), 1)
})
