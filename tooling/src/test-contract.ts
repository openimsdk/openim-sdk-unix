import ts from 'typescript'
import type { ContractCallable, ContractDocument, ContractEvent, ContractType, EnterpriseDeltaDocument, EnterpriseTypeExtension } from './model.js'
import { requireCallableTestProfile } from './test-profile.js'

export type ContractValueSchema =
  | { kind: 'any' }
  | { kind: 'void' }
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'null' }
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'array'; items: ContractValueSchema }
  | { kind: 'reference'; name: string }
  | { kind: 'union'; options: ContractValueSchema[] }
  | { kind: 'object'; fields: Record<string, { required: boolean; schema: ContractValueSchema }> }

export interface ResponseSchemaDocument {
  schemaVersion: 1
  edition: 'public' | 'enterprise'
  counts: { schemas: number; callables: number; events: number }
  schemas: Record<string, ContractValueSchema>
  callables: Record<string, { codec: string; schema: ContractValueSchema }>
  events: Record<string, { handlerType: string; payloadProfile: 'void' | 'typed' | 'scalar' | 'opaque-string'; arguments: ContractValueSchema[] }>
}

export type TestDisposition = 'required' | 'capability-gated' | 'platform-unsupported' | 'negative-only' | 'diagnostic-only'
export type EventDeliveryDisposition = 'required' | 'passive-only' | 'platform-unsupported'
export type PlatformTestDisposition = 'required' | 'capability-negative' | 'platform-unsupported' | 'not-in-edition'
export type CallableValidationAxis = 'completion' | 'structure' | 'semantic' | 'side-effect' | 'event' | 'negative' | 'cleanup'
export type EventValidationAxis = 'delivery' | 'structure' | 'semantic' | 'ordering' | 'epoch' | 'negative' | 'cleanup'
export type WaivableCallableValidationAxis = Exclude<CallableValidationAxis, 'negative' | 'cleanup'>
export type WaivableEventValidationAxis = Exclude<EventValidationAxis, 'negative' | 'cleanup'>
export interface ApprovedKnownIssueDisposition {
  code: string
  waivedAxes: WaivableCallableValidationAxis[]
}

export interface ApprovedEventKnownIssueDisposition {
  code: string
  evidenceApiName: string
  waivedAxes: WaivableEventValidationAxis[]
}

export interface TestDispositionDocument {
  schemaVersion: 2
  edition: 'public' | 'enterprise'
  counts: { callables: number; events: number }
  callables: Array<{
    caseId: string
    apiName: string
    priority: 'P0' | 'P1' | 'P2'
    disposition: TestDisposition
    capability: string
    responseCodec: string
    platforms: { android: PlatformTestDisposition; ios: PlatformTestDisposition; harmony: PlatformTestDisposition }
    responseSchema: { document: string; root: string }
    semanticProfile: string
    sideEffectProbe: string
    expectedEvents: string[]
    negativeProfiles: string[]
    cleanupAction: string
    validationAxes: CallableValidationAxis[]
    approvedKnownIssue?: Partial<Record<'android' | 'ios' | 'harmony', ApprovedKnownIssueDisposition>>
  }>
  events: Array<{
    caseId: string
    eventName: string
    priority: 'P0' | 'P1' | 'P2'
    deliveryDisposition: EventDeliveryDisposition
    payloadProfile: 'void' | 'typed' | 'scalar' | 'opaque-string'
    platforms: { android: PlatformTestDisposition; ios: PlatformTestDisposition; harmony: PlatformTestDisposition }
    eventSchema: { document: string; root: string }
    semanticProfile: string
    sideEffectProbe: string
    expectedEvents: string[]
    negativeProfiles: string[]
    cleanupAction: string
    validationAxes: EventValidationAxis[]
    approvedKnownIssue?: Partial<Record<'android' | 'ios' | 'harmony', ApprovedEventKnownIssueDisposition>>
  }>
}

