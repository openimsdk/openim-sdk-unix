import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { validateAutomationEvidence } = require('../runtime/automation-evidence.cjs') as {
  validateAutomationEvidence: (input: Record<string, unknown>) => {
    passed: boolean
    checkedEvents: number
    passedEvents: number
    issues: Array<{ caseId: string; axis: string; rule: string }>
  }
}

function manifest() {
  return {
    schemaVersion: 2,
    edition: 'enterprise',
    counts: { callables: 3, events: 1 },
    callables: [
      {
        caseId: 'api/sendMessage',
        apiName: 'sendMessage',
        priority: 'P0',
        platforms: { android: 'required', ios: 'required', harmony: 'required' },
        semanticProfile: 'message-delivery-correlation',
        sideEffectProbe: 'cross-account-event-observation',
        expectedEvents: ['onSendMessageProgress', 'onRecvNewMessage'],
        validationAxes: ['completion', 'structure', 'semantic', 'side-effect', 'event'],
      },
      {
        caseId: 'api/speechToText',
        apiName: 'speechToText',
        priority: 'P2',
        capability: 'speech',
        platforms: { android: 'capability-negative', ios: 'capability-negative', harmony: 'capability-negative' },
        validationAxes: ['completion', 'structure', 'semantic'],
      },
      {
        caseId: 'api/updateFcmToken',
        apiName: 'updateFcmToken',
        priority: 'P1',
        platforms: { android: 'required', ios: 'required', harmony: 'platform-unsupported' },
        validationAxes: ['completion', 'structure', 'semantic'],
      },
    ],
    events: [
      {
        caseId: 'event/onRecvNewMessage',
        eventName: 'onRecvNewMessage',
        priority: 'P0',
        deliveryDisposition: 'required',
        platforms: { android: 'required', ios: 'required', harmony: 'required' },
        validationAxes: ['delivery', 'structure', 'semantic', 'ordering', 'epoch'],
      },
    ],
  }
}

const sendMessageProfileAssertions = [
  {
    axis: 'semantic',
    profile: 'message-delivery-correlation',
    rule: 'result-message-identity',
    expected: 'sent message identity',
    actual: 'sent message identity',
    ok: true,
  },
  {
    axis: 'side-effect',
    profile: 'cross-account-event-observation',
    rule: 'peer-delivery-observed',
    expected: 'peer delivery',
    actual: 'peer delivery',
    ok: true,
  },
]

test('a resolved Promise does not satisfy undeclared runtime validation evidence', () => {
  const result = validateAutomationEvidence({
    manifest: manifest(),
    platform: 'android',
    report: {
      cases: [{
        apiName: 'sendMessage',
        ok: true,
        skipped: false,
        invoked: true,
        resolved: true,
        responseEvidence: true,
        structureValidated: false,
        semanticValidated: false,
        sideEffectValidated: false,
        eventCorrelated: false,
      }],
      events: [],
    },
  })

  assert.equal(result.passed, false)
  assert.deepEqual(
    result.issues
      .filter((issue) => issue.caseId === 'api/sendMessage')
      .map((issue) => issue.axis),
    ['structure', 'semantic', 'side-effect', 'event'],
  )
})

test('evidence from scenario cases is aggregated by explicit apiName', () => {
  const result = validateAutomationEvidence({
    manifest: {
      ...manifest(),
      counts: { callables: 1, events: 0 },
      callables: [manifest().callables[0]],
      events: [],
    },
    platform: 'android',
    report: {
      cases: [
        {
          apiName: 'sendMessage',
          caseId: 'message-send/sendMessage',
          ok: true,
          skipped: false,
          invoked: true,
          resolved: true,
          responseEvidence: true,
          structureValidated: true,
          semanticValidated: true,
          assertions: sendMessageProfileAssertions,
        },
        {
          apiName: 'sendMessage',
          caseId: 'event-delivery/sendMessage',
          ok: true,
          skipped: false,
          invoked: true,
          resolved: true,
          responseEvidence: false,
          sideEffectValidated: true,
          eventCorrelated: true,
          assertions: sendMessageProfileAssertions,
          eventCorrelations: [
            {
              operationApiName: 'sendMessage',
              eventName: 'onSendMessageProgress',
              operationSequence: 4,
              eventSequence: 5,
              operationEpoch: 2,
              eventEpoch: 2,
              payloadMatched: true,
              correlationKind: 'payload-identity',
              payloadIdentity: 'operation-4',
              eventPayloadDetail: JSON.stringify({ operationID: 'operation-4', progress: 50 }),
              operationTerminalSequence: 7,
              exclusiveOperation: false,
            },
            {
              operationApiName: 'sendMessage',
              eventName: 'onRecvNewMessage',
              operationSequence: 4,
              eventSequence: 6,
              operationEpoch: 2,
              eventEpoch: 2,
              payloadMatched: true,
              correlationKind: 'payload-identity',
              payloadIdentity: 'message-4',
              eventPayloadDetail: JSON.stringify({ clientMsgID: 'message-4' }),
              operationTerminalSequence: 7,
              exclusiveOperation: false,
            },
          ],
        },
      ],
      events: [],
    },
  })

  assert.equal(result.passed, true)
  assert.deepEqual(result.issues, [])
})

