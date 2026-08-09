import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import type { ContractDocument } from '../src/model.js'
import { buildPublicResponseSchemas, buildPublicTestDisposition, validateContractValue, type ContractValueSchema } from '../src/test-contract.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const contract = JSON.parse(readFileSync(resolve(root, 'contracts/base/contract.json'), 'utf8')) as ContractDocument

test('classifies every public callable and event without gaps', () => {
  const schemas = buildPublicResponseSchemas(contract)
  const disposition = buildPublicTestDisposition(contract)
  assert.equal(disposition.schemaVersion, 2)
  assert.equal(schemas.counts.callables, contract.expected.callables)
  assert.equal(schemas.counts.events, contract.expected.events)
  assert.equal(disposition.callables.length, contract.expected.callables)
  assert.equal(disposition.events.length, contract.expected.events)
  assert.equal(new Set(disposition.callables.map((item) => item.apiName)).size, contract.expected.callables)
  assert.equal(new Set(disposition.events.map((item) => item.eventName)).size, contract.expected.events)
  assert.equal(disposition.callables.some((item) => item.disposition == null), false)
  assert.equal(disposition.callables.some((item) => item.platforms.android == null || item.platforms.ios == null), false)
  assert.equal(disposition.callables.some((item) => item.responseSchema.root !== `callables.${item.apiName}.schema`), false)
  assert.equal(disposition.callables.some((item) => item.semanticProfile.length === 0 || item.sideEffectProbe.length === 0), false)
  assert.equal(disposition.callables.some((item) => item.validationAxes.length === 0 || item.negativeProfiles.length === 0), false)
  assert.equal(disposition.callables.some((item) => item.cleanupAction.length === 0), false)
  assert.equal(contract.callables.some((item) => {
    const profile = (item as unknown as { testProfile?: { semanticProfile?: string; sideEffectProbe?: string } }).testProfile
    return profile == null || profile.semanticProfile == null || profile.semanticProfile.length === 0 || profile.sideEffectProbe == null || profile.sideEffectProbe.length === 0
  }), false)
  assert.equal(disposition.events.some((item) => item.deliveryDisposition == null || item.payloadProfile == null), false)
  assert.equal(disposition.events.some((item) => item.platforms.android == null || item.platforms.ios == null), false)
  assert.equal(disposition.events.some((item) => item.eventSchema.root !== `events.${item.eventName}.arguments`), false)
  assert.equal(disposition.events.some((item) => item.semanticProfile.length === 0 || item.sideEffectProbe.length === 0), false)
  assert.equal(disposition.events.some((item) => item.validationAxes.length === 0 || item.negativeProfiles.length === 0), false)
  assert.equal(disposition.events.some((item) => item.cleanupAction !== 'off(subscription)'), false)
})

test('case manifest reads callable profiles from Contract IR instead of name heuristics', () => {
  const modified = structuredClone(contract)
  const login = modified.callables.find((item) => item.name === 'login') as typeof modified.callables[number] & {
    testProfile: { semanticProfile: string; sideEffectProbe: string }
  }
  assert.ok(login)
  login.testProfile = { semanticProfile: 'contract-owned-semantic', sideEffectProbe: 'contract-owned-side-effect' }
  const item = buildPublicTestDisposition(modified).callables.find((value) => value.apiName === 'login')
  assert.equal(item?.semanticProfile, 'contract-owned-semantic')
  assert.equal(item?.sideEffectProbe, 'contract-owned-side-effect')
})

test('case manifest rejects a callable whose reviewed profile is missing', () => {
  const modified = structuredClone(contract)
  const login = modified.callables.find((item) => item.name === 'login')
  assert.ok(login)
  delete (login as unknown as { testProfile?: unknown }).testProfile
  assert.throws(
    () => buildPublicTestDisposition(modified),
    /Callable login is missing testProfile\.semanticProfile/,
  )
})

test('case manifest assigns concrete semantic and side-effect probes to P0 flows', () => {
  const manifest = buildPublicTestDisposition(contract)
  const byAPI = new Map(manifest.callables.map((item) => [item.apiName, item]))
  assert.deepEqual(byAPI.get('getAdvancedHistoryMessageList')?.validationAxes, ['completion', 'structure', 'semantic'])
  assert.equal(byAPI.get('getAdvancedHistoryMessageList')?.semanticProfile, 'pagination-integrity')
  assert.equal(byAPI.get('sendMessage')?.semanticProfile, 'message-delivery-correlation')
  assert.equal(byAPI.get('sendMessage')?.sideEffectProbe, 'cross-account-event-observation')
  assert.deepEqual(byAPI.get('sendMessage')?.expectedEvents, ['onSendMessageProgress', 'onRecvNewMessage'])
  assert.equal(byAPI.get('setSelfInfo')?.sideEffectProbe, 'read-after-write')
  assert.equal(byAPI.get('setSelfInfo')?.cleanupAction, 'restore-via-read-before-write')
  assert.equal(byAPI.get('uploadFile')?.semanticProfile, 'progress-terminal-correlation')
  assert.equal(byAPI.get('uploadFile')?.cleanupAction, 'cancelUpload(cancelID)')
  assert.equal(byAPI.get('offAll')?.semanticProfile, 'subscription-lifecycle')
  assert.equal(byAPI.get('offAll')?.sideEffectProbe, 'registry-observation')
  assert.equal(byAPI.get('getLoginStatus')?.sideEffectProbe, 'none')
  assert.equal(byAPI.get('getLoginUserID')?.sideEffectProbe, 'none')
  assert.deepEqual(byAPI.get('getLoginStatus')?.validationAxes, ['completion', 'structure', 'semantic'])
  assert.deepEqual(
    byAPI.get('onConnecting')?.validationAxes,
    ['completion', 'structure', 'semantic', 'side-effect'],
    'event subscriptions validate the returned registry handle; event delivery is verified by the event case',
  )

  const friend = byAPI.get('addFriend')
  assert.equal(friend?.semanticProfile, 'mutation-observation')
  assert.equal(friend?.sideEffectProbe, 'cross-account-event-observation')
  assert.ok(friend?.expectedEvents.includes('onFriendApplicationAdded'))
})