export interface SchemaValidationIssue {
  path: string
  rule: string
  expected: string
  actual: string
  severity: 'error' | 'contract-drift'
}

const p0CallableNames = new Set([
  'initSDK', 'login', 'logout', 'unInitSDK', 'getLoginStatus', 'getLoginUserID',
  'getSelfUserInfo', 'setSelfInfo', 'getUsersInfo', 'subscribeUsersStatus', 'unsubscribeUsersStatus',
  'createTextMessage', 'sendMessage', 'sendMessageNotOss', 'getAdvancedHistoryMessageList',
  'getAllConversationList', 'getOneConversation', 'setConversation', 'setConversationDraft',
  'markConversationMessageAsRead', 'getFriendList', 'addFriend', 'acceptFriendApplication',
  'createGroup', 'getSpecifiedGroupsInfo', 'getGroupMemberList', 'sendGroupMessageReceipt',
  'uploadFile', 'cancelUpload',
  'off', 'offAll',
])

const p0EventNames = new Set([
  'onConnecting', 'onConnectSuccess', 'onConnectFailed', 'onSyncServerStart', 'onSyncServerFinish',
  'onRecvNewMessage', 'onRecvOfflineNewMessage', 'onConversationChanged', 'onNewConversation',
  'onTotalUnreadMessageCountChanged', 'onSendMessageProgress', 'onUploadFileProgress',
  'onFriendApplicationAdded', 'onFriendAdded', 'onGroupApplicationAdded', 'onGroupMemberAdded',
])

const enterpriseHarmonyApprovedKnownIssues = new Map<string, ApprovedKnownIssueDisposition>([
  ['resetConversationUnread', {
    code: 'harmony-reset-conversation-unread-mismatch',
    waivedAxes: ['semantic'],
  }],
  ['setMessageLocalContent', {
    code: 'harmony-set-message-local-content-uncertified',
    waivedAxes: ['semantic', 'side-effect'],
  }],
])

