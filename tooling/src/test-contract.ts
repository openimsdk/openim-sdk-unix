import ts from 'typescript'
import type { ContractCallable, ContractDocument, ContractEvent, ContractType, EnterpriseDeltaDocument, EnterpriseTypeExtension } from './model.js'

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

export interface TestDispositionDocument {
  schemaVersion: 1
  edition: 'public' | 'enterprise'
  counts: { callables: number; events: number }
  callables: Array<{
    caseId: string
    apiName: string
    priority: 'P0' | 'P1' | 'P2'
    disposition: TestDisposition
    capability: string
    responseCodec: string
  }>
  events: Array<{
    caseId: string
    eventName: string
    priority: 'P0' | 'P1' | 'P2'
    deliveryDisposition: EventDeliveryDisposition
    payloadProfile: 'void' | 'typed' | 'scalar' | 'opaque-string'
  }>
}

export interface SchemaValidationIssue {
  path: string
  rule: string
  expected: string
  actual: string
  severity: 'error' | 'contract-drift'
}

const capabilityByCallable = new Map<string, string>([
  ['getSpeechToTextCapabilities', 'speech'],
  ['speechToText', 'speech'],
  ['translateText', 'translation'],
  ['translateMessage', 'translation'],
  ['signalingGetInvitationInfoStartApp', 'push-launch'],
])

const p0CallableNames = new Set([
  'initSDK', 'login', 'logout', 'unInitSDK', 'getLoginStatus', 'getLoginUserID',
  'getSelfUserInfo', 'setSelfInfo', 'getUsersInfo', 'subscribeUsersStatus', 'unsubscribeUsersStatus',
  'createTextMessage', 'sendMessage', 'sendMessageNotOss', 'getAdvancedHistoryMessageList',
  'getAllConversationList', 'getOneConversation', 'setConversation', 'setConversationDraft',
  'markConversationMessageAsRead', 'getFriendList', 'addFriend', 'acceptFriendApplication',
  'createGroup', 'getSpecifiedGroupsInfo', 'getGroupMemberList', 'sendGroupMessageReceipt',
  'uploadFile', 'cancelUpload', 'signalingInvite', 'signalingAccept', 'signalingReject',
  'signalingCancel', 'signalingInviteInGroup', 'signalingSendCustomSignaling',
  'off', 'offEvent', 'offAll',
])

const p0EventNames = new Set([
  'onConnecting', 'onConnectSuccess', 'onConnectFailed', 'onSyncServerStart', 'onSyncServerFinish',
  'onRecvNewMessage', 'onRecvOfflineNewMessage', 'onConversationChanged', 'onNewConversation',
  'onTotalUnreadMessageCountChanged', 'onSendMessageProgress', 'onUploadFileProgress',
  'onFriendApplicationAdded', 'onFriendAdded', 'onGroupApplicationAdded', 'onGroupMemberAdded',
  'onReceiveNewInvitation', 'onInviteeAccepted', 'onInviteeRejected', 'onInvitationCancelled',
  'onHangUp', 'onReceiveCustomSignaling',
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

function buildDisposition(
  edition: 'public' | 'enterprise',
  callables: ContractCallable[],
  events: ContractEvent[],
  responseSchemas: ResponseSchemaDocument,
): TestDispositionDocument {
  return {
    schemaVersion: 1,
    edition,
    counts: { callables: callables.length, events: events.length },
    callables: callables.map((callable) => {
      const capability = capabilityByCallable.get(callable.name) ?? 'core'
      const unsupported = callable.binding.android?.kind === 'unsupported' && callable.binding.ios?.kind === 'unsupported'
      return {
        caseId: `api/${callable.name}`,
        apiName: callable.name,
        priority: capability !== 'core' ? 'P2' : p0CallableNames.has(callable.name) || callable.role !== 'operation' ? 'P0' : 'P1',
        disposition: unsupported ? 'platform-unsupported' : capability !== 'core' ? 'capability-gated' : 'required',
        capability,
        responseCodec: callable.responseCodec,
      }
    }),
    events: events.map((event) => {
      const unsupported = event.binding.android === 'unsupported-by-native-abi' && event.binding.ios === 'unsupported-by-native-abi'
      return {
        caseId: `event/${event.name}`,
        eventName: event.name,
        priority: p0EventNames.has(event.name) ? 'P0' : 'P1',
        deliveryDisposition: unsupported ? 'platform-unsupported' : p0EventNames.has(event.name) ? 'required' : 'passive-only',
        payloadProfile: responseSchemas.events[event.name]!.payloadProfile,
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
    const attempts = schema.options.map((option) => validateContractValue(document, option, value, path, referenceStack))
    if (attempts.some((issues) => issues.every((issue) => issue.severity !== 'error'))) return []
    const ranked = attempts
      .map((issues, index) => ({ issues, index, errors: issues.filter((issue) => issue.severity === 'error').length }))
      .sort((left, right) => left.errors - right.errors || left.index - right.index)
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