test('a side-effect narrative cannot satisfy callable response structure', () => {
  const result = validateAutomationEvidence({
    manifest: {
      ...manifest(),
      counts: { callables: 1, events: 0 },
      callables: [manifest().callables[0]],
      events: [],
    },
    platform: 'android',
    report: {
      cases: [{
        apiName: 'sendMessage',
        ok: true,
        skipped: false,
        invoked: true,
        resolved: true,
        responseEvidence: false,
        structureValidated: true,
        semanticValidated: true,
        sideEffectValidated: true,
        eventCorrelated: true,
        detail: 'message delivered to the peer',
      }],
      events: [],
    },
  })

  assert.equal(result.passed, false)
  assert.equal(result.issues.some((issue) => issue.axis === 'structure'), true)
})

test('a callable event boolean cannot replace generated event correlations', () => {
  const result = validateAutomationEvidence({
    manifest: {
      ...manifest(),
      counts: { callables: 1, events: 0 },
      callables: [manifest().callables[0]],
      events: [],
    },
    platform: 'android',
    report: {
      cases: [{
        apiName: 'sendMessage',
        ok: true,
        invoked: true,
        resolved: true,
        responseEvidence: true,
        structureValidated: true,
        semanticValidated: true,
        sideEffectValidated: true,
        eventCorrelated: true,
      }],
      events: [],
    },
  })

  assert.equal(result.passed, false)
  assert.equal(result.issues.some((issue) => issue.axis === 'event' && issue.rule === 'event-correlation-invalid'), true)
})

test('callable event evidence covers every generated event in operation order and epoch', () => {
  const eventCase = manifest().callables[0]
  const baseCorrelation = {
    operationApiName: 'sendMessage',
    operationSequence: 10,
    operationEpoch: 3,
    eventEpoch: 3,
    payloadMatched: true,
    correlationKind: 'payload-identity',
    operationTerminalSequence: 14,
    exclusiveOperation: false,
  }
  const progressCorrelation = (overrides: Record<string, unknown> = {}) => ({
    ...baseCorrelation,
    eventName: 'onSendMessageProgress',
    eventSequence: 11,
    payloadIdentity: 'operation-10',
    eventPayloadDetail: JSON.stringify({ operationID: 'operation-10', progress: 50 }),
    ...overrides,
  })
  const receiveCorrelation = (overrides: Record<string, unknown> = {}) => ({
    ...baseCorrelation,
    eventName: 'onRecvNewMessage',
    eventSequence: 12,
    payloadIdentity: 'message-10',
    eventPayloadDetail: JSON.stringify({ clientMsgID: 'message-10' }),
    ...overrides,
  })
  const validate = (eventCorrelations: Array<Record<string, unknown>>) => validateAutomationEvidence({
    manifest: {
      ...manifest(),
      counts: { callables: 1, events: 0 },
      callables: [eventCase],
      events: [],
    },
    platform: 'ios',
    report: {
      cases: [{
        apiName: 'sendMessage',
        ok: true,
        invoked: true,
        resolved: true,
        responseEvidence: true,
        structureValidated: true,
        semanticValidated: true,
        sideEffectValidated: true,
        eventCorrelated: true,
        assertions: sendMessageProfileAssertions,
        eventCorrelations,
      }],
      events: [],
    },
  })

  const missingPeerDelivery = validate([progressCorrelation()])
  assert.equal(missingPeerDelivery.passed, false)

  const wrongEpoch = validate([
    progressCorrelation(),
    receiveCorrelation({ eventEpoch: 4 }),
  ])
  assert.equal(wrongEpoch.passed, false)

  const beforeOperation = validate([
    progressCorrelation({ eventSequence: 9 }),
    receiveCorrelation(),
  ])
  assert.equal(beforeOperation.passed, false)

  const payloadMismatch = validate([
    progressCorrelation(),
    receiveCorrelation({ payloadMatched: false }),
  ])
  assert.equal(payloadMismatch.passed, false)

  const differentOperationWindows = validate([
    progressCorrelation(),
    receiveCorrelation({ operationSequence: 12, eventSequence: 13 }),
  ])
  assert.equal(differentOperationWindows.passed, false)

  const reversedEventOrder = validate([
    progressCorrelation({ eventSequence: 13 }),
    receiveCorrelation(),
  ])
  assert.equal(reversedEventOrder.passed, false)

  const identityMissingFromPayload = validate([
    progressCorrelation(),
    receiveCorrelation({ eventPayloadDetail: JSON.stringify({ clientMsgID: 'different-message', ex: 'message-10' }) }),
  ])
  assert.equal(identityMissingFromPayload.passed, false)

  const valid = validate([
    progressCorrelation(),
    receiveCorrelation(),
  ])
  assert.equal(valid.passed, true)
  assert.deepEqual(valid.issues, [])
})