const expectedEventsByCallable = new Map<string, string[]>([
  ['login', ['onConnecting', 'onConnectSuccess', 'onSyncServerStart', 'onSyncServerFinish']],
  ['sendMessage', ['onSendMessageProgress', 'onRecvNewMessage']],
  ['sendMessageNotOss', ['onSendMessageProgress', 'onRecvNewMessage']],
  ['uploadFile', ['onUploadFileProgress']],
  ['uploadLogs', ['onUploadLogsProgress']],
  ['addFriend', ['onFriendApplicationAdded']],
  ['acceptFriendApplication', ['onFriendAdded']],
  ['refuseFriendApplication', ['onFriendApplicationRejected']],
  ['createGroup', ['onJoinedGroupAdded']],
  ['joinGroup', ['onGroupApplicationAdded']],
  ['acceptGroupApplication', ['onGroupMemberAdded']],
  ['refuseGroupApplication', ['onGroupApplicationRejected']],
])

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function parseAlias(declaration: string): ts.TypeAliasDeclaration {
  const source = ts.createSourceFile('contract-type.uts', declaration, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const alias = source.statements.find(ts.isTypeAliasDeclaration)
  assert(alias != null, `Cannot parse type declaration: ${declaration}`)
  return alias
}

function propertyName(node: ts.PropertyName): string {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text
  throw new Error(`Unsupported contract property name: ${node.getText()}`)
}

function schemaFromNode(node: ts.TypeNode): ContractValueSchema {
  if (node.kind === ts.SyntaxKind.AnyKeyword || node.kind === ts.SyntaxKind.UnknownKeyword) return { kind: 'any' }
  if (node.kind === ts.SyntaxKind.VoidKeyword || node.kind === ts.SyntaxKind.UndefinedKeyword) return { kind: 'void' }
  if (node.kind === ts.SyntaxKind.StringKeyword) return { kind: 'string' }
  if (node.kind === ts.SyntaxKind.NumberKeyword) return { kind: 'number' }
  if (node.kind === ts.SyntaxKind.BooleanKeyword) return { kind: 'boolean' }
  if (node.kind === ts.SyntaxKind.NullKeyword) return { kind: 'null' }
  if (ts.isParenthesizedTypeNode(node)) return schemaFromNode(node.type)
  if (ts.isLiteralTypeNode(node)) {
    if (node.literal.kind === ts.SyntaxKind.NullKeyword) return { kind: 'null' }
    if (ts.isStringLiteral(node.literal)) return { kind: 'literal', value: node.literal.text }
    if (ts.isNumericLiteral(node.literal)) return { kind: 'literal', value: Number(node.literal.text) }
    if (ts.isPrefixUnaryExpression(node.literal) && ts.isNumericLiteral(node.literal.operand)) {
      const value = Number(node.literal.operand.text)
      return { kind: 'literal', value: node.literal.operator === ts.SyntaxKind.MinusToken ? -value : value }
    }
    if (node.literal.kind === ts.SyntaxKind.TrueKeyword) return { kind: 'literal', value: true }
    if (node.literal.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'literal', value: false }
  }
  if (ts.isUnionTypeNode(node)) return { kind: 'union', options: node.types.map(schemaFromNode) }
  if (ts.isArrayTypeNode(node)) return { kind: 'array', items: schemaFromNode(node.elementType) }
  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText()
    if (name === 'Array') {
      assert(node.typeArguments?.length === 1, 'Array contract type must have exactly one type argument')
      return { kind: 'array', items: schemaFromNode(node.typeArguments[0]!) }
    }
    return { kind: 'reference', name }
  }
  if (ts.isTypeLiteralNode(node)) {
    const fields: Record<string, { required: boolean; schema: ContractValueSchema }> = {}
    for (const member of node.members) {
      assert(ts.isPropertySignature(member) && member.name != null && member.type != null, `Unsupported object member: ${member.getText()}`)
      fields[propertyName(member.name)] = { required: member.questionToken == null, schema: schemaFromNode(member.type) }
    }
    return { kind: 'object', fields }
  }
  throw new Error(`Unsupported contract type node: ${ts.SyntaxKind[node.kind]} ${node.getText()}`)
}

function schemaFromText(typeText: string): ContractValueSchema {
  return schemaFromNode(parseAlias(`type ContractRoot = ${typeText}`).type)
}

function schemaMap(types: ContractType[]): Record<string, ContractValueSchema> {
  const result: Record<string, ContractValueSchema> = {}
  for (const type of types) {
    const alias = parseAlias(type.declaration)
    if (!ts.isFunctionTypeNode(alias.type)) result[type.name] = schemaFromNode(alias.type)
  }
  return result
}

function functionArguments(type: ContractType): ContractValueSchema[] {
  const alias = parseAlias(type.declaration)
  assert(ts.isFunctionTypeNode(alias.type), `${type.name} is not an event handler function type`)
  return alias.type.parameters.map((parameter) => parameter.type == null ? { kind: 'any' } : schemaFromNode(parameter.type))
}

function callableSchema(callable: ContractCallable): ContractValueSchema {
  if (callable.role === 'event-subscription') return { kind: 'reference', name: 'OpenIMSDKEventSubscription' }
  if (callable.responseCodec.startsWith('typed:')) return schemaFromText(callable.responseCodec.slice('typed:'.length))
  if (callable.responseCodec === 'boolean') return { kind: 'boolean' }
  if (callable.responseCodec === 'number') return { kind: 'number' }
  if (callable.responseCodec === 'raw-string') return { kind: 'string' }
  if (callable.responseCodec === 'void' || callable.role === 'event-control') return { kind: 'void' }
  return { kind: 'any' }
}

function eventPayloadProfile(event: ContractEvent, args: ContractValueSchema[]): 'void' | 'typed' | 'scalar' | 'opaque-string' {
  if (event.rawPayload) return 'opaque-string'
  if (args.length === 0) return 'void'
  if (args.every((value) => value.kind === 'string' || value.kind === 'number' || value.kind === 'boolean')) return 'scalar'
  return 'typed'
}

