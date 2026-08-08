import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { validateAutomationEvidence } = require('../runtime/automation-evidence.cjs') as {
  validateAutomationEvidence: (input: Record<string, unknown>) => {
    passed: boolean
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
