import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  assertContractSemanticHashes,
  buildStableIDRegistry,
  reconcileStableIDs,
  withComputedSemanticHashes,
  type StableIDRegistry,
} from '../src/contract-integrity.js'
import { buildSurfaceSnapshot } from '../src/generate.js'
import type { ContractDocument } from '../src/model.js'
import { verifyEventControlConsumerSurface, verifyNoLegacyEventControl } from '../src/public-surface-policy.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const contract = JSON.parse(readFileSync(resolve(root, 'contracts/base/contract.json'), 'utf8')) as ContractDocument

test('semantic verification rejects a changed declaration with a stale stored hash', () => {
  const normalized = withComputedSemanticHashes(contract)
  const changed = structuredClone(normalized)
  const upload = changed.types.find((value) => value.name === 'OpenIMUploadFileParams')
  assert.ok(upload)
  upload.declaration = upload.declaration.replace(/\n}/, '\n  futureField ?: string | null\n}')

  assert.throws(
    () => assertContractSemanticHashes(changed),
    /Semantic hash mismatch for type OpenIMUploadFileParams/,
  )
})

test('semantic verification covers callable lowering and event projections during the IR v2 lowering migration', () => {
  const normalized = withComputedSemanticHashes(contract)
  const changedCallable = structuredClone(normalized)
  const login = changedCallable.callables.find((value) => value.name === 'login')
  assert.ok(login)
  assert.ok(login.lowering?.kind === 'platform-driver')
  login.lowering.request = 'empty-object'
  assert.throws(() => assertContractSemanticHashes(changedCallable), /Semantic hash mismatch for callable login/)

  const changedEvent = structuredClone(normalized)
  const event = changedEvent.events[0]
  assert.ok(event)
  event.dispatchArguments.android = `${event.dispatchArguments.android}, payload`
  assert.throws(() => assertContractSemanticHashes(changedEvent), /Semantic hash mismatch for event/)
})

test('surface snapshots compute semantic hashes instead of trusting stored values', () => {
  const normalized = withComputedSemanticHashes(contract)
  const forged = structuredClone(normalized)
  const upload = forged.types.find((value) => value.name === 'OpenIMUploadFileParams')
  assert.ok(upload)
  upload.signatureHash = 'forged'

  assert.deepEqual(buildSurfaceSnapshot(forged), buildSurfaceSnapshot(normalized))
})

test('stable IDs survive reorder, approved rename, and insertion', () => {
  const registry: StableIDRegistry = {
    schemaVersion: 1,
    edition: 'public',
    namespaces: {
      constants: [],
      types: [],
      callables: [
        { id: 2001, name: 'off', status: 'active', previousNames: [] },
        { id: 2002, name: 'offAll', status: 'active', previousNames: [['off', 'Event'].join('')] },
        { id: 2003, name: 'login', status: 'active', previousNames: [] },
      ],
      events: [],
    },
  }

  const reconciled = reconcileStableIDs(registry, 'callables', ['login', 'offAll', 'off', 'newOperation'])
  assert.deepEqual(
    reconciled.entries.map(({ id, name }) => ({ id, name })),
    [
      { id: 2003, name: 'login' },
      { id: 2002, name: 'offAll' },
      { id: 2001, name: 'off' },
      { id: 2004, name: 'newOperation' },
    ],
  )
})

test('stable IDs reject an unapproved removal and never fill retired holes', () => {
  const registry: StableIDRegistry = {
    schemaVersion: 1,
    edition: 'enterprise-delta',
    namespaces: {
      constants: [],
      types: [],
      callables: [
        { id: 200001, name: 'offAll', status: 'retired', previousNames: [], replacement: 'public:callables:2002' },
        { id: 200002, name: 'enterpriseA', status: 'active', previousNames: [] },
      ],
      events: [],
    },
  }

  assert.throws(
    () => reconcileStableIDs(registry, 'callables', ['newEnterpriseOperation']),
    /Unapproved removal of callable enterpriseA/,
  )

  const withoutActive = structuredClone(registry)
  withoutActive.namespaces.callables[1]!.status = 'retired'
  const reconciled = reconcileStableIDs(withoutActive, 'callables', ['newEnterpriseOperation'])
  assert.equal(reconciled.entries[0]?.id, 200003)
})

test('a registry built from a contract preserves every current ID', () => {
  const registry = buildStableIDRegistry(withComputedSemanticHashes(contract))
  for (const namespace of ['constants', 'types', 'callables', 'events'] as const) {
    const expected = new Map(contract[namespace].map((value) => [value.name, value.id]))
    const actual = new Map(registry.namespaces[namespace].map((value) => [value.name, value.id]))
    assert.deepEqual(actual, expected)
  }
})

test('public event controls expose off and offAll with their stable IDs', () => {
  const controls = contract.callables
    .filter((value) => value.role === 'event-control')
    .map(({ id, name, signature }) => ({ id, name, signature }))
  assert.deepEqual(controls, [
    { id: 2001, name: 'off', signature: 'off(subscription:OpenIMSDKEventSubscription):void' },
    { id: 2002, name: 'offAll', signature: 'offAll(eventName:OpenIMSDKEventName):void' },
  ])
  assert.equal(contract.callables.some((value) => value.name === ['off', 'Event'].join('')), false)
})

test('active source and consumer exports contain no legacy event control', () => {
  verifyNoLegacyEventControl(root)
  verifyEventControlConsumerSurface(root)
})

test('generated event lifecycle uses exact handles, snapshot dispatch, and isolated handler failures', () => {
  for (const platform of ['android', 'ios'] as const) {
    const events = readFileSync(resolve(root, `uni_modules/unix-openim-sdk/utssdk/app-${platform}/events.uts`), 'utf8')
    const perEventRegistry = /switch \(subscription\.eventName\)/.test(events) && /currentID != subscriptionID/.test(events)
    const genericRegistry = /item\.id == subscription\.id && item\.eventName == subscription\.eventName/.test(events)
    assert.equal(perEventRegistry || genericRegistry, true)
    assert.match(events, /(?:dispatchSnapshot|const snapshot)/i)
    assert.match(events, /try \{/)
    assert.match(events, /export function offAllSDKEvents\(eventName : OpenIMSDKEventName\)/)
  }
})