function applyExtensions(schemas: Record<string, ContractValueSchema>, extensions: EnterpriseTypeExtension[]): void {
  for (const extension of extensions) {
    const target = schemas[extension.target]
    assert(target != null, `Type extension target is missing: ${extension.target}`)
    if (extension.kind === 'optional-object-members') {
      assert(target.kind === 'object', `Object extension target is not an object: ${extension.target}`)
      for (const memberText of extension.addedMembers) {
        const memberSchema = schemaFromNode(parseAlias(`type Extension = { ${memberText} }`).type)
        assert(memberSchema.kind === 'object', `Cannot parse object extension member: ${memberText}`)
        Object.assign(target.fields, memberSchema.fields)
      }
    } else {
      assert(target.kind === 'union', `Union extension target is not a union: ${extension.target}`)
      for (const memberText of extension.addedMembers) target.options.push(schemaFromText(memberText))
    }
  }
}

function buildResponseSchemas(
  edition: 'public' | 'enterprise',
  types: ContractType[],
  callables: ContractCallable[],
  events: ContractEvent[],
  extensions: EnterpriseTypeExtension[] = [],
): ResponseSchemaDocument {
  const schemas = schemaMap(types)
  applyExtensions(schemas, extensions)
  const typeByName = new Map(types.map((value) => [value.name, value]))
  const callableRoots: ResponseSchemaDocument['callables'] = {}
  for (const callable of callables) callableRoots[callable.name] = { codec: callable.responseCodec, schema: callableSchema(callable) }
  const eventRoots: ResponseSchemaDocument['events'] = {}
  for (const event of events) {
    const handler = typeByName.get(event.handlerType)
    assert(handler != null, `Missing event handler type ${event.handlerType}`)
    const args = functionArguments(handler)
    eventRoots[event.name] = { handlerType: event.handlerType, payloadProfile: eventPayloadProfile(event, args), arguments: args }
  }
  return {
    schemaVersion: 1,
    edition,
    counts: { schemas: Object.keys(schemas).length, callables: callables.length, events: events.length },
    schemas,
    callables: callableRoots,
    events: eventRoots,
  }
}

export function buildPublicResponseSchemas(contract: ContractDocument): ResponseSchemaDocument {
  return buildResponseSchemas('public', contract.types, contract.callables, contract.events)
}

export function buildEnterpriseResponseSchemas(base: ContractDocument, delta: EnterpriseDeltaDocument): ResponseSchemaDocument {
  return buildResponseSchemas('enterprise', [...base.types, ...delta.types], [...base.callables, ...delta.callables], [...base.events, ...delta.events], delta.typeExtensions)
}

function callablePlatformDisposition(
  edition: 'public' | 'enterprise',
  callable: ContractCallable,
  capability: string,
  platform: 'android' | 'ios' | 'harmony',
): PlatformTestDisposition {
  if (edition === 'public' && platform === 'harmony') return 'not-in-edition'
  if (callable.binding[platform]?.kind === 'unsupported') return 'platform-unsupported'
  if (capability !== 'core') return 'capability-negative'
  return 'required'
}

function eventPlatformDisposition(
  edition: 'public' | 'enterprise',
  event: ContractEvent,
  platform: 'android' | 'ios' | 'harmony',
): PlatformTestDisposition {
  if (edition === 'public' && platform === 'harmony') return 'not-in-edition'
  return event.binding[platform] === 'unsupported-by-native-abi' ? 'platform-unsupported' : 'required'
}

