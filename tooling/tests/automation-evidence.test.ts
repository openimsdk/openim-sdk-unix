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