test('cross-account message delivery accepts exact peer identity after operation completion', () => {
  const eventCase = manifest().callables[0]
  const result = validateAutomationEvidence({
    manifest: {
      ...manifest(),
      counts: { callables: 1, events: 0 },
      callables: [eventCase],
      events: [],
    },
    platform: 'harmony',
    report: {
      cases: [{
        apiName: 'sendMessage',
        ok: true,
        invoked: true,
        resolved: true,
        responseEvidence: true,
        structureValidated: true,
        semanticValidated: true,
        sideEffectValidated: true,
        assertions: sendMessageProfileAssertions,
        eventCorrelations: [{
          operationApiName: 'sendMessage',
          eventName: 'onSendMessageProgress',
          operationSequence: 10,
          eventSequence: 11,
          operationEpoch: 3,
          eventEpoch: 3,
          payloadMatched: true,
          correlationKind: 'exclusive-operation-window',
          operationTerminalSequence: 12,
          exclusiveOperation: true,
          payloadIdentity: '',
          eventPayloadDetail: JSON.stringify({ operationID: null, progress: 100 }),
        }, {
          operationApiName: 'sendMessage',
          eventName: 'onRecvNewMessage',
          operationSequence: 10,
          eventSequence: 13,
          operationEpoch: 3,
          eventEpoch: 4,
          payloadMatched: true,
          correlationKind: 'cross-account-payload-identity',
          operationTerminalSequence: 12,
          exclusiveOperation: true,
          payloadIdentity: 'message-10',
          eventPayloadDetail: JSON.stringify({ clientMsgID: 'message-10' }),
        }],
      }],
      events: [],
    },
  })

  assert.equal(result.passed, true)
  assert.deepEqual(result.issues, [])
})

test('cross-account social correlation uses the declared event identity field exactly', () => {
  const cases: Array<[string, string]> = [
    ['onFriendApplicationAdded', 'fromUserID'],
    ['onFriendApplicationRejected', 'fromUserID'],
    ['onFriendAdded', 'userID'],
    ['onJoinedGroupAdded', 'groupID'],
    ['onGroupApplicationAdded', 'groupID'],
    ['onGroupMemberAdded', 'groupID'],
    ['onGroupApplicationRejected', 'groupID'],
  ]
  const validate = (eventName: string, eventPayloadDetail: string) => validateAutomationEvidence({
    manifest: {
      schemaVersion: 2,
      edition: 'public',
      counts: { callables: 1, events: 0 },
      callables: [{
        caseId: 'api/socialMutation',
        apiName: 'socialMutation',
        platforms: { android: 'required', ios: 'required', harmony: 'required' },
        expectedEvents: [eventName],
        validationAxes: ['event'],
      }],
      events: [],
    },
    platform: 'harmony',
    report: {
      cases: [{
        apiName: 'socialMutation',
        ok: true,
        eventCorrelations: [{
          operationApiName: 'socialMutation',
          eventName,
          operationSequence: 20,
          eventSequence: 22,
          operationEpoch: 5,
          eventEpoch: 6,
          payloadMatched: true,
          correlationKind: 'cross-account-payload-identity',
          operationTerminalSequence: 21,
          exclusiveOperation: true,
          payloadIdentity: 'identity-20',
          eventPayloadDetail,
        }],
      }],
      events: [],
    },
  })

  for (const [eventName, identityField] of cases) {
    assert.equal(validate(eventName, JSON.stringify({ [identityField]: 'identity-20' })).passed, true)
    assert.equal(validate(eventName, JSON.stringify({ [identityField]: 'other', ex: 'identity-20' })).passed, false)
  }
})

test('cross-account signaling correlation validates the exact room or custom payload identity', () => {
  const signalingManifest = {
    schemaVersion: 2,
    edition: 'enterprise',
    counts: { callables: 1, events: 0 },
    callables: [{
      caseId: 'api/signalingInvite',
      apiName: 'signalingInvite',
      platforms: { android: 'required', ios: 'required', harmony: 'required' },
      expectedEvents: ['onReceiveNewInvitation'],
      validationAxes: ['event'],
    }],
    events: [],
  }
  const validate = (payloadIdentity: string, eventPayloadDetail: string) => validateAutomationEvidence({
    manifest: signalingManifest,
    platform: 'harmony',
    report: {
      cases: [{
        apiName: 'signalingInvite',
        ok: true,
        eventCorrelations: [{
          operationApiName: 'signalingInvite',
          eventName: 'onReceiveNewInvitation',
          operationSequence: 10,
          eventSequence: 12,
          operationEpoch: 3,
          eventEpoch: 4,
          payloadMatched: true,
          correlationKind: 'cross-account-payload-identity',
          operationTerminalSequence: 11,
          exclusiveOperation: false,
          payloadIdentity,
          eventPayloadDetail,
        }],
      }],
      events: [],
    },
  })

  assert.equal(validate('room-1', JSON.stringify({ invitation: { roomID: 'room-1' } })).passed, true)
  assert.equal(validate('room-1', JSON.stringify(JSON.stringify({ invitation: { roomID: 'room-1' } }))).passed, true)
  assert.equal(validate('room-1', JSON.stringify({ invitation: { roomID: 'room-other' }, customInfo: 'room-1' })).passed, false)
})

