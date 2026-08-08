import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const page = readFileSync(resolve(root, 'pages/index/index.uvue'), 'utf8')

function functionSource(name: string): string {
  const marker = `function ${name}(`
  const start = page.indexOf(marker)
  assert.notEqual(start, -1, `${name} must exist in the automation page`)
  const remainder = page.slice(start + marker.length)
  const nextFunction = remainder.search(/\n\t+function [A-Za-z]/)
  return nextFunction < 0
    ? page.slice(start)
    : page.slice(start, start + marker.length + nextFunction)
}

test('runtime cases carry explicit contract evidence instead of deriving validation from Promise success', () => {
  for (const field of [
    'invoked',
    'resolved',
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
  assert.match(page, /record\.deliveryValidated = true/)
  assert.match(page, /record\.structureValidated = true/)
  assert.doesNotMatch(page, /record\.(?:semanticValidated|orderingValidated|epochValidated) = true/)
})
