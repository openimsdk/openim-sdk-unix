import assert from 'node:assert/strict'
import test from 'node:test'
import { ENTERPRISE_APPLE_ANDROID_GENERATOR_AUTHORITY_INPUTS } from '../src/enterprise-generated-manifest.js'

test('apple-android generation keeps the contract projection but excludes Harmony native inputs', () => {
  assert.ok(ENTERPRISE_APPLE_ANDROID_GENERATOR_AUTHORITY_INPUTS.includes('contracts/base/contract.json'))
  assert.ok(ENTERPRISE_APPLE_ANDROID_GENERATOR_AUTHORITY_INPUTS.includes('sdk-src/native/ios/OpenIMDriverRuntime.swift'))
  assert.ok(ENTERPRISE_APPLE_ANDROID_GENERATOR_AUTHORITY_INPUTS.includes('sdk-src/uts/app-harmony/facade-projection.json'))
  assert.equal(
    ENTERPRISE_APPLE_ANDROID_GENERATOR_AUTHORITY_INPUTS.some((path) => path.includes('app-harmony/libs') || path.includes('native/harmony')),
    false,
  )
})