test('callable semantic and side-effect PASS requires matching structured profile assertions', () => {
  const profileManifest = {
    schemaVersion: 2,
    edition: 'public',
    counts: { callables: 1, events: 0 },
    callables: [{
      caseId: 'api/setSelfInfo',
      apiName: 'setSelfInfo',
      platforms: { android: 'required', ios: 'required', harmony: 'not-in-edition' },
      semanticProfile: 'mutation-observation',
      sideEffectProbe: 'read-after-write',
      validationAxes: ['semantic', 'side-effect'],
    }],
    events: [],
  }
  const validate = (assertions: Array<Record<string, unknown>>) => validateAutomationEvidence({
    manifest: profileManifest,
    platform: 'android',
    report: {
      cases: [{
        apiName: 'setSelfInfo',
        ok: true,
        semanticValidated: true,
        sideEffectValidated: true,
        assertions,
      }],
      events: [],
    },
  })

  assert.equal(validate([]).passed, false)
  assert.equal(validate([{ axis: 'semantic', profile: 'response-identity', rule: 'wrong-profile', expected: 'x', actual: 'x', ok: true }]).passed, false)
  assert.equal(validate([
    { axis: 'semantic', profile: 'mutation-observation', rule: 'response-only', expected: 'readback', actual: 'readback', ok: true },
    { axis: 'side-effect', profile: 'read-after-write', rule: 'readback-mismatch', expected: 'new value', actual: 'old value', ok: false },
  ]).passed, false)

  const valid = validate([
    { axis: 'semantic', profile: 'mutation-observation', rule: 'input-fields-observed', expected: 'new value', actual: 'new value', ok: true },
    { axis: 'side-effect', profile: 'read-after-write', rule: 'readback-observed', expected: 'new value', actual: 'new value', ok: true },
  ])
  assert.equal(valid.passed, true)
  assert.deepEqual(valid.issues, [])
})

test('approved known issues waive only the declared callable axes for an exact platform/code match', () => {
  const knownIssueManifest = {
    schemaVersion: 2,
    edition: 'enterprise',
    counts: { callables: 1, events: 0 },
    callables: [{
      caseId: 'api/setMessageLocalContent',
      apiName: 'setMessageLocalContent',
      platforms: { android: 'required', ios: 'required', harmony: 'required' },
      semanticProfile: 'mutation-observation',
      sideEffectProbe: 'read-after-write',
      validationAxes: ['completion', 'structure', 'semantic', 'side-effect'],
      approvedKnownIssue: {
        harmony: {
          code: 'harmony-set-message-local-content-uncertified',
          waivedAxes: ['semantic', 'side-effect'],
        },
      },
    }],
    events: [],
  }

  const exactMatch = validateAutomationEvidence({
    manifest: knownIssueManifest,
    platform: 'harmony',
    report: {
      cases: [{
        apiName: 'setMessageLocalContent',
        ok: false,
        invoked: true,
        resolved: true,
        knownIssue: true,
        compatibilityDisposition: 'approved-known-issue',
        knownIssueCode: 'harmony-set-message-local-content-uncertified',
        responseEvidence: true,
        responseDetail: 'resolved acknowledgement',
      }],
      events: [],
    },
    responseSchemas: {
      schemaVersion: 1,
      callables: { setMessageLocalContent: { codec: 'string', schema: { kind: 'string' } } },
      schemas: {},
    },
  })
  assert.equal(exactMatch.passed, true)
  assert.deepEqual(exactMatch.issues, [])

  const wrongCode = validateAutomationEvidence({
    manifest: knownIssueManifest,
    platform: 'harmony',
    report: {
      cases: [{
        apiName: 'setMessageLocalContent',
        ok: false,
        invoked: true,
        resolved: true,
        knownIssue: true,
        compatibilityDisposition: 'approved-known-issue',
        knownIssueCode: 'some-other-issue',
        responseEvidence: true,
        responseDetail: 'resolved acknowledgement',
      }],
      events: [],
    },
    responseSchemas: {
      schemaVersion: 1,
      callables: { setMessageLocalContent: { codec: 'string', schema: { kind: 'string' } } },
      schemas: {},
    },
  })
  assert.equal(wrongCode.passed, false)
  assert.deepEqual(
    wrongCode.issues.map((issue) => issue.axis),
    ['completion', 'structure', 'semantic', 'side-effect'],
  )

  const undeclared = validateAutomationEvidence({
    manifest: {
      ...knownIssueManifest,
      callables: [{
        ...knownIssueManifest.callables[0],
        approvedKnownIssue: undefined,
      }],
    },
    platform: 'harmony',
    report: {
      cases: [{
        apiName: 'setMessageLocalContent',
        ok: false,
        invoked: true,
        resolved: true,
        knownIssue: true,
        compatibilityDisposition: 'approved-known-issue',
        knownIssueCode: 'harmony-set-message-local-content-uncertified',
        responseEvidence: true,
        responseDetail: 'resolved acknowledgement',
      }],
      events: [],
    },
    responseSchemas: {
      schemaVersion: 1,
      callables: { setMessageLocalContent: { codec: 'string', schema: { kind: 'string' } } },
      schemas: {},
    },
  })
  assert.equal(undeclared.passed, false)
  assert.deepEqual(
    undeclared.issues.map((issue) => issue.axis),
    ['completion', 'structure', 'semantic', 'side-effect'],
  )
})

