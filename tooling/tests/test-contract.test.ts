import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import type { ContractDocument, EnterpriseDeltaDocument } from '../src/model.js'
import { buildEnterpriseTestDisposition, buildPublicResponseSchemas, buildPublicTestDisposition, validateContractValue, type ContractValueSchema } from '../src/test-contract.js'

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
  assert.equal(disposition.callables.some((item) => !item.validationAxes.includes('negative') || !item.validationAxes.includes('cleanup')), false)
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
  assert.equal(disposition.events.some((item) => !item.validationAxes.includes('negative') || !item.validationAxes.includes('cleanup')), false)
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
  assert.deepEqual(byAPI.get('getAdvancedHistoryMessageList')?.validationAxes, ['completion', 'structure', 'semantic', 'negative', 'cleanup'])
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
  assert.deepEqual(byAPI.get('getLoginStatus')?.validationAxes, ['completion', 'structure', 'semantic', 'negative', 'cleanup'])
  assert.deepEqual(
    byAPI.get('onConnecting')?.validationAxes,
    ['completion', 'structure', 'semantic', 'side-effect', 'negative', 'cleanup'],
    'event subscriptions validate the returned registry handle; event delivery is verified by the event case',
  )

  const friend = byAPI.get('addFriend')
  assert.equal(friend?.semanticProfile, 'mutation-observation')
  assert.equal(friend?.sideEffectProbe, 'cross-account-event-observation')
  assert.ok(friend?.expectedEvents.includes('onFriendApplicationAdded'))
})

test('write-only app mutations require a server acknowledgement probe', () => {
  const manifest = buildPublicTestDisposition(contract)
  const byAPI = new Map(manifest.callables.map((item) => [item.apiName, item]))

  for (const apiName of ['setAppBackgroundStatus', 'setAppBadge', 'updateFcmToken']) {
    assert.equal(byAPI.get(apiName)?.semanticProfile, 'mutation-observation')
    assert.equal(byAPI.get(apiName)?.sideEffectProbe, 'server-acknowledgement')
    assert.ok(byAPI.get(apiName)?.validationAxes.includes('side-effect'))
  }
})

test('conversation visibility mutations require observable state changes', () => {
  const manifest = buildPublicTestDisposition(contract)
  const byAPI = new Map(manifest.callables.map((item) => [item.apiName, item]))

  for (const apiName of ['clearConversationAndDeleteAllMsg', 'hideConversation', 'hideAllConversations']) {
    assert.equal(byAPI.get(apiName)?.semanticProfile, 'mutation-observation')
    assert.equal(byAPI.get(apiName)?.sideEffectProbe, 'read-after-write')
    assert.ok(byAPI.get(apiName)?.validationAxes.includes('side-effect'))
  }
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
  assert.deepEqual(event?.validationAxes, ['delivery', 'structure', 'semantic', 'ordering', 'epoch', 'negative', 'cleanup'])
})

test('platform-unsupported surfaces allow their executable negative profile', () => {
  const modified = structuredClone(contract)
  const login = modified.callables.find((item) => item.name === 'login')
  const recvMessage = modified.events.find((item) => item.name === 'onRecvNewMessage')
  assert.ok(login)
  assert.ok(recvMessage)
  login.binding.android = { kind: 'unsupported', symbol: 'test-unsupported' }
  recvMessage.binding.android = 'unsupported-by-native-abi'

  const manifest = buildPublicTestDisposition(modified)
  const callable = manifest.callables.find((item) => item.apiName === 'login')
  const event = manifest.events.find((item) => item.eventName === 'onRecvNewMessage')
  assert.equal(callable?.platforms.android, 'platform-unsupported')
  assert.ok(callable?.negativeProfiles.includes('platform-unsupported'))
  assert.equal(event?.platforms.android, 'platform-unsupported')
  assert.ok(event?.negativeProfiles.includes('platform-unsupported'))
})

