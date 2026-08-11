import assert from 'node:assert/strict'
import test from 'node:test'
import { isNativeDeploymentTargetCompatible } from '../src/private-native.js'

test('an older native iOS deployment target remains compatible with a higher plugin minimum', () => {
  assert.equal(isNativeDeploymentTargetCompatible('12.0', '14.0'), true)
  assert.equal(isNativeDeploymentTargetCompatible('14.0', '14'), true)
  assert.equal(isNativeDeploymentTargetCompatible('14.1', '14.0'), false)
})