test('approved known issues do not waive undeclared callable axes', () => {
  const result = validateAutomationEvidence({
    manifest: {
      schemaVersion: 2,
      edition: 'enterprise',
      counts: { callables: 1, events: 0 },
      callables: [{
        caseId: 'api/unInitSDK',
        apiName: 'unInitSDK',
        platforms: { android: 'required', ios: 'required', harmony: 'required' },
        responseCodec: 'void',
        responseSchema: { root: 'callables.unInitSDK.schema' },
        semanticProfile: 'mutation-observation',
        sideEffectProbe: 'none',
        validationAxes: ['completion', 'structure', 'semantic'],
        approvedKnownIssue: {
          harmony: {
            code: 'harmony-uninit-sdk-sigsegv',
            waivedAxes: ['semantic'],
          },
        },
      }],
      events: [],
    },
    responseSchemas: {
      schemaVersion: 1,
      callables: { unInitSDK: { codec: 'void', schema: { kind: 'void' } } },
      schemas: {},
    },
    platform: 'harmony',
    report: {
      cases: [{
        apiName: 'unInitSDK',
        ok: false,
        invoked: true,
        resolved: true,
        knownIssue: true,
        compatibilityDisposition: 'approved-known-issue',
        knownIssueCode: 'harmony-uninit-sdk-sigsegv',
        responseEvidence: false,
      }],
      events: [],
    },
  })

  assert.equal(result.passed, false)
  assert.deepEqual(result.issues.map((issue) => issue.axis), ['structure'])
})

test('approved known-issue waivers cannot borrow non-waived evidence from another execution', () => {
  const result = validateAutomationEvidence({
    manifest: {
      schemaVersion: 2,
      edition: 'enterprise',
      counts: { callables: 1, events: 0 },
      callables: [{
        caseId: 'api/setMessageLocalContent',
        apiName: 'setMessageLocalContent',
        platforms: { android: 'required', ios: 'required', harmony: 'required' },
        semanticProfile: 'mutation-observation',
        sideEffectProbe: 'read-after-write',
        validationAxes: ['completion', 'structure', 'semantic', 'side-effect'],
        approvedKnownIssue: {
          harmony: {
            code: 'harmony-set-message-local-content-uncertified',
            waivedAxes: ['semantic', 'side-effect'],
          },
        },
      }],
      events: [],
    },
    responseSchemas: {
      schemaVersion: 1,
      callables: { setMessageLocalContent: { codec: 'string', schema: { kind: 'string' } } },
      schemas: {},
    },
    platform: 'harmony',
    report: {
      cases: [{
        apiName: 'setMessageLocalContent',
        ok: true,
        invoked: true,
        resolved: true,
        responseEvidence: true,
        responseDetail: 'unrelated successful execution',
      }, {
        apiName: 'setMessageLocalContent',
        ok: false,
        invoked: true,
        resolved: true,
        knownIssue: true,
        compatibilityDisposition: 'approved-known-issue',
        knownIssueCode: 'harmony-set-message-local-content-uncertified',
        responseEvidence: false,
      }],
      events: [],
    },
  })

  assert.equal(result.passed, false)
  assert.deepEqual(result.issues.map((issue) => issue.axis), ['structure'])
})

