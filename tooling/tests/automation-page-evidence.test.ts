import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const page = readFileSync(resolve(root, 'pages/index/index.uvue'), 'utf8')

function functionSource(name: string): string {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}(?:<[^>]+>)?\\s*\\(`).exec(page)
  assert.notEqual(declaration, null, `${name} must exist in the automation page`)
  const start = declaration!.index
  const remainder = page.slice(start + declaration![0].length)
  const nextFunction = remainder.search(/\n\t+(?:async\s+)?function\s+[A-Za-z]/)
  return nextFunction < 0
    ? page.slice(start)
    : page.slice(start, start + declaration![0].length + nextFunction)
}

test('runtime cases carry explicit contract evidence instead of deriving validation from Promise success', () => {
  for (const field of [
    'invoked',
    'resolved',
    'responseEvidence',
    'structureValidated',
    'semanticValidated',
    'sideEffectValidated',
    'eventCorrelated',
  ]) {
    assert.match(page, new RegExp(`${field} : boolean`))
  }
  assert.doesNotMatch(page, /status == 'passed'\)\s*\{\s*markAutomationAPIValidated/)
  assert.doesNotMatch(functionSource('recordAutomationStep'), /markAutomationAPIValidated/)
  assert.match(page, /function recordAutomation(?:EvidenceStep|ValidatedStep)\(/)
})

test('runtime response evidence carries the resolved wire value separately from narratives', () => {
  for (const field of ['responseEncoding : string', 'responseDetail : string']) {
    assert.match(page, new RegExp(field))
  }
  const recorder = functionSource('recordAutomationCase')
  assert.match(recorder, /responseDetail \?: string \| null/)
  assert.match(recorder, /responseEvidence: responseDetail != null/)
  assert.match(recorder, /responseEncoding: responseDetail != null \? 'uts-typed-json-v1' : ''/)
  assert.match(recorder, /responseDetail: responseDetail != null \? responseDetail as string : ''/)

  const runner = functionSource('runAutomationStepWithTimeout')
  assert.match(runner, /recordAutomationCase\([^\n]+resolvedValueText\)/)
  assert.doesNotMatch(functionSource('recordAutomationStep'), /detail, detail\)/)
})

test('event subscriptions prove handle semantics and registry side effects separately', () => {
  const recorder = functionSource('recordAutomationEventSubscriptionCoverage')
  assert.match(recorder, /const handleMatched = subscription\.id\.length > 0/)
  assert.match(recorder, /const registryObserved = automationStringArrayContains\(sdkEventSubscriptionNames, eventName\)/)
  assert.match(recorder, /subscriptionAutomationEvidence\(handleMatched, registryObserved\)/)
  assert.doesNotMatch(recorder, /mutationAutomationEvidence/)
})

test('lifecycle and event-control scenarios run cleanup and registry probes without skip allowlists', () => {
  assert.match(page, /const automationAllowedSkipCaseKeys : Array<string> = \[\]/)
  assert.match(page, /const automationAllowedValidatedMissingNames : Array<string> = \[\]/)
  assert.doesNotMatch(page, /recordAutomationSkip\('cleanup', 'unInitSDK'/)
  assert.match(page, /forged-openim-subscription/)
  assert.match(page, /off\(selfRemoving as OpenIMSDKEventSubscription\)/)
  assert.match(page, /(?:survivor|second)Count/)
  assert.match(page, /offAll\('[A-Za-z]+/)
  assert.match(page, /registry\/native epoch rebind delivered/)
})

test('event reports distinguish typed delivery from semantic, ordering, and epoch proof', () => {
  for (const field of ['payloadEvidence : boolean', 'payloadEncoding : string', 'payloadDetail : string', 'payloadDetails : Array<string>']) {
    assert.match(page, new RegExp(field))
  }
  assert.match(page, /record\.deliveryValidated = true/)
  assert.match(page, /record\.structureValidated = true/)
  assert.match(page, /record\.payloadEvidence = true/)
  assert.match(page, /record\.payloadEncoding = 'uts-typed-json-v1'/)
  assert.match(page, /record\.payloadDetail = payloadText/)
  assert.match(page, /record\.payloadDetails\.push\(payloadText\)/)
  assert.match(functionSource('showSDKErrorEvent'), /recordSDKEventDelivery\(eventName, '\[' \+ errCode\.toString\(\)/)
  assert.doesNotMatch(page, /record\.(?:semanticValidated|orderingValidated|epochValidated) = true/)
})
