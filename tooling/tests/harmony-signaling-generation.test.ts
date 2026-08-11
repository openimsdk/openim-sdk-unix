import assert from 'node:assert/strict'
import test from 'node:test'

import { harmonyObjectResponseEncoder } from '../src/harmony-bindings.js'

test('Harmony binding generation reads edition-owned object response encoders', () => {
  const encoders = { specialMethod: 'EditionDriver.normalize(request, response)' }
  assert.equal(harmonyObjectResponseEncoder('specialMethod', encoders), encoders.specialMethod)
  assert.equal(harmonyObjectResponseEncoder('ordinaryMethod', encoders), 'OpenIMHarmonyDriver.encodeObjectResponse(response)')
})