test('identifier-free progress requires an exclusive start-to-terminal operation window', () => {
  const uploadManifest = {
    schemaVersion: 2,
    edition: 'public',
    counts: { callables: 1, events: 0 },
    callables: [{
      caseId: 'api/uploadFile',
      apiName: 'uploadFile',
      platforms: { android: 'required', ios: 'required', harmony: 'not-in-edition' },
      expectedEvents: ['onUploadFileProgress'],
      validationAxes: ['event'],
    }],
    events: [],
  }
  const validate = (correlation: Record<string, unknown>) => validateAutomationEvidence({
    manifest: uploadManifest,
    platform: 'android',
    report: { cases: [{ apiName: 'uploadFile', ok: true, eventCorrelations: [correlation] }], events: [] },
  })
  const base = {
    operationApiName: 'uploadFile',
    eventName: 'onUploadFileProgress',
    operationSequence: 20,
    eventSequence: 21,
    operationEpoch: 4,
    eventEpoch: 4,
    payloadMatched: true,
    correlationKind: 'exclusive-operation-window',
    payloadIdentity: '',
    eventPayloadDetail: JSON.stringify({ progress: 25 }),
    operationTerminalSequence: 22,
    exclusiveOperation: true,
  }

  assert.equal(validate(base).passed, true)
  assert.equal(validate({ ...base, exclusiveOperation: false }).passed, false)
  assert.equal(validate({ ...base, operationTerminalSequence: 21 }).passed, false)
  assert.equal(validate({ ...base, operationTerminalSequence: 0 }).passed, false)
})

test('lifecycle correlation is accepted only as a coherent ordered epoch window', () => {
  const lifecycleManifest = {
    schemaVersion: 2,
    edition: 'public',
    counts: { callables: 1, events: 0 },
    callables: [{
      caseId: 'api/login',
      apiName: 'login',
      platforms: { android: 'required', ios: 'required', harmony: 'not-in-edition' },
      expectedEvents: ['onConnecting', 'onConnectSuccess'],
      validationAxes: ['event'],
    }],
    events: [],
  }
  const correlations = ['onConnecting', 'onConnectSuccess'].map((eventName, index) => ({
    operationApiName: 'login',
    eventName,
    operationSequence: 30,
    eventSequence: 31 + index,
    operationEpoch: 5,
    eventEpoch: 5,
    payloadMatched: true,
    correlationKind: 'lifecycle-order',
    payloadIdentity: '',
    eventPayloadDetail: 'null',
    operationTerminalSequence: 0,
    exclusiveOperation: false,
  }))
  const result = validateAutomationEvidence({
    manifest: lifecycleManifest,
    platform: 'ios',
    report: { cases: [{ apiName: 'login', ok: true, eventCorrelations: correlations }], events: [] },
  })
  assert.equal(result.passed, true)
})

test('generated response schema, not a page boolean, certifies callable structure', () => {
  const schemaManifest = {
    schemaVersion: 2,
    edition: 'public',
    counts: { callables: 1, events: 0 },
    callables: [{
      caseId: 'api/getLoginStatus',
      apiName: 'getLoginStatus',
      platforms: { android: 'required', ios: 'required', harmony: 'not-in-edition' },
      responseCodec: 'number',
      responseSchema: { root: 'callables.getLoginStatus.schema' },
      validationAxes: ['completion', 'structure'],
    }],
    events: [],
  }
  const responseSchemas = {
    schemaVersion: 1,
    callables: { getLoginStatus: { codec: 'number', schema: { kind: 'number' } } },
    schemas: {},
  }
  const valid = validateAutomationEvidence({
    manifest: schemaManifest,
    responseSchemas,
    platform: 'android',
    report: { cases: [{ apiName: 'getLoginStatus', ok: true, invoked: true, resolved: true, responseEvidence: true, responseDetail: '3', structureValidated: false }], events: [] },
  })
  assert.equal(valid.passed, true)

  const invalid = validateAutomationEvidence({
    manifest: schemaManifest,
    responseSchemas,
    platform: 'android',
    report: { cases: [{ apiName: 'getLoginStatus', ok: true, invoked: true, resolved: true, responseEvidence: true, responseDetail: JSON.stringify('3'), structureValidated: true }], events: [] },
  })
  assert.equal(invalid.passed, false)
  assert.equal(invalid.issues.some((issue) => issue.rule === 'response-schema-invalid'), true)
})

test('generated response schema blocks unreviewed additive response drift', () => {
  const result = validateAutomationEvidence({
    manifest: {
      schemaVersion: 2,
      edition: 'public',
      counts: { callables: 1, events: 0 },
      callables: [{
        caseId: 'api/getSelfUserInfo',
        apiName: 'getSelfUserInfo',
        platforms: { android: 'required', ios: 'required', harmony: 'not-in-edition' },
        validationAxes: ['completion', 'structure'],
      }],
      events: [],
    },
    responseSchemas: {
      schemaVersion: 1,
      callables: {
        getSelfUserInfo: {
          codec: 'typed:User',
          schema: { kind: 'object', fields: { userID: { required: true, schema: { kind: 'string' } } } },
        },
      },
      schemas: {},
    },
    platform: 'android',
    report: {
      cases: [{
        apiName: 'getSelfUserInfo',
        ok: true,
        invoked: true,
        resolved: true,
        responseEvidence: true,
        responseDetail: JSON.stringify({ userID: 'user-1', unreviewedField: true }),
        structureValidated: true,
      }],
      events: [],
    },
  })

  assert.equal(result.passed, false)
  assert.equal(result.issues.some((issue) => issue.rule === 'response-schema-invalid'), true)
})

