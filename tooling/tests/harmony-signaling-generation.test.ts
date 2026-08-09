import assert from 'node:assert/strict'
import test from 'node:test'

import { harmonyObjectResponseEncoder } from '../src/harmony-bindings.js'

test('Harmony binding generation preserves signaling contract normalization', () => {
  const expected = new Map<string, string>([
    ['signalingInvite', 'OpenIMHarmonyDriver.normalizeSignalingInvitePayload(request, response)'],
    ['signalingInviteInGroup', 'OpenIMHarmonyDriver.normalizeSignalingInvitePayload(request, response)'],
    ['signalingAccept', 'OpenIMHarmonyDriver.normalizeSignalingInvitePayload(request, response)'],
    ['signalingGetTokenByRoomID', 'OpenIMHarmonyDriver.normalizeSignalingTokenPayload(response)'],
    ['signalingGetRoomByGroupID', 'OpenIMHarmonyDriver.normalizeSignalingRoomPayload(response)'],
    ['signalingGetInvitationInfoStartApp', 'OpenIMHarmonyDriver.normalizeSignalingStartAppPayload(response)'],
  ])

  for (const [methodName, expression] of expected) {
    assert.equal(harmonyObjectResponseEncoder(methodName), expression)
  }
  assert.equal(harmonyObjectResponseEncoder('getUsersInfo'), 'OpenIMHarmonyDriver.encodeObjectResponse(response)')
})