function negativeProfiles(callable: ContractCallable, capability: string): string[] {
  if (callable.role === 'event-control') return ['forged-or-stale-subscription', 'callback-removal-during-dispatch']
  if (callable.role === 'event-subscription') return ['off-subscription', 'off-all-event-name', 'stale-epoch']
  if (capability === 'speech' || capability === 'translation') return ['feature-disabled-1080', 'invalid-input']
  if (capability === 'push-launch') return ['missing-push-payload', 'expired-invitation']
  if (callable.name === 'initSDK') return ['invalid-config', 'duplicate-init']
  if (callable.name === 'login') return ['uninitialized', 'invalid-token']
  if (callable.name === 'getSdkVersion' || callable.name === 'getOpenIMDataPath') return ['unsupported-callable-id']
  return ['uninitialized', 'invalid-input']
}

function executableNegativeProfiles(
  profiles: string[],
  platforms: { android: PlatformTestDisposition; ios: PlatformTestDisposition; harmony: PlatformTestDisposition },
): string[] {
  const executable = new Set(profiles)
  if (Object.values(platforms).includes('platform-unsupported')) executable.add('platform-unsupported')
  return [...executable]
}

function cleanupAction(callable: ContractCallable, probe: string): string {
  if (callable.role === 'event-subscription') return 'off(subscription)'
  if (callable.role === 'event-control') return 'none'
  if (callable.name === 'initSDK') return 'unInitSDK()'
  if (callable.name === 'login') return 'logout()'
  if (callable.name === 'uploadFile' || callable.name === 'uploadLogs') return 'cancelUpload(cancelID)'
  if (probe === 'read-after-write') return 'restore-via-read-before-write'
  if (probe === 'cross-account-event-observation') return 'fixture-cleanup'
  if (probe === 'cross-account-state-observation') return 'restore-via-inverse-mutation'
  return 'none'
}

function callableValidationAxes(callable: ContractCallable, probe: string, expectedEvents: string[]): CallableValidationAxis[] {
  const axes: CallableValidationAxis[] = ['completion']
  if (callable.role === 'event-control') {
    axes.push('semantic', 'side-effect', 'negative', 'cleanup')
    return axes
  }
  axes.push('structure', 'semantic')
  if (probe !== 'none') axes.push('side-effect')
  if (expectedEvents.length > 0 && callable.role === 'operation') axes.push('event')
  axes.push('negative', 'cleanup')
  return axes
}

