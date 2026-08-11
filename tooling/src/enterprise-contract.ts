import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import ts from 'typescript'
import type {
  ContractCallable,
  ContractDocument,
  ContractEvent,
  ContractType,
  EnterpriseDeltaDocument,
  EnterpriseTypeExtension,
  NativeBinding,
} from './model.js'
import {
  bindingFor,
  codecFor,
  completionMode,
  declarationParts,
  dispatchArguments,
  eventDecoderForDispatchArguments,
  pairValues,
} from './import-contract.js'
import {
  extractExportedTypes,
  extractExportedValues,
  extractStringUnion,
  findExportedFunction,
  getParameterType,
  normalizeContractText,
  parseSource,
  sha256,
  type ExportedType,
  type ExportedValue,
  type ParsedSource,
} from './source.js'
import { verifyEnterpriseDriverInvariants } from './verify-driver.js'
import {
  harmonyContractMethodBindings,
  harmonyTypedMethods,
  renderHarmonyDriverBindings,
  renderHarmonyOperationCodes,
} from './harmony-bindings.js'
import { renderHarmonyMonomorphicHelpers } from './harmony-monomorphize.js'
import { buildEnterpriseResponseSchemas, buildEnterpriseTestDisposition } from './test-contract.js'
import { inferCallableTestProfile } from './test-profile.js'
import {
  semanticHashForCallable,
  semanticHashForEvent,
  semanticHashForType,
} from './contract-integrity.js'
import {
  assertEnterpriseStableIDs,
  readEnterpriseStableIDRegistry,
  reconcileEnterpriseIDs,
  writeEnterpriseStableIDRegistry,
} from './enterprise-integrity.js'
import { ENTERPRISE_HARMONY_PROJECTION_PATH } from './enterprise-compose.js'

const HARMONY_NATIVE_EVENT_ALIASES = {
  onMsgDeleted: 'EventOnMessageDeleted',
  onSendMessageProgress: 'EventOnSendMsgProgress',
  onUploadLogsProgress: 'EventOnUploadSDKDataProgress',
  onUserStatusChanged: 'EventOnUserOnlineStatusChanged',
  onReceiveCustomSignal: 'EventOnReceiveCustomSignaling',
} as const

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value.endsWith('\n') ? value : `${value}\n`)
}

export function preserveEnterpriseCallableAuthority(
  existing: ContractCallable,
  extracted: ContractCallable,
): ContractCallable {
  assert(existing.name === extracted.name, `Enterprise callable name changed during facade import: ${existing.name}`)
  for (const key of ['signature', 'completion', 'responseCodec', 'errorPolicy', 'rawString', 'role'] as const) {
    assert(
      existing[key] === extracted[key],
      `Enterprise callable ${existing.name} ${key} drifted from the authoritative Contract IR`,
    )
  }
  assert(existing.lowering != null, `Enterprise callable lacks structured lowering authority: ${existing.name}`)
  assert(existing.declaration == null, `Enterprise callable embeds generated facade declarations: ${existing.name}`)
  const keepAllBindings = existing.lowering.kind === 'local-promise'
    || existing.lowering.kind === 'synthetic-event-subscription'
  const result: ContractCallable = {
    ...existing,
    id: 0,
    testProfile: existing.testProfile ?? extracted.testProfile,
    binding: keepAllBindings
      ? existing.binding
      : { ...existing.binding, harmony: extracted.binding.harmony },
    signatureHash: '',
  }
  result.signatureHash = semanticHashForCallable(result)
  return result
}

function callableParameterType(value: ExportedValue, parsed: ParsedSource, index: number): string {
  if (ts.isFunctionDeclaration(value.node)) {
    return normalizeContractText(value.node.parameters[index]?.type?.getText(parsed.sourceFile) ?? 'unknown')
  }
  if (ts.isVariableStatement(value.node)) {
    const declaration = value.node.declarationList.declarations.find(
      (item) => ts.isIdentifier(item.name) && item.name.text === value.name,
    )
    const initializer = declaration?.initializer
    if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
      return normalizeContractText(initializer.parameters[index]?.type?.getText(parsed.sourceFile) ?? 'unknown')
    }
  }
  return 'unknown'
}

function privateValuesByName(parsed: ParsedSource): Map<string, ExportedValue> {
  return new Map(extractExportedValues(parsed).map((value) => [value.name, value]))
}

function typeNode(value: ExportedType): ts.TypeNode {
  return value.node.type
}

