import assert from 'node:assert/strict'
import test from 'node:test'
import { removedEventControlFixture } from '../src/consumer-compile.js'

test('negative consumer fixture replaces the public batch cancellation export', () => {
  const source = "import { offAll } from '@/uni_modules/unix-openim-sdk'\noffAll('onConnecting')\n"
  const fixture = removedEventControlFixture(source)
  assert.equal(fixture.includes('offAll'), false)
  assert.equal(fixture.includes(['off', 'Event'].join('')), true)
})