function buildDisposition(
  edition: 'public' | 'enterprise',
  callables: ContractCallable[],
  events: ContractEvent[],
  responseSchemas: ResponseSchemaDocument,
): TestDispositionDocument {
  const responseSchemaDocument = edition === 'public'
    ? 'contracts/base/response-schemas.json'
    : 'contracts/enterprise/response-schemas.json'
  return {
    schemaVersion: 2,
    edition,
    counts: { callables: callables.length, events: events.length },
    callables: callables.map((callable) => {
      const capability = 'core'
      const unsupported = callable.binding.android?.kind === 'unsupported' && callable.binding.ios?.kind === 'unsupported'
      const { semanticProfile: profile, sideEffectProbe: probe } = requireCallableTestProfile(callable)
      const expectedEvents = callable.role === 'event-subscription'
        ? [callable.name]
        : [...(expectedEventsByCallable.get(callable.name) ?? [])]
      const platforms = {
        android: callablePlatformDisposition(edition, callable, capability, 'android'),
        ios: callablePlatformDisposition(edition, callable, capability, 'ios'),
        harmony: callablePlatformDisposition(edition, callable, capability, 'harmony'),
      }
      const validationAxes = callableValidationAxes(callable, probe, expectedEvents)
      const approvedKnownIssue = edition === 'enterprise'
        ? enterpriseHarmonyApprovedKnownIssues.get(callable.name)
        : undefined
      if (approvedKnownIssue != null) {
        assert(
          approvedKnownIssue.waivedAxes.every((axis) => validationAxes.includes(axis)),
          `${callable.name} approved known issue waives an axis that is not required by its contract`,
        )
      }
      return {
        caseId: `api/${callable.name}`,
        apiName: callable.name,
        priority: capability !== 'core' ? 'P2' : p0CallableNames.has(callable.name) || callable.role !== 'operation' ? 'P0' : 'P1',
        disposition: unsupported ? 'platform-unsupported' : capability !== 'core' ? 'capability-gated' : 'required',
        capability,
        responseCodec: callable.responseCodec,
        platforms,
        responseSchema: { document: responseSchemaDocument, root: `callables.${callable.name}.schema` },
        semanticProfile: profile,
        sideEffectProbe: probe,
        expectedEvents,
        negativeProfiles: executableNegativeProfiles(negativeProfiles(callable, capability), platforms),
        cleanupAction: cleanupAction(callable, probe),
        validationAxes,
        ...(approvedKnownIssue == null ? {} : {
          approvedKnownIssue: {
            harmony: {
              code: approvedKnownIssue.code,
              waivedAxes: [...approvedKnownIssue.waivedAxes],
            },
          },
        }),
      }
    }),
    events: events.map((event) => {
      const unsupported = event.binding.android === 'unsupported-by-native-abi' && event.binding.ios === 'unsupported-by-native-abi'
      const platforms = {
        android: eventPlatformDisposition(edition, event, 'android'),
        ios: eventPlatformDisposition(edition, event, 'ios'),
        harmony: eventPlatformDisposition(edition, event, 'harmony'),
      }
      return {
        caseId: `event/${event.name}`,
        eventName: event.name,
        priority: p0EventNames.has(event.name) ? 'P0' : 'P1',
        deliveryDisposition: unsupported ? 'platform-unsupported' : p0EventNames.has(event.name) ? 'required' : 'passive-only',
        payloadProfile: responseSchemas.events[event.name]!.payloadProfile,
        platforms,
        eventSchema: { document: responseSchemaDocument, root: `events.${event.name}.arguments` },
        semanticProfile: event.rawPayload ? 'opaque-event-correlation' : 'typed-event-correlation',
        sideEffectProbe: 'emitted-event-observation',
        expectedEvents: [event.name],
        negativeProfiles: executableNegativeProfiles(['off-subscription', 'off-all-event-name', 'stale-epoch'], platforms),
        cleanupAction: 'off(subscription)',
        validationAxes: ['delivery', 'structure', 'semantic', 'ordering', 'epoch', 'negative', 'cleanup'],
      }
    }),
  }
}

export function buildPublicTestDisposition(contract: ContractDocument): TestDispositionDocument {
  const schemas = buildPublicResponseSchemas(contract)
  return buildDisposition('public', contract.callables, contract.events, schemas)
}

export function buildEnterpriseTestDisposition(base: ContractDocument, delta: EnterpriseDeltaDocument): TestDispositionDocument {
  const callables = [...base.callables, ...delta.callables]
  const events = [...base.events, ...delta.events]
  const schemas = buildEnterpriseResponseSchemas(base, delta)
  return buildDisposition('enterprise', callables, events, schemas)
}

