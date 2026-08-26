import ts from 'typescript'
import type {
  AutomationCallableTestPlan,
  AutomationCleanupProducer,
  AutomationEpochProducer,
  AutomationEventTestPlan,
  AutomationNegativeProducer,
  AutomationProducerRef,
  ContractCallable,
  ContractDocument,
  ContractEvent,
  ContractType,
  EnterpriseDeltaDocument,
  EnterpriseTypeExtension,
  Platform,
} from './model.js'
import { composeAutomationTestPlan } from './automation-plan.js'
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
  | { kind: 'string-map' }
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
    eventIdentityPaths?: Record<string, string>
    negativeProfiles: string[]
    negativeProducers: AutomationNegativeProducer[]
    cleanupAction: string
    cleanupRule?: string
    cleanupProducer?: AutomationProducerRef
    capabilityByPlatform: { android: string; ios: string; harmony: string }
    validationAxes: CallableValidationAxis[]
    validationAxesByPlatform: { android: CallableValidationAxis[]; ios: CallableValidationAxis[]; harmony: CallableValidationAxis[] }
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
    negativeProducers: AutomationNegativeProducer[]
    cleanupAction: string
    cleanupRule?: string
    cleanupProducer?: AutomationProducerRef
    epochProducer?: { rule: string; producer: AutomationProducerRef }
    validationAxes: EventValidationAxis[]
    validationAxesByPlatform: { android: EventValidationAxis[]; ios: EventValidationAxis[]; harmony: EventValidationAxis[] }
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