test('generated event schema, not typed callback arrival, certifies payload structure', () => {
  const eventManifest = {
    schemaVersion: 2,
    edition: 'public',
    counts: { callables: 0, events: 1 },
    callables: [],
    events: [{
      caseId: 'event/onRecvNewMessage',
      eventName: 'onRecvNewMessage',
      deliveryDisposition: 'required',
      platforms: { android: 'required', ios: 'required', harmony: 'not-in-edition' },
      validationAxes: ['delivery', 'structure'],
    }],
  }
  const responseSchemas = {
    schemaVersion: 1,
    callables: {},
    events: {
      onRecvNewMessage: {
        arguments: [{
          kind: 'object',
          fields: { clientMsgID: { required: true, schema: { kind: 'string' } } },
        }],
      },
    },
    schemas: {},
  }
  const valid = validateAutomationEvidence({
    manifest: eventManifest,
    responseSchemas,
    platform: 'android',
    report: { cases: [], events: [{ eventName: 'onRecvNewMessage', count: 1, deliveryValidated: true, structureValidated: false, payloadEvidence: true, payloadEncoding: 'uts-typed-json-v1', payloadDetail: JSON.stringify({ clientMsgID: 'message-1' }), payloadDetails: [JSON.stringify({ clientMsgID: 'message-1' })] }] },
  })
  assert.equal(valid.passed, true)

  const invalid = validateAutomationEvidence({
    manifest: eventManifest,
    responseSchemas,
    platform: 'android',
    report: { cases: [], events: [{ eventName: 'onRecvNewMessage', count: 2, deliveryValidated: true, structureValidated: true, payloadEvidence: true, payloadEncoding: 'uts-typed-json-v1', payloadDetail: JSON.stringify({ clientMsgID: 'message-2' }), payloadDetails: [JSON.stringify({}), JSON.stringify({ clientMsgID: 'message-2' })] }] },
  })
  assert.equal(invalid.passed, false)
  assert.equal(invalid.issues.some((issue) => issue.rule === 'event-schema-invalid'), true)
})

test('opaque string event payloads remain strings even when their contents are JSON', () => {
  const result = validateAutomationEvidence({
    manifest: {
      schemaVersion: 2,
      edition: 'enterprise',
      counts: { callables: 0, events: 1 },
      callables: [],
      events: [{
        caseId: 'event/onReceiveCustomSignaling',
        eventName: 'onReceiveCustomSignaling',
        deliveryDisposition: 'required',
        platforms: { android: 'required', ios: 'required', harmony: 'required' },
        validationAxes: ['delivery', 'structure'],
      }],
    },
    responseSchemas: {
      schemaVersion: 1,
      callables: {},
      events: {
        onReceiveCustomSignaling: {
          payloadProfile: 'opaque-string',
          arguments: [{ kind: 'string' }],
        },
      },
      schemas: {},
    },
    platform: 'harmony',
    report: {
      cases: [],
      events: [{
        eventName: 'onReceiveCustomSignaling',
        count: 1,
        deliveryValidated: true,
        payloadEvidence: true,
        payloadEncoding: 'uts-typed-json-v1',
        payloadDetails: [JSON.stringify({ customInfo: 'custom-1' })],
      }],
    },
  })

  assert.equal(result.passed, true)
  assert.deepEqual(result.issues, [])
})

test('generated event schema validates every argument in multi-argument callbacks', () => {
  const result = validateAutomationEvidence({
    manifest: {
      schemaVersion: 2,
      edition: 'public',
      counts: { callables: 0, events: 1 },
      callables: [],
      events: [{
        caseId: 'event/onConnectFailed',
        eventName: 'onConnectFailed',
        deliveryDisposition: 'required',
        platforms: { android: 'required', ios: 'required', harmony: 'not-in-edition' },
        validationAxes: ['delivery', 'structure'],
      }],
    },
    responseSchemas: {
      schemaVersion: 1,
      callables: {},
      events: { onConnectFailed: { arguments: [{ kind: 'number' }, { kind: 'string' }] } },
      schemas: {},
    },
    platform: 'ios',
    report: { cases: [], events: [{ eventName: 'onConnectFailed', count: 1, deliveryValidated: true, payloadEvidence: true, payloadDetail: JSON.stringify([-1, 'bridge failed']), payloadDetails: [JSON.stringify([-1, 'bridge failed'])] }] },
  })
  assert.equal(result.passed, true)
})