function createTypeExtension(base: ContractType, enterprise: ExportedType, index: number): EnterpriseTypeExtension {
  const baseParsed = ts.createSourceFile('base.uts', base.declaration, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const baseAlias = baseParsed.statements.find(ts.isTypeAliasDeclaration)
  assert(baseAlias != null, `Cannot parse public type ${base.name}`)
  const privateType = typeNode(enterprise)

  if (ts.isTypeLiteralNode(baseAlias.type) && ts.isTypeLiteralNode(privateType)) {
    const baseMembers = baseAlias.type.members.map((member) => normalizeContractText(member.getText(baseParsed)))
    const privateMembers = privateType.members.map((member) => normalizeContractText(member.getText(enterprise.node.getSourceFile())))
    for (const member of baseMembers) assert(privateMembers.includes(member), `Enterprise type ${base.name} changes a public member`)
    const added = privateType.members.filter((member) => {
      const text = normalizeContractText(member.getText(enterprise.node.getSourceFile()))
      return !baseMembers.includes(text)
    })
    assert(added.length > 0, `Enterprise type ${base.name} has no additive members`)
    for (const member of added) {
      assert(ts.isPropertySignature(member) && member.questionToken != null, `Enterprise type ${base.name} adds a non-optional member`)
    }
    return {
      id: 150001 + index,
      target: base.name,
      kind: 'optional-object-members',
      addedMembers: added.map((member) => member.getText(enterprise.node.getSourceFile())),
      privateSignatureHash: sha256(normalizeContractText(enterprise.declaration)),
    }
  }

  const baseUnion = ts.isUnionTypeNode(baseAlias.type) ? baseAlias.type.types : [baseAlias.type]
  const privateUnion = ts.isUnionTypeNode(privateType) ? privateType.types : [privateType]
  const baseMembers = baseUnion.map((member) => normalizeContractText(member.getText(baseParsed)))
  const privateMembers = privateUnion.map((member) => normalizeContractText(member.getText(enterprise.node.getSourceFile())))
  for (const member of baseMembers) assert(privateMembers.includes(member), `Enterprise union ${base.name} removes a public member`)
  const added = privateUnion.filter((member) => !baseMembers.includes(normalizeContractText(member.getText(enterprise.node.getSourceFile()))))
  assert(added.length > 0, `Enterprise union ${base.name} has no additive members`)
  for (const member of added) {
    assert(ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal), `Enterprise union ${base.name} adds a non-string member`)
  }
  return {
    id: 150001 + index,
    target: base.name,
    kind: 'string-union-members',
    addedMembers: added.map((member) => member.getText(enterprise.node.getSourceFile())),
    privateSignatureHash: sha256(normalizeContractText(enterprise.declaration)),
  }
}