function actualKind(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function schemaLabel(schema: ContractValueSchema): string {
  if (schema.kind === 'reference') return schema.name
  if (schema.kind === 'literal') return JSON.stringify(schema.value)
  return schema.kind
}

function schemaMatchesActualKind(
  document: ResponseSchemaDocument,
  schema: ContractValueSchema,
  value: unknown,
  referenceStack: string[] = [],
): boolean {
  if (schema.kind === 'any') return true
  if (schema.kind === 'void') return value === undefined || value === null
  if (schema.kind === 'string' || schema.kind === 'boolean') return typeof value === schema.kind
  if (schema.kind === 'number') return typeof value === 'number'
  if (schema.kind === 'null') return value === null
  if (schema.kind === 'literal') return typeof value === typeof schema.value
  if (schema.kind === 'array') return Array.isArray(value)
  if (schema.kind === 'object') return value != null && typeof value === 'object' && !Array.isArray(value)
  if (schema.kind === 'union') return schema.options.some((option) => schemaMatchesActualKind(document, option, value, referenceStack))
  const target = document.schemas[schema.name]
  if (target == null || referenceStack.includes(schema.name)) return true
  return schemaMatchesActualKind(document, target, value, [...referenceStack, schema.name])
}

export function validateContractValue(
  document: ResponseSchemaDocument,
  schema: ContractValueSchema,
  value: unknown,
  path = '$',
  referenceStack: string[] = [],
): SchemaValidationIssue[] {
  if (schema.kind === 'any') return []
  if (schema.kind === 'void') return value === undefined || value === null ? [] : [{ path, rule: 'type', expected: 'void', actual: actualKind(value), severity: 'error' }]
  if (schema.kind === 'string' || schema.kind === 'boolean') return typeof value === schema.kind ? [] : [{ path, rule: 'type', expected: schema.kind, actual: actualKind(value), severity: 'error' }]
  if (schema.kind === 'number') return typeof value === 'number' && Number.isFinite(value) ? [] : [{ path, rule: 'finite-number', expected: 'finite number', actual: actualKind(value), severity: 'error' }]
  if (schema.kind === 'null') return value === null ? [] : [{ path, rule: 'type', expected: 'null', actual: actualKind(value), severity: 'error' }]
  if (schema.kind === 'literal') return value === schema.value ? [] : [{ path, rule: 'literal', expected: JSON.stringify(schema.value), actual: JSON.stringify(value), severity: 'error' }]
  if (schema.kind === 'reference') {
    const target = document.schemas[schema.name]
    if (target == null) return [{ path, rule: 'reference', expected: schema.name, actual: 'missing schema', severity: 'error' }]
    if (referenceStack.includes(schema.name)) return []
    return validateContractValue(document, target, value, path, [...referenceStack, schema.name])
  }
  if (schema.kind === 'union') {
    const attempts = schema.options.map((option, index) => ({
      issues: validateContractValue(document, option, value, path, referenceStack),
      index,
      matchesActualKind: schemaMatchesActualKind(document, option, value, referenceStack),
    }))
    const matchingAttempts = attempts.filter((attempt) => attempt.matchesActualKind)
    const ranked = (matchingAttempts.length === 0 ? attempts : matchingAttempts)
      .map(({ issues, index }) => ({
        issues,
        index,
        errors: issues.filter((issue) => issue.severity === 'error').length,
        drift: issues.filter((issue) => issue.severity === 'contract-drift').length,
      }))
      .sort((left, right) => left.errors - right.errors || left.drift - right.drift || left.index - right.index)
    return ranked[0]?.issues ?? [{ path, rule: 'union', expected: schema.options.map(schemaLabel).join(' | '), actual: actualKind(value), severity: 'error' }]
  }
  if (schema.kind === 'array') {
    if (!Array.isArray(value)) return [{ path, rule: 'type', expected: 'array', actual: actualKind(value), severity: 'error' }]
    return value.flatMap((item, index) => validateContractValue(document, schema.items, item, `${path}[${index}]`, referenceStack))
  }
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return [{ path, rule: 'type', expected: 'object', actual: actualKind(value), severity: 'error' }]
  const record = value as Record<string, unknown>
  const issues: SchemaValidationIssue[] = []
  for (const [name, field] of Object.entries(schema.fields)) {
    if (!Object.prototype.hasOwnProperty.call(record, name)) {
      if (field.required) issues.push({ path: `${path}.${name}`, rule: 'required', expected: 'present', actual: 'missing', severity: 'error' })
    } else {
      issues.push(...validateContractValue(document, field.schema, record[name], `${path}.${name}`, referenceStack))
    }
  }
  for (const name of Object.keys(record)) {
    if (schema.fields[name] == null) issues.push({ path: `${path}.${name}`, rule: 'unknown-field', expected: 'declared field', actual: 'unknown field', severity: 'contract-drift' })
  }
  return issues
}