test('UTS typed-json metadata is normalized only when the evidence declares its encoding', () => {
  const schemaManifest = {
    schemaVersion: 2,
    edition: 'public',
    counts: { callables: 1, events: 0 },
    callables: [{
      caseId: 'api/getSelfUserInfo',
      apiName: 'getSelfUserInfo',
      platforms: { android: 'required', ios: 'required', harmony: 'not-in-edition' },
      validationAxes: ['completion', 'structure'],
    }],
    events: [],
  }
  const responseSchemas = {
    schemaVersion: 1,
    callables: {
      getSelfUserInfo: {
        codec: 'typed:User',
        schema: { kind: 'object', fields: { userID: { required: true, schema: { kind: 'string' } } } },
      },
    },
    schemas: {},
  }
  const responseDetail = JSON.stringify({ userID: 'user-1', propertyFields: [{}, {}] })
  const encoded = validateAutomationEvidence({
    manifest: schemaManifest,
    responseSchemas,
    platform: 'android',
    report: { cases: [{ apiName: 'getSelfUserInfo', ok: true, invoked: true, resolved: true, responseEvidence: true, responseEncoding: 'uts-typed-json-v1', responseDetail }], events: [] },
  })
  assert.equal(encoded.passed, true)

  const encodedUnknown = validateAutomationEvidence({
    manifest: schemaManifest,
    responseSchemas,
    platform: 'android',
    report: { cases: [{ apiName: 'getSelfUserInfo', ok: true, invoked: true, resolved: true, responseEvidence: true, responseEncoding: 'uts-typed-json-v1', responseDetail: JSON.stringify({ userID: 'user-1', propertyFields: [{}, {}], unreviewedField: true }) }], events: [] },
  })
  assert.equal(encodedUnknown.passed, false)

  const undeclared = validateAutomationEvidence({
    manifest: schemaManifest,
    responseSchemas,
    platform: 'android',
    report: { cases: [{ apiName: 'getSelfUserInfo', ok: true, invoked: true, resolved: true, responseEvidence: true, responseDetail }], events: [] },
  })
  assert.equal(undeclared.passed, false)
  assert.equal(undeclared.issues.some((issue) => issue.rule === 'response-schema-invalid'), true)
})

test('capability and unsupported dispositions require executable negative evidence', () => {
  const skipped = validateAutomationEvidence({
    manifest: {
      ...manifest(),
      counts: { callables: 2, events: 0 },
      callables: manifest().callables.slice(1),
      events: [],
    },
    platform: 'harmony',
    report: {
      cases: [
        { apiName: 'speechToText', skipped: true, detail: '1080 FeatureDisabled' },
        { apiName: 'updateFcmToken', skipped: true, detail: 'not exposed by HAR' },
      ],
      events: [],
    },
  })
  assert.equal(skipped.passed, false)
  assert.deepEqual(skipped.issues.map((issue) => issue.rule), ['missing-negative-evidence', 'missing-negative-evidence'])

  const verified = validateAutomationEvidence({
    manifest: {
      ...manifest(),
      counts: { callables: 2, events: 0 },
      callables: manifest().callables.slice(1),
      events: [],
    },
    platform: 'harmony',
    report: {
      cases: [
        {
          apiName: 'speechToText',
          ok: true,
          skipped: false,
          invoked: true,
          resolved: false,
          negativeValidated: true,
          negativeProfile: 'feature-disabled-1080',
          errCode: 1080,
        },
        {
          apiName: 'updateFcmToken',
          ok: true,
          skipped: false,
          invoked: true,
          resolved: false,
          negativeValidated: true,
          negativeProfile: 'platform-unsupported',
          errCode: -1,
        },
      ],
      events: [],
    },
  })
  assert.equal(verified.passed, true)
  assert.deepEqual(verified.issues, [])
})

test('event PASS requires every generated event axis', () => {
  const baseInput = {
    manifest: {
      ...manifest(),
      counts: { callables: 0, events: 1 },
      callables: [],
    },
    platform: 'android',
  }
  const incomplete = validateAutomationEvidence({
    ...baseInput,
    report: {
      cases: [],
      events: [{
        name: 'onRecvNewMessage',
        count: 1,
        deliveryValidated: true,
        structureValidated: true,
        semanticValidated: true,
        orderingValidated: false,
        epochValidated: false,
      }],
    },
  })
  assert.equal(incomplete.passed, false)
  assert.deepEqual(incomplete.issues.map((issue) => issue.axis), ['ordering', 'epoch'])

  const complete = validateAutomationEvidence({
    ...baseInput,
    report: {
      cases: [],
      events: [{
        name: 'onRecvNewMessage',
        count: 1,
        deliveryValidated: true,
        structureValidated: true,
        semanticValidated: true,
        orderingValidated: true,
        epochValidated: true,
      }],
    },
  })
  assert.equal(complete.passed, true)
})

test('an unobserved passive-only event does not satisfy or fail required runtime evidence', () => {
  const passiveManifest = manifest()
  passiveManifest.events[0] = {
    ...passiveManifest.events[0]!,
    deliveryDisposition: 'passive-only',
  }
  const result = validateAutomationEvidence({
    manifest: passiveManifest,
    report: { cases: [], events: [] },
    platform: 'android',
    fullRun: true,
  })

  assert.equal(result.checkedEvents, 0)
  assert.equal(result.passedEvents, 0)
  assert.equal(result.issues.some((item: { caseId: string }) => item.caseId === 'event/onRecvNewMessage'), false)
})