function harmonyBinding(declaration: string, name: string, eventNames: Set<string>): NativeBinding {
  if (eventNames.has(name)) {
    if (declaration.includes('unsupportedHarmonyEvent(')) return { kind: 'unsupported', symbol: 'unsupported-by-native-abi' }
    return { kind: 'event', symbol: name }
  }
  if (declaration.includes('rejectUnsupported')) return { kind: 'unsupported', symbol: 'unsupported-by-native-abi' }
  const typed = /harmonySDK\.([A-Za-z_$][\w$]*)\s*\(/.exec(declaration)?.[1]
  if (typed) return { kind: 'native', symbol: typed }
  const dynamic = /(?:invokeHarmonyEmpty|invokeHarmonyMapped(?:__[A-Za-z0-9_$]+)?)\s*\(\s*['"]([^'"]+)['"]/.exec(declaration)?.[1]
  if (dynamic) return { kind: 'dynamic-invoke', symbol: dynamic }
  const alias = /\breturn\s+([A-Za-z_$][\w$]*)\s*\(/.exec(declaration)?.[1]
  if (alias) return { kind: 'facade-alias', symbol: alias }
  return { kind: 'none', symbol: '' }
}

function importHarmonyABI(
  privateRoot: string,
  contractEventCount: number,
  unsupportedEvents: string[],
  unsupportedOperations: string[],
): void {
  const inventoryPath = join(privateRoot, 'contracts/enterprise/native-abi/harmony.json')
  const existingInventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as {
    responseEncoders?: Record<string, string>
  }
  const harPath = join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-harmony/libs/imsdk.har')
  const declaration = execFileSync('tar', [
    '-xOzf',
    harPath,
    'package/src/main/ets/sdk-types.d.ets',
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const enumBody = /export declare enum OpenIMSDKEvent\s*\{([\s\S]*?)\n\}/.exec(declaration)?.[1] ?? ''
  const events = [...enumBody.matchAll(/\b(Event[A-Za-z0-9_]+)\s*=\s*(-?\d+)/g)].map((match) => ({
    name: match[1] ?? '',
    value: Number(match[2]),
  }))
  const sdkBody = /export interface OpenIMSDK\s*\{([\s\S]*?)\n\}/.exec(declaration)?.[1] ?? ''
  const methods = sdkBody
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[A-Za-z_$][\w$]*(?:<[^>]+>)?\s*\(/.test(line))
  const typedMethodBindings = harmonyTypedMethods(privateRoot)
  assert(events.length === 69, `Expected 69 Harmony HAR event enum values, got ${events.length}`)
  assert(methods.length > 100, `Harmony HAR method inventory is unexpectedly small: ${methods.length}`)
  writeText(
    join(privateRoot, 'contracts/enterprise/native-abi/harmony.json'),
    JSON.stringify({
      schemaVersion: 1,
      artifactPath: relative(privateRoot, harPath),
      artifactSha256: sha256(readFileSync(harPath)),
      declarationSha256: sha256(declaration),
      eventCount: events.length,
      events,
      methodCount: methods.length,
      methods,
      typedMethodCount: typedMethodBindings.length,
      typedMethodBindings,
      supportedContractEventCount: contractEventCount - unsupportedEvents.length,
      nativeEventAliases: HARMONY_NATIVE_EVENT_ALIASES,
      explicitlyUnsupportedContractEvents: unsupportedEvents,
      explicitlyUnsupportedContractOperations: unsupportedOperations,
      responseEncoders: existingInventory.responseEncoders ?? {},
    }, null, 2),
  )
}

export function importEnterpriseDelta(publicRoot: string, privateRoot: string): EnterpriseDeltaDocument {
  const existingDelta = JSON.parse(
    readFileSync(join(privateRoot, 'contracts/enterprise/delta.json'), 'utf8'),
  ) as EnterpriseDeltaDocument
  const base = JSON.parse(readFileSync(join(publicRoot, 'contracts/base/contract.json'), 'utf8')) as ContractDocument
  const plugin = join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk')
  const interfacePath = join(plugin, 'interface.uts')
  const androidIndexPath = join(plugin, 'app-android/index.uts')
  const iosIndexPath = join(plugin, 'app-ios/index.uts')
  const harmonyIndexPath = join(plugin, 'app-harmony/index.uts')
  const androidEventsPath = join(plugin, 'app-android/events.uts')
  const iosEventsPath = join(plugin, 'app-ios/events.uts')
  const interfaceSource = parseSource(interfacePath)
  const androidIndex = parseSource(androidIndexPath)
  const iosIndex = parseSource(iosIndexPath)
  const harmonyIndex = parseSource(harmonyIndexPath)
  const androidEvents = parseSource(androidEventsPath)
  const iosEvents = parseSource(iosEventsPath)
  let stableIDs = readEnterpriseStableIDRegistry(privateRoot)

  const enterpriseTypes = extractExportedTypes(interfaceSource)
  const enterpriseTypeByName = new Map(enterpriseTypes.map((value) => [value.name, value]))
  const baseTypeNames = new Set(base.types.map((value) => value.name))
  const typeExtensions: EnterpriseTypeExtension[] = []
  for (const publicType of base.types) {
    const enterpriseType = enterpriseTypeByName.get(publicType.name)
    assert(enterpriseType != null, `Enterprise contract is missing public type ${publicType.name}`)
    if (normalizeContractText(enterpriseType.declaration) !== normalizeContractText(publicType.declaration)) {
      const approvedOverride = existingDelta.approvedBaseTypeOverrides?.find((value) => value.name === publicType.name)
      if (approvedOverride == null) {
        typeExtensions.push(createTypeExtension(publicType, enterpriseType, typeExtensions.length))
      } else {
        assert(
          normalizeContractText(enterpriseType.declaration) === normalizeContractText(approvedOverride.enterpriseDeclaration),
          `Approved enterprise type override drifted: ${publicType.name}`,
        )
      }
    }
  }
  const extensionIDs = reconcileEnterpriseIDs(stableIDs, 'typeExtensions', typeExtensions.map((value) => value.target))
  stableIDs = extensionIDs.registry
  for (let index = 0; index < typeExtensions.length; index += 1) typeExtensions[index]!.id = extensionIDs.ids[index]!
  const types: ContractType[] = enterpriseTypes
    .filter((value) => !baseTypeNames.has(value.name))
    .map((value) => {
      const type: ContractType = {
        id: 0,
        name: value.name,
        declaration: value.declaration,
        signatureHash: '',
      }
      type.signatureHash = semanticHashForType(type)
      return type
    })
  const typeIDs = reconcileEnterpriseIDs(stableIDs, 'types', types.map((value) => value.name))
  stableIDs = typeIDs.registry
  for (let index = 0; index < types.length; index += 1) types[index]!.id = typeIDs.ids[index]!

  const androidValues = extractExportedValues(androidIndex)
  const iosValues = extractExportedValues(iosIndex)
  const harmonyValues = extractExportedValues(harmonyIndex)
  const pairs = pairValues(androidValues, iosValues)
  const harmonyByName = privateValuesByName(harmonyIndex)
  assert(harmonyByName.size === androidValues.length, 'Harmony façade export count differs from Android/iOS')
  const baseConstantByName = new Map(base.constants.map((value) => [value.name, value]))
  const baseCallableByName = new Map(base.callables.map((value) => [value.name, value]))
  const existingPrivateCallableByName = new Map(existingDelta.callables.map((value) => [value.name, value]))
  const eventNames = extractStringUnion(interfaceSource, 'OpenIMSDKEventName')
  const eventNameSet = new Set(eventNames)
  const callables: ContractCallable[] = []
  let privateConstantCount = 0

  for (const [android, ios] of pairs) {
    const harmony = harmonyByName.get(android.name)
    assert(harmony != null, `Harmony façade is missing export ${android.name}`)
    if (!android.isCallable) {
      privateConstantCount += 1
      const androidParts = declarationParts(android, androidIndex)
      const iosParts = declarationParts(ios, iosIndex)
      const harmonyParts = declarationParts(harmony, harmonyIndex)
      assert(androidParts.type === iosParts.type && androidParts.type === harmonyParts.type, `Constant type differs: ${android.name}`)
      assert(androidParts.initializer === iosParts.initializer && androidParts.initializer === harmonyParts.initializer, `Constant value differs: ${android.name}`)
      const publicConstant = baseConstantByName.get(android.name)
      assert(publicConstant != null, `Enterprise delta adds forbidden constant ${android.name}`)
      assert(publicConstant.type === androidParts.type && publicConstant.value === androidParts.initializer, `Enterprise overrides public constant ${android.name}`)
      continue
    }
    assert(android.signature === ios.signature && android.signature === harmony.signature, `Callable signature differs by platform: ${android.name}`)
    const publicCallable = baseCallableByName.get(android.name)
    if (publicCallable != null) {
      const approvedOverride = existingDelta.approvedBaseCallableOverrides.find((value) => value.name === android.name)
      if (approvedOverride == null) {
        assert(publicCallable.signature === android.signature, `Enterprise overrides public callable ${android.name}`)
      } else {
        assert(android.signature === approvedOverride.enterpriseSignature, `Approved enterprise override drifted: ${android.name}`)
      }
      continue
    }
    const isEvent = eventNameSet.has(android.name)
    const role: ContractCallable['role'] = isEvent ? 'event-subscription' : 'operation'
    const callable: ContractCallable = {
      id: 0,
      name: android.name,
      signature: android.signature,
      completion: completionMode(android.returnType),
      responseCodec: isEvent ? 'event-handler' : codecFor(android.returnType),
      errorPolicy: android.returnType.startsWith('Promise<') ? 'frozen-native-rejection' : 'none',
      rawString: android.returnType === 'string' || android.returnType === 'Promise<string>',
      role,
      testProfile: existingPrivateCallableByName.get(android.name)?.testProfile ?? inferCallableTestProfile({ name: android.name, role }),
      declaration: { android: android.declaration, ios: ios.declaration, harmony: harmony.declaration },
      binding: {
        android: bindingFor(android.declaration, eventNameSet, android.name),
        ios: bindingFor(ios.declaration, eventNameSet, ios.name),
        harmony: harmonyBinding(harmony.declaration, harmony.name, eventNameSet),
      },
      signatureHash: '',
    }
    callable.signatureHash = semanticHashForCallable(callable)
    const existingCallable = existingPrivateCallableByName.get(callable.name)
    assert(existingCallable != null, `Enterprise callable lacks imported Contract IR authority: ${callable.name}`)
    callables.push(preserveEnterpriseCallableAuthority(existingCallable, callable))
  }
  const callableIDs = reconcileEnterpriseIDs(stableIDs, 'callables', callables.map((value) => value.name))
  stableIDs = callableIDs.registry
  for (let index = 0; index < callables.length; index += 1) callables[index]!.id = callableIDs.ids[index]!

  const baseEventNames = new Set(base.events.map((value) => value.name))
  const explicitUnsupported = harmonyValues
    .filter((value) => eventNameSet.has(value.name) && value.declaration.includes('unsupportedHarmonyEvent('))
    .map((value) => value.name)
  const unsupported = new Set<string>(explicitUnsupported)
  const events: ContractEvent[] = eventNames
    .filter((name) => !baseEventNames.has(name))
    .map((name) => {
      const callable = callables.find((value) => value.name === name)
      assert(callable != null, `Missing enterprise event callable ${name}`)
      const androidFunction = findExportedFunction(androidEvents, `${name}Event`)
      const iosFunction = findExportedFunction(iosEvents, `${name}Event`)
      const harmonyFunction = harmonyByName.get(name)
      assert(androidFunction != null && iosFunction != null && harmonyFunction != null, `Missing enterprise event adapter ${name}`)
      const androidHandler = normalizeContractText(getParameterType(androidFunction, 0, androidEvents.sourceFile))
      const iosHandler = normalizeContractText(getParameterType(iosFunction, 0, iosEvents.sourceFile))
      const harmonyHandler = callableParameterType(harmonyFunction, harmonyIndex, 0)
      assert(androidHandler === iosHandler && androidHandler === harmonyHandler, `Enterprise event handler differs by platform: ${name}`)
      const isUnsupported = unsupported.has(name)
      assert(isUnsupported === harmonyFunction.declaration.includes('unsupportedHarmonyEvent('), `Harmony unsupported classification drifted: ${name}`)
      const androidDispatch = dispatchArguments(androidFunction.getText(androidEvents.sourceFile), androidEvents.text, name)
      const iosDispatch = dispatchArguments(iosFunction.getText(iosEvents.sourceFile), iosEvents.text, name)
      assert(normalizeContractText(androidDispatch) === normalizeContractText(iosDispatch), `Enterprise event decoder differs by platform: ${name}`)
      const event: ContractEvent = {
        id: 0,
        name,
        callable: name,
        handlerType: androidHandler,
        decoder: eventDecoderForDispatchArguments(androidDispatch),
        rawPayload: androidHandler === 'OpenIMStringEventHandler',
        binding: {
          android: 'bound',
          ios: 'bound',
          harmony: isUnsupported ? 'unsupported-by-native-abi' : 'bound',
        },
        ...(isUnsupported ? { compatibilityRule: 'UTS-COMPAT-HARMONY-UNSUPPORTED-001' } : {}),
        signatureHash: '',
      }
      event.signatureHash = semanticHashForEvent(event)
      return event
    })
  const eventIDs = reconcileEnterpriseIDs(stableIDs, 'events', events.map((value) => value.name))
  stableIDs = eventIDs.registry
  for (let index = 0; index < events.length; index += 1) events[index]!.id = eventIDs.ids[index]!

  const explicitUnsupportedOperations = harmonyValues
    .filter((value) => value.isCallable && !eventNameSet.has(value.name) && value.declaration.includes('rejectUnsupported'))
    .map((value) => value.name)
  assert(!harmonyIndex.text.includes('noopUnsubscribe'), 'Harmony must not silently noop an event subscription')
  const actualTotal = {
    constants: privateConstantCount,
    types: enterpriseTypes.length,
    callables: androidValues.filter((value) => value.isCallable).length,
    events: eventNames.length,
  }
  const actualDelta = { constants: 0, types: types.length, callables: callables.length, events: events.length, typeExtensions: typeExtensions.length }

  const delta: EnterpriseDeltaDocument = {
    schemaVersion: 2,
    edition: 'enterprise-delta',
    origin: {
      ...existingDelta.origin,
    },
    expectedTotal: actualTotal,
    expectedDelta: actualDelta,
    approvedBaseCallableOverrides: existingDelta.approvedBaseCallableOverrides.map((value) => {
      const existing = existingDelta.approvedBaseCallableOverrides.find((override) => override.name === value.name)
      return {
        ...existing,
        name: value.name,
        baseSignature: baseCallableByName.get(value.name)?.signature ?? '',
        enterpriseSignature: value.enterpriseSignature,
        reason: value.reason,
      }
    }),
    ...(existingDelta.approvedBaseTypeOverrides == null
      ? {}
      : { approvedBaseTypeOverrides: existingDelta.approvedBaseTypeOverrides }),
    ...(existingDelta.editionExtensions == null ? {} : { editionExtensions: existingDelta.editionExtensions }),
    constants: [],
    types,
    typeExtensions,
    callables,
    events,
  }
  writeText(join(privateRoot, 'contracts/enterprise/delta.json'), JSON.stringify(delta, null, 2))
  writeEnterpriseStableIDRegistry(privateRoot, stableIDs)
  writeText(join(privateRoot, 'contracts/enterprise/response-schemas.json'), JSON.stringify(buildEnterpriseResponseSchemas(base, delta), null, 2))
  writeText(join(privateRoot, 'contracts/enterprise/test-disposition.json'), JSON.stringify(buildEnterpriseTestDisposition(base, delta), null, 2))
  importHarmonyABI(privateRoot, eventNames.length, explicitUnsupported, explicitUnsupportedOperations)
  return delta
}

export interface VerifyEnterpriseDeltaOptions {
  verifyHarmonyCertification?: boolean
}

export function verifyEnterpriseDelta(
  publicRoot: string,
  privateRoot: string,
  options: VerifyEnterpriseDeltaOptions = {},
): void {
  const delta = JSON.parse(
    readFileSync(join(privateRoot, 'contracts/enterprise/delta.json'), 'utf8'),
  ) as EnterpriseDeltaDocument
  const base = JSON.parse(
    readFileSync(join(publicRoot, 'contracts/base/contract.json'), 'utf8'),
  ) as ContractDocument
  assert(delta.edition === 'enterprise-delta', 'Invalid enterprise delta edition')
  assert(delta.schemaVersion === 2, 'Unsupported Enterprise delta schema')
  assert(delta.origin.kind === 'imported-facade', 'Enterprise delta origin kind changed')
  assert(
    /^[a-f0-9]{64}$/.test(delta.origin.importedPublicBaseContractHash),
    'Enterprise imported Public base hash is invalid',
  )
  const actualDelta = {
    constants: delta.constants.length,
    types: delta.types.length,
    callables: delta.callables.length,
    events: delta.events.length,
    typeExtensions: delta.typeExtensions.length,
  }
  const actualTotal = {
    constants: base.constants.length + delta.constants.length,
    types: base.types.length + delta.types.length,
    callables: base.callables.length + delta.callables.length,
    events: base.events.length + delta.events.length,
  }
  assert(JSON.stringify(delta.expectedTotal) === JSON.stringify(actualTotal), 'Enterprise total counts changed')
  assert(JSON.stringify(delta.expectedDelta) === JSON.stringify(actualDelta), 'Enterprise delta counts changed')
  for (const override of delta.approvedBaseCallableOverrides) {
    const publicCallable = base.callables.find((value) => value.name === override.name)
    assert(publicCallable != null, `Enterprise base callable override is unknown: ${override.name}`)
    assert(override.baseSignature === publicCallable.signature, `Enterprise base override signature changed: ${override.name}`)
    assert(override.baseHash === sha256(normalizeContractText(override.baseSignature)), `Enterprise base override hash is stale: ${override.name}`)
    assert(override.enterpriseHash === sha256(normalizeContractText(override.enterpriseSignature)), `Enterprise override hash is stale: ${override.name}`)
    assert(override.reason.trim().length > 0, `Enterprise override reason is missing: ${override.name}`)
    assert(override.declaration == null, `Enterprise override embeds platform implementation declarations: ${override.name}`)
    assert(
      override.lowering?.kind === 'platform-driver'
      && override.lowering.transport === 'async',
      `Enterprise override lowering is incomplete: ${override.name}`,
    )
  }
  for (const override of delta.approvedBaseTypeOverrides ?? []) {
    const publicType = base.types.find((value) => value.name === override.name)
    assert(publicType != null, `Enterprise base type override is unknown: ${override.name}`)
    assert(normalizeContractText(override.baseDeclaration) === normalizeContractText(publicType.declaration), `Enterprise base type override changed: ${override.name}`)
    assert(override.baseHash === sha256(normalizeContractText(override.baseDeclaration)), `Enterprise base type hash is stale: ${override.name}`)
    assert(override.enterpriseHash === sha256(normalizeContractText(override.enterpriseDeclaration)), `Enterprise type override hash is stale: ${override.name}`)
  }
  assertEnterpriseStableIDs(readEnterpriseStableIDRegistry(privateRoot), delta)
  for (const value of delta.types) assert(value.signatureHash === semanticHashForType(value), `Enterprise type semantic hash is stale: ${value.name}`)
  for (const value of delta.callables) assert(value.signatureHash === semanticHashForCallable(value), `Enterprise callable semantic hash is stale: ${value.name}`)
  for (const value of delta.events) assert(value.signatureHash === semanticHashForEvent(value), `Enterprise event semantic hash is stale: ${value.name}`)
  const unsupported = delta.events
    .filter((event) => event.binding.harmony === 'unsupported-by-native-abi')
    .map((event) => event.name)
  const harmonyProjection = JSON.parse(
    readFileSync(join(privateRoot, ENTERPRISE_HARMONY_PROJECTION_PATH), 'utf8'),
  ) as {
    callables: Array<{ name: string; binding?: string }>
    events: Array<{ name: string; binding: string }>
  }
  const expectedUnsupportedEvents = harmonyProjection.events
    .filter((event) => event.binding === 'unsupported-by-native-abi')
    .map((event) => event.name)
  const expectedUnsupportedOperations = harmonyProjection.callables
    .filter((callable) => callable.binding === 'unsupported-by-native-abi')
    .map((callable) => callable.name)
  assert(JSON.stringify(unsupported) === JSON.stringify(expectedUnsupportedEvents), 'Enterprise unsupported event projection drifted')
  const responseSchemas = JSON.parse(readFileSync(join(privateRoot, 'contracts/enterprise/response-schemas.json'), 'utf8'))
  const expectedResponseSchemas = buildEnterpriseResponseSchemas(base, delta)
  assert(JSON.stringify(responseSchemas) === JSON.stringify(expectedResponseSchemas), 'Enterprise response schema registry is stale')
  assert(expectedResponseSchemas.counts.callables === delta.expectedTotal.callables, 'Enterprise response schema callable coverage changed')
  assert(expectedResponseSchemas.counts.events === delta.expectedTotal.events, 'Enterprise response schema event coverage changed')
  const testDisposition = JSON.parse(readFileSync(join(privateRoot, 'contracts/enterprise/test-disposition.json'), 'utf8'))
  const expectedTestDisposition = buildEnterpriseTestDisposition(base, delta)
  assert(JSON.stringify(testDisposition) === JSON.stringify(expectedTestDisposition), 'Enterprise test disposition registry is stale')
  assert(expectedTestDisposition.counts.callables === delta.expectedTotal.callables, 'Enterprise callable test disposition coverage changed')
  assert(expectedTestDisposition.counts.events === delta.expectedTotal.events, 'Enterprise event test disposition coverage changed')
  if (options.verifyHarmonyCertification === false) return

  const harmonyABI = JSON.parse(
    readFileSync(join(privateRoot, 'contracts/enterprise/native-abi/harmony.json'), 'utf8'),
  ) as {
    artifactPath: string
    artifactSha256: string
    eventCount: number
    methodCount: number
    typedMethodCount: number
    supportedContractEventCount: number
    explicitlyUnsupportedContractEvents: string[]
    explicitlyUnsupportedContractOperations: string[]
  }
  const certification = JSON.parse(
    readFileSync(join(privateRoot, 'contracts/enterprise/certification/harmony-clean-builds.json'), 'utf8'),
  ) as {
    toolchain: { hbuilderxVersion: string }
    nativeABI: { harSha256: string; inventorySha256: string }
    generatedSources: {
      driverSha256: string
      platformDriverSha256: string
      bindingCodesSha256: string
      harmonyFacadeSha256: string
      monomorphicCodecManifestSha256: string
    }
    cleanRuns: Array<{ explicitSuccess: boolean; failureMarker: boolean; shellExitCode: number }>
  }
  const toolchain = JSON.parse(readFileSync(join(publicRoot, 'toolchain.lock.json'), 'utf8')) as {
    hbuilderx: { version: string }
  }
  assert(harmonyABI.eventCount === 69, 'Harmony HAR event enum count changed')
  assert(
    harmonyABI.supportedContractEventCount === delta.expectedTotal.events - expectedUnsupportedEvents.length,
    'Harmony supported contract event count changed',
  )
  assert(harmonyABI.methodCount > 100, 'Harmony HAR method inventory is unexpectedly small')
  assert(
    harmonyABI.typedMethodCount === harmonyTypedMethods(privateRoot).length,
    'Harmony typed Promise method inventory differs from the locked HAR',
  )
  assert(certification.toolchain.hbuilderxVersion === toolchain.hbuilderx.version, 'Harmony clean-build toolchain certification is stale')
  assert(certification.nativeABI.harSha256 === harmonyABI.artifactSha256, 'Harmony clean-build HAR certification is stale')
  assert(
    certification.nativeABI.inventorySha256 === sha256(readFileSync(join(privateRoot, 'contracts/enterprise/native-abi/harmony.json'))),
    'Harmony clean-build ABI inventory certification is stale',
  )
  assert(certification.cleanRuns.length === 2, 'Harmony requires exactly two recorded clean runs')
  for (const run of certification.cleanRuns) {
    assert(run.explicitSuccess && !run.failureMarker && run.shellExitCode === 0, 'Harmony clean run did not certify success')
  }
  assert(
    JSON.stringify(harmonyABI.explicitlyUnsupportedContractEvents) === JSON.stringify(expectedUnsupportedEvents),
    'Harmony ABI unsupported event list changed',
  )
  assert(
    JSON.stringify(harmonyABI.explicitlyUnsupportedContractOperations) === JSON.stringify(expectedUnsupportedOperations),
    'Harmony ABI unsupported operation list changed',
  )
  const harPath = join(privateRoot, harmonyABI.artifactPath)
  assert(sha256(readFileSync(harPath)) === harmonyABI.artifactSha256, 'Harmony HAR artifact hash changed')
  const harmonySource = readFileSync(
    join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-harmony/index.uts'),
    'utf8',
  )
  assert(harmonySource === renderHarmonyMonomorphicHelpers(privateRoot), 'Harmony monomorphic codecs are stale')
  assert(!/function\s+[A-Za-z_$][\w$]*\s*</.test(harmonySource), 'Harmony UTS contains a custom generic function')
  const forbiddenHarmonyUTS: Array<[RegExp, string]> = [
    [/\b(?:async|await)\b/, 'async/await'],
    [/\b(?:Map|Set)\s*[<(]/, 'Map/Set registry'],
    [/\?\./, 'optional chaining'],
    [/\?\?/, 'nullish coalescing'],
    [/\.\.\./, 'spread syntax'],
    [/import\s+\*/, 'wildcard import'],
    [/\b(?:class|implements)\b/, 'runtime class'],
    [/\bany\b/, 'any'],
    [/\bundefined\b/, 'undefined'],
  ]
  for (const [pattern, label] of forbiddenHarmonyUTS) {
    assert(!pattern.test(harmonySource), `Harmony UTS contains forbidden ${label}`)
  }
  const harmonyDriverSource = readFileSync(
    join(privateRoot, 'sdk-src/native/harmony/OpenIMHarmonyDriver.ets'),
    'utf8',
  )
  assert(harmonyDriverSource === renderHarmonyDriverBindings(privateRoot), 'Harmony typed Driver bindings are stale')
  const harmonyOperationCodes = readFileSync(
    join(privateRoot, 'sdk-src/uts/app-harmony/harmony-operation-codes.uts'),
    'utf8',
  )
  assert(harmonyOperationCodes === renderHarmonyOperationCodes(privateRoot), 'Harmony operation code projection is stale')
  const harmonyContractBindings = harmonyContractMethodBindings(privateRoot)
  assert(!harmonyOperationCodes.includes('harmonyOperationCode'), 'Harmony operation code translator was reintroduced')
  assert((harmonyOperationCodes.match(/if \(eventName == '/g) ?? []).length === 69, 'Harmony event code coverage changed')
  assert(!/400\d{3}/.test(harmonyDriverSource), 'Harmony legacy operation IDs were reintroduced')
  assert(!harmonyDriverSource.includes('callBindingUnInitSDK'), 'Harmony unInit bypassed the lifecycle barrier')
  for (const binding of harmonyContractBindings) {
    assert(
      harmonyDriverSource.includes(`case ${binding.callableID}:`),
      `Harmony Driver lacks contract callable ID ${binding.callableID}/${binding.callableName}`,
    )
  }
  assert(certification.generatedSources.driverSha256 === sha256(harmonyDriverSource), 'Harmony Driver certification is stale')
  assert(
    certification.generatedSources.platformDriverSha256 === sha256(readFileSync(join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-harmony/platform-driver.uts'))),
    'Harmony PlatformDriver certification is stale',
  )
  assert(certification.generatedSources.bindingCodesSha256 === sha256(harmonyOperationCodes), 'Harmony binding code certification is stale')
  assert(certification.generatedSources.harmonyFacadeSha256 === sha256(harmonySource), 'Harmony façade certification is stale')
  assert(
    certification.generatedSources.monomorphicCodecManifestSha256 === sha256(readFileSync(join(privateRoot, 'contracts/enterprise/harmony-monomorphic-codecs.json'))),
    'Harmony monomorphic codec certification is stale',
  )
  assert(!harmonySource.includes('noopUnsubscribe'), 'Harmony contains a silent noop event subscription')
  assert(harmonySource.includes('driverBindEventSink('), 'Harmony event sink is not bound through PlatformDriver')
  assert(harmonySource.includes('function dispatchHarmonyDriverEvent('), 'Harmony public-name event dispatcher drifted')
  assert(
    harmonySource.includes("onStringHarmonyEvent('onMessageModified', handler)"),
    'Harmony onMessageModified public-name subscription drifted',
  )
  assert(
    harmonySource.includes('export function offAll(eventName : OpenIMSDKEventName) : void { offAllHarmonyUTSSubscriptions(eventName) }'),
    'Harmony offAll does not clean by public event name',
  )
  assert(!harmonySource.includes('OpenIMHarmonyDriver'), 'Harmony UTS façade bypasses PlatformDriver')
  assert(!harmonySource.includes("from '@openimsdk/imsdk'"), 'Harmony UTS imports the HAR instead of using the ETS Driver')
  assert(!/harmonySDK\.(?:on|off|offAll)\s*(?:<[^>]+>)?\s*\(/.test(harmonySource), 'Harmony UTS bypasses the ETS event seam')
  assert(!/harmonySDK\.invoke\s*(?:<[^>]+>)?\s*\(/.test(harmonySource), 'Harmony UTS bypasses the typed operation switch')
  assert(!/harmonySDK\.[A-Za-z_$][\w$]*\s*\(/.test(harmonySource), 'Harmony UTS directly calls the HAR instead of the ETS Driver')
  for (const eventName of expectedUnsupportedEvents) {
    assert(
      harmonySource.includes(`unsupportedHarmonyEvent('${eventName}')`),
      `Harmony unsupported event is not diagnostic: ${eventName}`,
    )
  }
  for (const callableName of expectedUnsupportedOperations) {
    assert(
      harmonySource.includes(`'${callableName}', 'is not exposed by the Harmony HAR'`),
      `Harmony unsupported operation is not diagnostic: ${callableName}`,
    )
  }
  verifyEnterpriseDriverInvariants(publicRoot, privateRoot)
}

export function bootstrapEnterpriseDrivers(publicRoot: string, privateRoot: string): void {
  const harmonyFacadePath = join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-harmony/index.uts')
  writeText(harmonyFacadePath, renderHarmonyMonomorphicHelpers(privateRoot))
  const harmonyDriverPath = join(privateRoot, 'sdk-src/native/harmony/OpenIMHarmonyDriver.ets')
  writeText(harmonyDriverPath, renderHarmonyDriverBindings(privateRoot))
  const harmonyOperationCodesPath = join(privateRoot, 'sdk-src/uts/app-harmony/harmony-operation-codes.uts')
  writeText(harmonyOperationCodesPath, renderHarmonyOperationCodes(privateRoot))
  const files = [
    {
      source: join(publicRoot, 'sdk-src/native/android/OpenIMDriverRuntime.kt'),
      target: join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-android/OpenIMDriverRuntime.kt'),
    },
    {
      source: join(publicRoot, 'sdk-src/native/ios/OpenIMDriverRuntime.swift'),
      target: join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-ios/OpenIMDriverRuntime.swift'),
    },
    {
      source: join(privateRoot, 'sdk-src/native/harmony/OpenIMHarmonyDriver.ets'),
      target: join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-harmony/OpenIMHarmonyDriver.ets'),
    },
    {
      source: harmonyOperationCodesPath,
      target: join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-harmony/harmony-operation-codes.uts'),
    },
  ]
  for (const file of files) writeText(file.target, readFileSync(file.source, 'utf8'))
}