test('Harmony dispatcher gaps remain executable capability negatives', () => {
  const template = structuredClone(contract.callables.find((item) => item.name === 'updateFcmToken'))
  assert.ok(template)
  template.name = 'updateToken'
  template.signature = 'updateToken(params:OpenIMUpdateTokenParams,operationID?:string|null):Promise<string>'
  template.binding.harmony = { kind: 'native', symbol: 'updateToken' }
  const delta: EnterpriseDeltaDocument = {
    schemaVersion: 2,
    edition: 'enterprise-delta',
    origin: {
      kind: 'imported-facade',
      repository: 'test',
      revision: 'test',
      publicBaseRevision: 'test',
      importedPublicBaseContractHash: '0'.repeat(64),
      interfacePath: 'test',
      facadePaths: { android: 'test', ios: 'test', harmony: 'test' },
    },
    expectedTotal: { constants: 0, types: 0, callables: 1, events: 0 },
    expectedDelta: { constants: 0, types: 0, callables: 1, events: 0, typeExtensions: 0 },
    approvedBaseCallableOverrides: [],
    constants: [],
    types: [],
    typeExtensions: [],
    callables: [template],
    events: [],
  }

  const callable = buildEnterpriseTestDisposition(contract, delta).callables.find((item) => item.apiName === 'updateToken')
  assert.equal(callable?.platforms.harmony, 'capability-negative')
  assert.ok(callable?.negativeProfiles.includes('native-function-not-found-10007'))
  assert.equal(callable?.negativeProfiles.includes('platform-unsupported'), false)
})

test('Enterprise Harmony known issues are manifest-scoped and axis-specific', () => {
  const resetConversationUnread = structuredClone(contract.callables.find((item) => item.name === 'setMessageLocalEx'))
  const setMessageLocalContent = structuredClone(contract.callables.find((item) => item.name === 'setMessageLocalEx'))
  assert.ok(resetConversationUnread)
  assert.ok(setMessageLocalContent)
  resetConversationUnread.name = 'resetConversationUnread'
  resetConversationUnread.signature = 'resetConversationUnread(params:OpenIMSetMessageLocalExParams,operationID?:string|null):Promise<string>'
  resetConversationUnread.testProfile = { semanticProfile: 'response-identity', sideEffectProbe: 'none' }
  setMessageLocalContent.name = 'setMessageLocalContent'
  setMessageLocalContent.signature = 'setMessageLocalContent(params:OpenIMSetMessageLocalExParams,operationID?:string|null):Promise<string>'
  const delta: EnterpriseDeltaDocument = {
    schemaVersion: 2,
    edition: 'enterprise-delta',
    origin: {
      kind: 'imported-facade',
      repository: 'test',
      revision: 'test',
      publicBaseRevision: 'test',
      importedPublicBaseContractHash: '0'.repeat(64),
      interfacePath: 'test',
      facadePaths: { android: 'test', ios: 'test', harmony: 'test' },
    },
    expectedTotal: { constants: 0, types: 0, callables: 0, events: 0 },
    expectedDelta: { constants: 0, types: 0, callables: 0, events: 0, typeExtensions: 0 },
    approvedBaseCallableOverrides: [],
    constants: [],
    types: [],
    typeExtensions: [],
    callables: [resetConversationUnread, setMessageLocalContent],
    events: [],
  }
  const enterpriseDisposition = buildEnterpriseTestDisposition(contract, delta)
  const enterprise = new Map(enterpriseDisposition.callables.map((item) => [item.apiName, item]))

  assert.equal(enterprise.get('unInitSDK')?.approvedKnownIssue, undefined)
  assert.deepEqual(enterprise.get('resetConversationUnread')?.approvedKnownIssue, {
    harmony: {
      code: 'harmony-reset-conversation-unread-mismatch',
      waivedAxes: ['semantic'],
    },
  })
  assert.deepEqual(enterprise.get('setMessageLocalContent')?.approvedKnownIssue, {
    harmony: {
      code: 'harmony-set-message-local-content-uncertified',
      waivedAxes: ['semantic', 'side-effect'],
    },
  })
  assert.equal(enterpriseDisposition.events.some((item) => item.approvedKnownIssue != null), false)
  assert.equal(buildPublicTestDisposition(contract).callables.some((item) => item.approvedKnownIssue != null), false)
  assert.equal(buildPublicTestDisposition(contract).events.some((item) => item.approvedKnownIssue != null), false)
})