test('case manifest makes edition boundaries and cancelled subscriptions explicit', () => {
  const manifest = buildPublicTestDisposition(contract)
  const login = manifest.callables.find((item) => item.apiName === 'login')
  assert.equal(login?.platforms.android, 'required')
  assert.equal(login?.platforms.ios, 'required')
  assert.equal(login?.platforms.harmony, 'not-in-edition')
  assert.ok(login?.negativeProfiles.includes('invalid-token'))

  const event = manifest.events.find((item) => item.eventName === 'onRecvNewMessage')
  assert.deepEqual(event?.expectedEvents, ['onRecvNewMessage'])
  assert.deepEqual(event?.negativeProfiles, ['off-subscription', 'off-all-event-name', 'stale-epoch'])
  assert.deepEqual(event?.validationAxes, ['delivery', 'structure', 'semantic', 'ordering', 'epoch'])
})

test('every callable and event response root has a closed concrete schema graph', () => {
  const document = buildPublicResponseSchemas(contract)
  const reachable = new Set<string>()
  const visit = (schema: ContractValueSchema): void => {
    assert.notEqual(schema.kind, 'any')
    if (schema.kind === 'reference') {
      if (reachable.has(schema.name)) return
      reachable.add(schema.name)
      const target = document.schemas[schema.name]
      assert.ok(target, `missing response schema reference ${schema.name}`)
      visit(target)
    } else if (schema.kind === 'array') {
      visit(schema.items)
    } else if (schema.kind === 'union') {
      schema.options.forEach(visit)
    } else if (schema.kind === 'object') {
      Object.values(schema.fields).forEach((field) => visit(field.schema))
    }
  }
  Object.values(document.callables).forEach((root) => visit(root.schema))
  Object.values(document.events).forEach((root) => root.arguments.forEach(visit))
  assert.equal(reachable.size, 65)
})

test('rejects missing and wrongly typed advanced history fields', () => {
  const document = buildPublicResponseSchemas(contract)
  const rootSchema = document.callables.getAdvancedHistoryMessageList?.schema
  assert.ok(rootSchema)
  const valid = { messageList: [], lastMinSeq: 0, isEnd: true, errCode: 0, errMsg: '' }
  assert.deepEqual(validateContractValue(document, rootSchema, valid).filter((issue) => issue.severity === 'error'), [])

  const { lastMinSeq: _omitted, ...missingLastMinSeq } = valid
  assert.ok(validateContractValue(document, rootSchema, missingLastMinSeq).some((issue) => issue.path === '$.lastMinSeq' && issue.rule === 'required'))
  assert.ok(validateContractValue(document, rootSchema, { ...valid, isEnd: 'true' }).some((issue) => issue.path === '$.isEnd' && issue.rule === 'type'))
})

test('requires message isRead to remain a boolean', () => {
  const document = buildPublicResponseSchemas(contract)
  const schema = document.schemas.OpenIMMessageItem
  assert.ok(schema)
  const message = {
    clientMsgID: 'client-1', serverMsgID: 'server-1', createTime: 1, sendTime: 2,
    sessionType: 1, sendID: 'user-a', recvID: 'user-b', msgFrom: 100,
    contentType: 101, senderPlatformID: 2, senderNickname: 'A', senderFaceUrl: '',
    groupID: '', content: 'hello', seq: 1, isRead: false, status: 2,
    attachedInfo: '', ex: '', localEx: '',
  }
  assert.deepEqual(validateContractValue(document, schema, message).filter((issue) => issue.severity === 'error'), [])
  assert.ok(validateContractValue(document, schema, { ...message, isRead: 0 }).some((issue) => issue.path === '$.isRead' && issue.rule === 'type'))
})

test('reports additive response fields as contract drift instead of structural failure', () => {
  const document = buildPublicResponseSchemas(contract)
  const schema = document.schemas.OpenIMAdvancedHistoryMessageListResult
  assert.ok(schema)
  const issues = validateContractValue(document, schema, { messageList: [], lastMinSeq: 0, isEnd: true, errCode: 0, errMsg: '', futureField: 'value' })
  assert.equal(issues.some((issue) => issue.severity === 'error'), false)
  assert.ok(issues.some((issue) => issue.path === '$.futureField' && issue.severity === 'contract-drift'))
})

test('preserves additive response drift from the selected union branch', () => {
  const document = buildPublicResponseSchemas(contract)
  const schema: ContractValueSchema = {
    kind: 'union',
    options: [
      { kind: 'null' },
      { kind: 'object', fields: { value: { required: true, schema: { kind: 'string' } } } },
    ],
  }
  const issues = validateContractValue(document, schema, { value: 'ok', futureField: true })
  assert.equal(issues.some((issue) => issue.severity === 'error'), false)
  assert.ok(issues.some((issue) => issue.path === '$.futureField' && issue.severity === 'contract-drift'))
})