const expectedEventsByCallable = new Map<string, string[]>([
  ['login', ['onConnecting', 'onConnectSuccess', 'onSyncServerStart', 'onSyncServerFinish']],
  ['sendMessage', ['onSendMessageProgress', 'onRecvNewMessage']],
  ['sendMessageNotOss', ['onRecvNewMessage']],
  ['uploadFile', ['onUploadFileProgress']],
  ['uploadLogs', ['onUploadLogsProgress']],
  ['addFriend', ['onFriendApplicationAdded']],
  ['acceptFriendApplication', ['onFriendAdded', 'onFriendApplicationAccepted']],
  ['refuseFriendApplication', ['onFriendApplicationRejected']],
  ['createGroup', ['onJoinedGroupAdded', 'onNewConversation']],
  ['joinGroup', ['onGroupApplicationAdded']],
  ['acceptGroupApplication', ['onGroupMemberAdded', 'onGroupApplicationAccepted']],
  ['refuseGroupApplication', ['onGroupApplicationRejected']],
  ['setConversation', ['onConversationChanged']],
  ['markConversationMessageAsRead', ['onRecvC2CReadReceipt']],
  ['revokeMessage', ['onNewRecvMessageRevoked']],
  ['deleteMessage', ['onMsgDeleted']],
  ['updateFriends', ['onFriendInfoChanged']],
  ['deleteFriend', ['onFriendDeleted']],
  ['removeBlack', ['onBlackDeleted']],
  ['setGroupInfo', ['onGroupInfoChanged']],
  ['setGroupMemberInfo', ['onGroupMemberInfoChanged']],
  ['kickGroupMember', ['onGroupMemberDeleted']],
  ['setSelfInfo', ['onSelfInfoUpdated']],
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
    if (name === 'OpenIMStringMap') return { kind: 'string-map' }
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
    if (!ts.isFunctionTypeNode(alias.type)) {
      result[type.name] = type.name === 'OpenIMStringMap' ? { kind: 'string-map' } : schemaFromNode(alias.type)
    }
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
  const overrides = new Map((delta.approvedBaseTypeOverrides ?? []).map((value) => [value.name, value]))
  const enterpriseBaseTypes = base.types.map((type) => {
    const override = overrides.get(type.name)
    return override == null ? type : { ...type, declaration: override.enterpriseDeclaration }
  })
  return buildResponseSchemas('enterprise', [...enterpriseBaseTypes, ...delta.types], [...base.callables, ...delta.callables], [...base.events, ...delta.events], delta.typeExtensions)
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

type AutomationCapability = 'core' | 'speech' | 'translation' | 'push-launch'
type PlatformDispositionMap = { android: PlatformTestDisposition; ios: PlatformTestDisposition; harmony: PlatformTestDisposition }

function isPlatform(value: string): value is Platform {
  return value === 'android' || value === 'ios' || value === 'harmony'
}

function assertProducerRef(value: AutomationProducerRef, target: string, axis: string): void {
  assert(value != null && typeof value === 'object', `${target} ${axis} producer is missing`)
  assert(typeof value.key === 'string' && value.key.length > 0 && !value.key.includes('*'), `${target} ${axis} producer key is missing or wildcarded`)
  assert(typeof value.suite === 'string' && value.suite.length > 0 && !value.suite.includes('*'), `${target} ${axis} producer suite is missing or wildcarded`)
  assert(typeof value.scenario === 'string' && value.scenario.length > 0 && !value.scenario.includes('*'), `${target} ${axis} producer scenario is missing or wildcarded`)
  assert(Array.isArray(value.platforms) && value.platforms.length > 0, `${target} ${axis} producer platforms are required and cannot be empty`)
  assert(new Set(value.platforms).size === value.platforms.length, `${target} ${axis} producer platforms contain duplicates`)
  assert(value.platforms.every(isPlatform), `${target} ${axis} producer platform is invalid`)
}

function validatePlanProducer(target: string, axis: string, value: AutomationNegativeProducer | AutomationCleanupProducer | { rule: string; producer: AutomationProducerRef }): void {
  assertProducerRef(value.producer, target, axis)
  if ('profile' in value) {
    assert(typeof value.profile === 'string' && value.profile.length > 0, `${target} negative producer profile is missing`)
    return
  }
  if ('action' in value) {
    assert(typeof value.action === 'string' && value.action.length > 0, `${target} cleanup producer action is missing`)
    assert(value.action !== 'none', `${target} cleanup producer cannot declare a no-op action`)
  }
  assert(typeof value.rule === 'string' && value.rule.length > 0, `${target} ${axis} producer rule is missing`)
}

function validateAutomationTestPlan(
  plan: ContractDocument['automationTestPlan'],
  callables: ContractCallable[],
  events: ContractEvent[],
): { callables: Map<string, AutomationCallableTestPlan>; events: Map<string, AutomationEventTestPlan> } {
  const callableNames = new Set(callables.map((value) => value.name))
  const eventNames = new Set(events.map((value) => value.name))
  const callablePlans = new Map<string, AutomationCallableTestPlan>()
  const eventPlans = new Map<string, AutomationEventTestPlan>()
  if (plan == null) return { callables: callablePlans, events: eventPlans }
  assert(plan.schemaVersion === 1, `Unsupported automation test plan schema: ${String(plan.schemaVersion)}`)
  for (const item of plan.callables) {
    assert(typeof item.apiName === 'string' && item.apiName.length > 0 && !item.apiName.includes('*'), 'Automation callable plan target must be exact')
    assert(callableNames.has(item.apiName), `Automation callable plan target is unknown: ${item.apiName}`)
    assert(!callablePlans.has(item.apiName), `Duplicate automation callable plan target: ${item.apiName}`)
    if (item.capabilityByPlatform != null) {
      for (const [platform, capability] of Object.entries(item.capabilityByPlatform)) {
        assert(isPlatform(platform), `Invalid automation capability platform: ${platform}`)
        assert(capability === 'core' || capability === 'speech' || capability === 'translation' || capability === 'push-launch', `Invalid automation capability: ${String(capability)}`)
      }
    }
    for (const producer of item.negative ?? []) validatePlanProducer(item.apiName, 'negative', producer)
    if (item.negative != null) {
      const profiles = item.negative.map((value) => value.profile)
      assert(new Set(profiles).size === profiles.length, `Duplicate automation negative profile: ${item.apiName}`)
    }
    if (item.cleanup != null) validatePlanProducer(item.apiName, 'cleanup', item.cleanup)
    callablePlans.set(item.apiName, item)
  }
  for (const item of plan.events) {
    assert(typeof item.eventName === 'string' && item.eventName.length > 0 && !item.eventName.includes('*'), 'Automation event plan target must be exact')
    assert(eventNames.has(item.eventName), `Automation event plan target is unknown: ${item.eventName}`)
    assert(!eventPlans.has(item.eventName), `Duplicate automation event plan target: ${item.eventName}`)
    for (const producer of item.negative ?? []) validatePlanProducer(item.eventName, 'negative', producer)
    if (item.negative != null) {
      const profiles = item.negative.map((value) => value.profile)
      assert(new Set(profiles).size === profiles.length, `Duplicate automation event negative profile: ${item.eventName}`)
    }
    if (item.cleanup != null) validatePlanProducer(item.eventName, 'cleanup', item.cleanup)
    if (item.epoch != null) validatePlanProducer(item.eventName, 'epoch', item.epoch)
    eventPlans.set(item.eventName, item)
  }
  return { callables: callablePlans, events: eventPlans }
}

function producerAppliesToPlatform(producer: AutomationProducerRef, platform: Platform): boolean {
  return producer.platforms.includes(platform)
}

function negativeProducersForPlatform(plan: AutomationCallableTestPlan | AutomationEventTestPlan | undefined, platform: Platform): AutomationNegativeProducer[] {
  return (plan?.negative ?? []).filter((value) => producerAppliesToPlatform(value.producer, platform))
}

function callableCapability(plan: AutomationCallableTestPlan | undefined, platform: Platform): AutomationCapability {
  return plan?.capabilityByPlatform?.[platform] ?? 'core'
}

function callableBaseValidationAxes(
  callable: ContractCallable,
  probe: string,
  expectedEvents: string[],
): CallableValidationAxis[] {
  const axes: CallableValidationAxis[] = ['completion']
  if (callable.role === 'event-control') {
    axes.push('semantic', 'side-effect')
    return axes
  }
  axes.push('structure', 'semantic')
  if (probe !== 'none') axes.push('side-effect')
  if (expectedEvents.length > 0 && callable.role === 'operation') axes.push('event')
  return axes
}

function uniqueAxes<T extends string>(axesByPlatform: Record<Platform, T[]>): T[] {
  const result: T[] = []
  for (const platform of ['android', 'ios', 'harmony'] as Platform[]) {
    for (const axis of axesByPlatform[platform]) {
      if (!result.includes(axis)) result.push(axis)
    }
  }
  return result
}

function callableValidationAxesByPlatform(
  callable: ContractCallable,
  probe: string,
  expectedEvents: string[],
  platforms: PlatformDispositionMap,
  negativeByPlatform: Record<Platform, AutomationNegativeProducer[]>,
  cleanup: AutomationCleanupProducer | undefined,
): Record<Platform, CallableValidationAxis[]> {
  const result: Record<Platform, CallableValidationAxis[]> = {
    android: [],
    ios: [],
    harmony: [],
  }
  for (const platform of ['android', 'ios', 'harmony'] as Platform[]) {
    const disposition = platforms[platform]
    if (disposition === 'not-in-edition') continue
    if (disposition === 'capability-negative' || disposition === 'platform-unsupported') {
      result[platform] = ['negative']
      continue
    }
    const axes = callableBaseValidationAxes(callable, probe, expectedEvents)
    if (negativeByPlatform[platform].length > 0) axes.push('negative')
    if (cleanup != null && producerAppliesToPlatform(cleanup.producer, platform)) axes.push('cleanup')
    result[platform] = axes
  }
  return result
}

function eventValidationAxesByPlatform(
  platforms: PlatformDispositionMap,
  negativeByPlatform: Record<Platform, AutomationNegativeProducer[]>,
  cleanup: AutomationCleanupProducer | undefined,
  epoch: AutomationEpochProducer | undefined,
): Record<Platform, EventValidationAxis[]> {
  const result: Record<Platform, EventValidationAxis[]> = {
    android: [],
    ios: [],
    harmony: [],
  }
  for (const platform of ['android', 'ios', 'harmony'] as Platform[]) {
    const disposition = platforms[platform]
    if (disposition === 'not-in-edition') continue
    if (disposition === 'capability-negative' || disposition === 'platform-unsupported') {
      result[platform] = ['negative']
      continue
    }
    const axes: EventValidationAxis[] = ['delivery', 'structure', 'semantic', 'ordering']
    if (epoch != null && producerAppliesToPlatform(epoch.producer, platform)) axes.push('epoch')
    if (negativeByPlatform[platform].length > 0) axes.push('negative')
    if (cleanup != null && producerAppliesToPlatform(cleanup.producer, platform)) axes.push('cleanup')
    result[platform] = axes
  }
  return result
}

function buildDisposition(
  edition: 'public' | 'enterprise',
  callables: ContractCallable[],
  events: ContractEvent[],
  responseSchemas: ResponseSchemaDocument,
  automationTestPlan: ContractDocument['automationTestPlan'] = undefined,
  editionKnownIssues: Readonly<Record<string, ApprovedKnownIssueDisposition>> = {},
): TestDispositionDocument {
  const responseSchemaDocument = edition === 'public'
    ? 'contracts/base/response-schemas.json'
    : 'contracts/enterprise/response-schemas.json'
  const plan = validateAutomationTestPlan(automationTestPlan, callables, events)
  return {
    schemaVersion: 2,
    edition,
    counts: { callables: callables.length, events: events.length },
    callables: callables.map((callable) => {
      const callablePlan = plan.callables.get(callable.name)
      const capabilityByPlatform = {
        android: callableCapability(callablePlan, 'android'),
        ios: callableCapability(callablePlan, 'ios'),
        harmony: callableCapability(callablePlan, 'harmony'),
      }
      const capability = capabilityByPlatform.harmony === 'core' ? 'core' : capabilityByPlatform.harmony
      const unsupported = callable.binding.android?.kind === 'unsupported' && callable.binding.ios?.kind === 'unsupported'
      const { semanticProfile: profile, sideEffectProbe: probe } = requireCallableTestProfile(callable)
      const expectedEvents = callable.role === 'event-subscription'
        ? [callable.name]
        : [...(callable.testProfile.expectedEvents ?? expectedEventsByCallable.get(callable.name) ?? [])]
      const platforms = {
        android: callablePlatformDisposition(edition, callable, capabilityByPlatform.android, 'android'),
        ios: callablePlatformDisposition(edition, callable, capabilityByPlatform.ios, 'ios'),
        harmony: callablePlatformDisposition(edition, callable, capabilityByPlatform.harmony, 'harmony'),
      }
      const negative = {
        android: negativeProducersForPlatform(callablePlan, 'android'),
        ios: negativeProducersForPlatform(callablePlan, 'ios'),
        harmony: negativeProducersForPlatform(callablePlan, 'harmony'),
      }
      const negativeProducers = callablePlan?.negative ?? []
      const cleanup = callablePlan?.cleanup
      for (const [platform, disposition] of Object.entries(platforms) as Array<[Platform, PlatformTestDisposition]>) {
        if ((disposition === 'capability-negative' || disposition === 'platform-unsupported') && negative[platform].length === 0) {
          throw new Error(`${callable.name} ${platform} ${disposition} requires an explicit negative producer`)
        }
        if (disposition === 'required' && negative[platform].some((producer) => producer.profile === 'platform-unsupported')) {
          throw new Error(`${callable.name} ${platform} required capability cannot retain a platform-unsupported producer`)
        }
      }
      const validationAxesByPlatform = callableValidationAxesByPlatform(
        callable,
        probe,
        expectedEvents,
        platforms,
        negative,
        cleanup,
      )
      const validationAxes = uniqueAxes(validationAxesByPlatform)
      const approvedKnownIssue = editionKnownIssues[callable.name]
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
        capabilityByPlatform,
        responseCodec: callable.responseCodec,
        platforms,
        responseSchema: { document: responseSchemaDocument, root: `callables.${callable.name}.schema` },
        semanticProfile: profile,
        sideEffectProbe: probe,
        expectedEvents,
        ...(callable.testProfile.eventIdentityPaths == null
          ? {}
          : { eventIdentityPaths: callable.testProfile.eventIdentityPaths }),
        negativeProfiles: negativeProducers.map((value) => value.profile),
        negativeProducers,
        cleanupAction: cleanup?.action ?? '',
        ...(cleanup == null ? {} : {
          cleanupRule: cleanup.rule,
          cleanupProducer: cleanup.producer,
        }),
        validationAxes,
        validationAxesByPlatform,
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
      const eventPlan = plan.events.get(event.name)
      const unsupported = event.binding.android === 'unsupported-by-native-abi' && event.binding.ios === 'unsupported-by-native-abi'
      const platforms = {
        android: eventPlatformDisposition(edition, event, 'android'),
        ios: eventPlatformDisposition(edition, event, 'ios'),
        harmony: eventPlatformDisposition(edition, event, 'harmony'),
      }
      const negativeByPlatform = {
        android: negativeProducersForPlatform(eventPlan, 'android'),
        ios: negativeProducersForPlatform(eventPlan, 'ios'),
        harmony: negativeProducersForPlatform(eventPlan, 'harmony'),
      }
      const negative = eventPlan?.negative ?? []
      const cleanup = eventPlan?.cleanup
      const epoch = eventPlan?.epoch
      for (const [platform, disposition] of Object.entries(platforms) as Array<[Platform, PlatformTestDisposition]>) {
        if ((disposition === 'capability-negative' || disposition === 'platform-unsupported') && negativeByPlatform[platform].length === 0) {
          throw new Error(`${event.name} ${platform} ${disposition} requires an explicit negative producer`)
        }
        if (disposition === 'required' && negativeByPlatform[platform].some((producer) => producer.profile === 'platform-unsupported')) {
          throw new Error(`${event.name} ${platform} required capability cannot retain a platform-unsupported producer`)
        }
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
        negativeProfiles: negative.map((value) => value.profile),
        negativeProducers: negative,
        cleanupAction: cleanup?.action ?? '',
        ...(cleanup == null ? {} : { cleanupRule: cleanup.rule, cleanupProducer: cleanup.producer }),
        ...(epoch == null ? {} : { epochProducer: epoch }),
        validationAxes: uniqueAxes(eventValidationAxesByPlatform(platforms, negativeByPlatform, cleanup, epoch)),
        validationAxesByPlatform: eventValidationAxesByPlatform(platforms, negativeByPlatform, cleanup, epoch),
      }
    }),
  }
}

export function buildPublicTestDisposition(contract: ContractDocument): TestDispositionDocument {
  const schemas = buildPublicResponseSchemas(contract)
  return buildDisposition('public', contract.callables, contract.events, schemas, contract.automationTestPlan)
}

export function buildEnterpriseTestDisposition(base: ContractDocument, delta: EnterpriseDeltaDocument): TestDispositionDocument {
  const overrides = new Map(delta.approvedBaseCallableOverrides.map((value) => [value.name, value]))
  const callables = [
    ...base.callables.map((callable) => {
      const override = overrides.get(callable.name)
      if (override == null) return callable
      return {
        ...callable,
        signature: override.enterpriseSignature,
        ...(override.declaration == null ? {} : { declaration: override.declaration }),
        ...(override.lowering == null ? {} : { lowering: override.lowering }),
        binding: override.binding ?? callable.binding,
        testProfile: override.testProfile ?? callable.testProfile,
      }
    }),
    ...delta.callables,
  ]
  const events = [...base.events, ...delta.events]
  const schemas = buildEnterpriseResponseSchemas(base, delta)
  const knownIssues = (delta.editionExtensions?.testKnownIssues ?? {}) as Record<string, ApprovedKnownIssueDisposition>
  return buildDisposition('enterprise', callables, events, schemas, composeAutomationTestPlan(base.automationTestPlan, delta.automationTestPlan), knownIssues)
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
  if (schema.kind === 'string-map') return value != null && typeof value === 'object' && !Array.isArray(value)
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
  if (schema.kind === 'string-map') {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return [{ path, rule: 'type', expected: 'string map', actual: actualKind(value), severity: 'error' }]
    return Object.entries(value as Record<string, unknown>).flatMap(([name, item]) => (
      typeof item === 'string' ? [] : [{ path: `${path}.${name}`, rule: 'type', expected: 'string', actual: actualKind(item), severity: 'error' as const }]
    ))
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