test('fixture-backed push launch remains a positive capability path', () => {
  const template = structuredClone(contract.callables.find((item) => item.name === 'updateFcmToken'))
  assert.ok(template)
  template.name = 'signalingGetInvitationInfoStartApp'
  template.signature = 'signalingGetInvitationInfoStartApp(params?:OpenIMSignalingGetInvitationInfoStartAppParams|null,operationID?:string|null):Promise<OpenIMSignalingGetInvitationInfoStartAppResult|null>'
  template.binding.harmony = { kind: 'native', symbol: 'signalingGetInvitationInfoStartApp' }
  const delta: EnterpriseDeltaDocument = {
    schemaVersion: 2,
    edition: 'enterprise-delta',
    origin: {
      kind: 'imported-facade',
      repository: 'test',
      revision: 'test',
      publicBaseRevision: 'test',
      importedPublicBaseContractHash: '0'.repeat(64),
      interfacePath: 'test',
      facadePaths: { android: 'test', ios: 'test', harmony: 'test' },
    },
    expectedTotal: { constants: 0, types: 0, callables: 1, events: 0 },
    expectedDelta: { constants: 0, types: 0, callables: 1, events: 0, typeExtensions: 0 },
    approvedBaseCallableOverrides: [],
    constants: [],
    types: [],
    typeExtensions: [],
    callables: [template],
    events: [],
  }

  const callable = buildEnterpriseTestDisposition(contract, delta).callables.find((item) => item.apiName === 'signalingGetInvitationInfoStartApp')
  assert.equal(callable?.disposition, 'capability-gated')
  assert.deepEqual(callable?.platforms, { android: 'required', ios: 'required', harmony: 'required' })
  assert.deepEqual(callable?.negativeProfiles, ['missing-push-payload', 'expired-invitation'])
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

test('allows Core C2C read receipts to omit message metadata as protobuf zero values', () => {
  const document = buildPublicResponseSchemas(contract)
  const schema = document.schemas.OpenIMMessageReceiptItem
  assert.ok(schema)
  const receipt = {
    groupID: '',
    userID: 'reader',
    msgIDList: ['client-1'],
    readTime: 1,
    msgFrom: 0,
    contentType: 0,
    sessionType: 1,
  }
  assert.deepEqual(validateContractValue(document, schema, receipt).filter((issue) => issue.severity === 'error'), [])
})

test('allows locked Core group applications to omit or null groupType', () => {
  const document = buildPublicResponseSchemas(contract)
  const schema = document.schemas.OpenIMGroupApplicationItem
  assert.ok(schema?.kind === 'object')
  const groupType = schema.fields.groupType
  assert.equal(groupType?.required, false)
  assert.deepEqual(groupType?.schema, {
    kind: 'union',
    options: [{ kind: 'number' }, { kind: 'null' }],
  })
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

test('selects an object reference union branch by runtime kind before ranking its issues', () => {
  const document = structuredClone(buildPublicResponseSchemas(contract))
  document.schemas.TestUnionObject = {
    kind: 'object',
    fields: {
      label: { required: true, schema: { kind: 'string' } },
      count: { required: true, schema: { kind: 'number' } },
    },
  }
  const schema: ContractValueSchema = {
    kind: 'union',
    options: [
      { kind: 'null' },
      { kind: 'reference', name: 'TestUnionObject' },
    ],
  }

  const issues = validateContractValue(document, schema, { label: 1, count: 'two', futureField: true })

  assert.equal(issues.some((issue) => issue.path === '$' && issue.expected === 'null'), false)
  assert.ok(issues.some((issue) => issue.path === '$.label' && issue.rule === 'type'))
  assert.ok(issues.some((issue) => issue.path === '$.count' && issue.rule === 'finite-number'))
  assert.ok(issues.some((issue) => issue.path === '$.futureField' && issue.severity === 'contract-drift'))
})
