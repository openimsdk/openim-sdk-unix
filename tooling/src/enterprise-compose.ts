import ts from 'typescript'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type {
  ContractCallable,
  ContractDocument,
  ContractEvent,
  ContractType,
  EnterpriseDeltaDocument,
  EnterpriseTypeExtension,
  NativeBinding,
  Platform,
} from './model.js'
import { withComputedSemanticHashes } from './contract-integrity.js'
import { normalizeContractText, sha256 } from './source.js'
import { extractExportedTypes, extractExportedValues, parseSource } from './source.js'
import { INDEX_MARKERS, makeIndexTemplate } from './template-authority.js'
import {
  generateEvents,
  generateAutomationProfileRegistry,
  generateInterface,
  generatedSource,
  generateIndexFromTemplate,
  buildSurfaceSnapshot,
  type GeneratedOutput,
} from './generate.js'
import {
  demonomorphizeHarmonySource,
  demonomorphizeHarmonyText,
  monomorphizeHarmonySource,
  type HarmonyMonomorphicManifest,
} from './harmony-monomorphize.js'
import { renderHarmonyDriverBindings, renderHarmonyOperationCodes } from './harmony-bindings.js'
import { renderHarmonyPlatformDriver } from './harmony-platform-driver.js'
import { renderNativeCoreAdapter, renderPlatformDriverUTS } from './platform-driver.js'
import { buildEnterpriseResponseSchemas, buildEnterpriseTestDisposition } from './test-contract.js'

export interface HarmonyFacadeProjectionEntry {
  name: string
  declaration: string
}

export interface HarmonyEventProjectionEntry {
  name: string
  dispatchArguments: string
  binding: 'bound' | 'projected' | 'unsupported-by-native-abi'
}

export interface EnterpriseHarmonyFacadeProjection {
  schemaVersion: 1
  edition: 'enterprise-harmony-facade'
  origin: {
    sourcePath: string
    sourceSha256: string
  }
  constants: HarmonyFacadeProjectionEntry[]
  callables: HarmonyFacadeProjectionEntry[]
  events: HarmonyEventProjectionEntry[]
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function replaceTypeNode(declaration: string, replacement: string): string {
  const source = ts.createSourceFile('contract.uts', declaration, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const alias = source.statements.find(ts.isTypeAliasDeclaration)
  assert(alias != null, `Cannot parse contract type declaration: ${declaration}`)
  return `${declaration.slice(0, alias.type.getStart(source))}${replacement}${declaration.slice(alias.type.getEnd())}`
}

function extendType(type: ContractType, extension: EnterpriseTypeExtension): ContractType {
  const source = ts.createSourceFile('contract.uts', type.declaration, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const alias = source.statements.find(ts.isTypeAliasDeclaration)
  assert(alias != null, `Cannot parse public type ${type.name}`)
  let replacement: string
  if (extension.kind === 'optional-object-members') {
    assert(ts.isTypeLiteralNode(alias.type), `Enterprise extension ${type.name} requires an object type`)
    const body = alias.type.getText(source)
    const members = extension.addedMembers.map((member) => `  ${member.trim()}`).join('\n')
    replacement = `${body.slice(0, -1).trimEnd()}\n${members}\n}`
  } else {
    const body = alias.type.getText(source).trimEnd()
    replacement = `${body} |\n${extension.addedMembers.map((member) => `  ${member.trim()}`).join(' |\n')}`
  }
  const declaration = replaceTypeNode(type.declaration, replacement)
  assert(
    sha256(normalizeContractText(declaration)) === extension.privateSignatureHash,
    `Enterprise type extension hash is stale: ${type.name}`,
  )
  return { ...type, declaration, signatureHash: '' }
}

function projectionMap(entries: HarmonyFacadeProjectionEntry[], label: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const entry of entries) {
    assert(!result.has(entry.name), `Duplicate Harmony ${label} projection: ${entry.name}`)
    result.set(entry.name, entry.declaration)
  }
  return result
}

function composeTypes(base: ContractDocument, delta: EnterpriseDeltaDocument): ContractType[] {
  const extensions = new Map(delta.typeExtensions.map((value) => [value.target, value]))
  const overrides = new Map((delta.approvedBaseTypeOverrides ?? []).map((value) => [value.name, value]))
  const types = base.types.map((baseType): ContractType => {
    const override = overrides.get(baseType.name)
    assert(!(override != null && extensions.has(baseType.name)), `Enterprise type ${baseType.name} cannot be overridden and extended`)
    if (override != null) {
      assert(normalizeContractText(baseType.declaration) === normalizeContractText(override.baseDeclaration), `Base type override origin drifted: ${baseType.name}`)
      assert(sha256(normalizeContractText(override.baseDeclaration)) === override.baseHash, `Base type override hash is stale: ${baseType.name}`)
      assert(sha256(normalizeContractText(override.enterpriseDeclaration)) === override.enterpriseHash, `Enterprise type override hash is stale: ${baseType.name}`)
      return { ...baseType, declaration: override.enterpriseDeclaration, signatureHash: '' }
    }
    const extension = extensions.get(baseType.name)
    return extension == null ? { ...baseType } : extendType(baseType, extension)
  })
  for (const target of extensions.keys()) assert(base.types.some((value) => value.name === target), `Unknown Enterprise type extension: ${target}`)
  for (const name of overrides.keys()) assert(base.types.some((value) => value.name === name), `Unknown Enterprise type override: ${name}`)
  return [...types, ...delta.types.map((value) => ({ ...value }))]
}

function composeCallable(
  callable: ContractCallable,
  harmonyDeclaration: string,
  override?: EnterpriseDeltaDocument['approvedBaseCallableOverrides'][number],
): ContractCallable {
  const source = override == null ? callable : {
    ...callable,
    signature: override.enterpriseSignature,
    ...(override.declaration == null ? {} : { declaration: override.declaration }),
    ...(override.lowering == null ? {} : { lowering: override.lowering }),
    binding: override.binding ?? callable.binding,
    signatureHash: '',
  }
  if (override != null) {
    assert(callable.signature === override.baseSignature, `Base callable override origin drifted: ${callable.name}`)
    assert(override.baseHash === sha256(normalizeContractText(override.baseSignature)), `Base callable override hash is stale: ${callable.name}`)
    assert(override.enterpriseHash === sha256(normalizeContractText(override.enterpriseSignature)), `Enterprise callable override hash is stale: ${callable.name}`)
  }
  return {
    ...source,
    declaration: { ...(source.declaration ?? {}), harmony: harmonyDeclaration },
    binding: {
      ...source.binding,
      harmony: source.binding.harmony ?? ({ kind: 'dynamic-invoke', symbol: source.name } satisfies NativeBinding),
    },
    signatureHash: '',
  }
}

export function composeHarmonyDeclaration(callable: ContractCallable, declaration: string): string {
  if (callable.name === 'offAll') {
    return 'export function offAll(eventName : OpenIMSDKEventName) : void { offAllHarmonyUTSSubscriptions(eventName) }'
  }
  if (callable.role === 'event-subscription') {
    return declaration.replace(/,\s*harmonyEventCode\('[^']+'\)/g, '')
  }
  if (callable.role !== 'operation') return declaration
  let result = declaration
    .replace(/OpenIMHarmonyDriver\.callAsync\(\d+/g, `callHarmonyDriverAsync(${callable.id}`)
    .replace(/callHarmonyDriverAsync\(400\d{3}/g, `callHarmonyDriverAsync(${callable.id}`)
    .replace(/(invokeHarmonyEmpty\()('(?:[^'\\]|\\.)*')/g, `$1${callable.id}, $2`)
    .replace(/(invokeHarmonyMapped<[^\n]+?>\()('(?:[^'\\]|\\.)*')/g, `$1${callable.id}, $2`)
  if (callable.name === 'deleteConversation') {
    result = `export const deleteConversation = function (conversationID : string, operationID ?: string | null) : Promise<string> { return invokeHarmonyEmpty(${callable.id}, 'deleteConversationAndDeleteAllMsg', makeConversationIDReq(conversationID), operationID) }`
  }
  if (callable.name === 'updateFriends') {
    result = `export const updateFriends = function (params : OpenIMUpdateFriendsParams, operationID ?: string | null) : Promise<string> { return updateFriendsSequential(${callable.id}, params, operationID) }`
  }
  if (callable.name === 'setAppBackgroundStatus') {
    result = `export const setAppBackgroundStatus = function (data : boolean, operationID ?: string | null) : Promise<string> { return invokeHarmonyEmpty(${callable.id}, 'setAppBackgroundStatus', { isBackground: data } as ESObject, operationID) }`
  }
  if (callable.name === 'setAppBadge') {
    result = `export const setAppBadge = function (appUnreadCount : number, operationID ?: string | null) : Promise<string> { return invokeHarmonyEmpty(${callable.id}, 'setAppBadge', { appUnreadCount: appUnreadCount } as ESObject, operationID) }`
  }
  if (callable.name === 'networkStatusChanged') {
    result = `export const networkStatusChanged = function (operationID ?: string | null) : Promise<string> { return invokeHarmonyEmpty(${callable.id}, 'networkStatusChanged', {} as ESObject, operationID) }`
  }
  if (callable.name === 'cancelUpload') {
    result = `export const cancelUpload = function (params : OpenIMCancelUploadParams, operationID ?: string | null) : Promise<string> { return invokeHarmonyEmpty(${callable.id}, 'cancelUpload', { cancelID: params.cancelID } as ESObject, operationID) }`
  }
  assert(!/400\d{3}/.test(result), `Harmony callable retained a legacy operation ID: ${callable.name}`)
  return result
}

export function composeEnterpriseContract(
  base: ContractDocument,
  delta: EnterpriseDeltaDocument,
  harmony: EnterpriseHarmonyFacadeProjection,
): ContractDocument {
  assert(base.edition === 'public', 'Enterprise composition requires the Public base contract')
  assert(delta.edition === 'enterprise-delta', 'Enterprise composition requires an Enterprise delta')
  assert(harmony.edition === 'enterprise-harmony-facade', 'Enterprise composition requires a Harmony façade projection')
  const harmonyCallables = projectionMap(harmony.callables, 'callable')
  const harmonyEvents = new Map(harmony.events.map((value) => [value.name, value]))
  const overrides = new Map(delta.approvedBaseCallableOverrides.map((value) => [value.name, value]))
  const constants = [...base.constants, ...delta.constants].map((value) => ({ ...value, signatureHash: '' }))
  const callables = [...base.callables, ...delta.callables].map((value) => {
    const declaration = harmonyCallables.get(value.name)
    assert(declaration != null, `Missing Harmony callable projection: ${value.name}`)
    const override = base.callables.some((baseCallable) => baseCallable.name === value.name)
      ? overrides.get(value.name)
      : undefined
    return composeCallable(value, composeHarmonyDeclaration(value, declaration), override)
  })
  for (const override of overrides.values()) {
    assert(base.callables.some((value) => value.name === override.name), `Unknown Enterprise callable override: ${override.name}`)
  }
  const events: ContractEvent[] = [...base.events, ...delta.events].map((value) => {
    const projection = harmonyEvents.get(value.name)
    assert(projection != null, `Missing Harmony event projection: ${value.name}`)
    return {
      ...value,
      binding: { ...value.binding, harmony: projection.binding },
      signatureHash: '',
    }
  })
  const expected = delta.expectedTotal
  assert(constants.length === expected.constants, 'Enterprise constant composition count changed')
  const types = composeTypes(base, delta)
  assert(types.length === expected.types, 'Enterprise type composition count changed')
  assert(callables.length === expected.callables, 'Enterprise callable composition count changed')
  assert(events.length === expected.events, 'Enterprise event composition count changed')
  return withComputedSemanticHashes({
    schemaVersion: 2,
    edition: 'enterprise',
    origin: {
      kind: 'imported-facade',
      repository: delta.origin.repository,
      revision: delta.origin.revision,
      interfacePath: delta.origin.interfacePath,
      facadePaths: delta.origin.facadePaths,
    },
    expected,
    constants,
    types,
    callables,
    events,
  })
}

export function callableOverrideHash(signature: string): string {
  return sha256(normalizeContractText(signature))
}

export function requiredProjectionPlatforms(): Platform[] {
  return ['android', 'ios', 'harmony']
}

const ENTERPRISE_TEMPLATE_PATHS = {
  android: 'sdk-src/uts/app-android/index.enterprise.template.uts',
  ios: 'sdk-src/uts/app-ios/index.enterprise.template.uts',
  harmony: 'sdk-src/uts/app-harmony/index.template.uts',
} as const

export const ENTERPRISE_HARMONY_PROJECTION_PATH = 'sdk-src/uts/app-harmony/facade-projection.json'

function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content.endsWith('\n') ? content : `${content}\n`)
}

function readContract(path: string): ContractDocument {
  return JSON.parse(readFileSync(path, 'utf8')) as ContractDocument
}

function readDelta(path: string): EnterpriseDeltaDocument {
  return JSON.parse(readFileSync(path, 'utf8')) as EnterpriseDeltaDocument
}

function buildEnterpriseIndexTemplate(
  path: string,
  constants: Set<string>,
  callables: ContractCallable[],
): string {
  const eventCallables = new Set(callables.filter((value) => value.role !== 'operation').map((value) => value.name))
  const operations = new Set(callables.filter((value) => value.role === 'operation').map((value) => value.name))
  return makeIndexTemplate(parseSource(path), constants, eventCallables, operations)
}

function declarationNames(statement: ts.Statement): string[] {
  if (ts.isFunctionDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) {
    return statement.name == null ? [] : [statement.name.text]
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations
      .map((value) => ts.isIdentifier(value.name) ? value.name.text : '')
      .filter((value) => value !== '')
  }
  return []
}

function exported(statement: ts.Statement): boolean {
  return (ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined)
    ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
}

function importedNames(statement: ts.Statement): string[] {
  if (!ts.isImportDeclaration(statement) || statement.importClause == null) return []
  const names = statement.importClause.name == null ? [] : [statement.importClause.name.text]
  const bindings = statement.importClause.namedBindings
  if (bindings == null) return names
  if (ts.isNamespaceImport(bindings)) return [...names, bindings.name.text]
  return [...names, ...bindings.elements.map((element) => element.name.text)]
}

export function mergePublicTemplateHelpers(publicTemplate: string, enterpriseTemplate: string): string {
  const publicSource = ts.createSourceFile('public-template.uts', publicTemplate, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const enterpriseSource = ts.createSourceFile('enterprise-template.uts', enterpriseTemplate, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const enterpriseNames = new Set(enterpriseSource.statements.flatMap((statement) => [
    ...declarationNames(statement),
    ...importedNames(statement),
  ]))
  const missing = publicSource.statements
    .filter((statement) => !exported(statement))
    .filter((statement) => {
      const names = declarationNames(statement)
      return names.length > 0 && names.every((name) => !enterpriseNames.has(name))
    })
    .map((statement) => statement.getText(publicSource))
  if (missing.length === 0) return enterpriseTemplate
  assert(enterpriseTemplate.includes(INDEX_MARKERS.eventCallables), 'Enterprise template event marker is missing')
  return enterpriseTemplate.replace(
    INDEX_MARKERS.eventCallables,
    `${missing.join('\n\n')}\n\n${INDEX_MARKERS.eventCallables}`,
  )
}

export interface EnterpriseComposerAuthority {
  delta: EnterpriseDeltaDocument
  projection: EnterpriseHarmonyFacadeProjection
  templates: Record<'android' | 'ios' | 'harmony', string>
}

/**
 * One-time migration helper. Generation never calls this function: it is the
 * explicit boundary that moves the last façade-owned knowledge into sdk-src.
 */
export function extractEnterpriseComposerAuthority(
  publicRoot: string,
  privateRoot: string,
): EnterpriseComposerAuthority {
  const base = readContract(join(publicRoot, 'contracts/base/contract.json'))
  const delta = readDelta(join(privateRoot, 'contracts/enterprise/delta.json'))
  const callables = [...base.callables, ...delta.callables]
  const constants = [...base.constants, ...delta.constants]
  const constantNames = new Set(constants.map((value) => value.name))
  const pluginRoot = join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk')
  const platformPaths = {
    android: join(pluginRoot, 'app-android/index.uts'),
    ios: join(pluginRoot, 'app-ios/index.uts'),
    harmony: join(pluginRoot, 'app-harmony/index.uts'),
  } as const
  const manifest = JSON.parse(
    readFileSync(join(privateRoot, 'contracts/enterprise/harmony-monomorphic-codecs.json'), 'utf8'),
  ) as HarmonyMonomorphicManifest
  const harmonyValues = new Map(extractExportedValues(parseSource(platformPaths.harmony)).map((value) => [value.name, value]))
  const projection: EnterpriseHarmonyFacadeProjection = {
    schemaVersion: 1,
    edition: 'enterprise-harmony-facade',
    origin: {
      sourcePath: relative(privateRoot, platformPaths.harmony),
      sourceSha256: sha256(readFileSync(platformPaths.harmony)),
    },
    constants: constants.map((value) => {
      const declaration = harmonyValues.get(value.name)?.declaration
      assert(declaration != null, `Missing Harmony constant during authority extraction: ${value.name}`)
      return { name: value.name, declaration: demonomorphizeHarmonyText(declaration, manifest) }
    }),
    callables: callables.map((value) => {
      const declaration = harmonyValues.get(value.name)?.declaration
      assert(declaration != null, `Missing Harmony callable during authority extraction: ${value.name}`)
      return { name: value.name, declaration: demonomorphizeHarmonyText(declaration, manifest) }
    }),
    events: [...base.events, ...delta.events].map((value) => ({
      name: value.name,
      dispatchArguments: '',
      binding: value.binding.harmony === 'unsupported-by-native-abi' ? 'unsupported-by-native-abi' : 'bound',
    })),
  }
  const loginCallable = base.callables.find((value) => value.name === 'getLoginUserID')
  assert(loginCallable != null, 'Public getLoginUserID contract is missing')
  const loginOverride = delta.approvedBaseCallableOverrides.find((value) => value.name === 'getLoginUserID')
  assert(loginOverride != null, 'Enterprise getLoginUserID override is missing')
  loginOverride.baseHash = callableOverrideHash(loginOverride.baseSignature)
  loginOverride.enterpriseHash = callableOverrideHash(loginOverride.enterpriseSignature)
  delete loginOverride.declaration
  loginOverride.lowering = {
    kind: 'platform-driver',
    transport: 'async',
    operationID: 'parameter',
    request: 'empty-object',
  }
  loginOverride.binding = {
    android: loginCallable.binding.android,
    ios: loginCallable.binding.ios,
    harmony: { kind: 'none', symbol: 'currentLoginUserID' },
  }
  const interfacePath = join(pluginRoot, 'interface.uts')
  const privateTypes = new Map(extractExportedTypes(parseSource(interfacePath)).map((value) => [value.name, value]))
  const baseLoginType = base.types.find((value) => value.name === 'GetLoginUserID')
  const privateLoginType = privateTypes.get('GetLoginUserID')
  assert(baseLoginType != null && privateLoginType != null, 'GetLoginUserID type override source is missing')
  delta.approvedBaseTypeOverrides = [{
    name: 'GetLoginUserID',
    baseDeclaration: baseLoginType.declaration,
    enterpriseDeclaration: privateLoginType.declaration,
    baseHash: sha256(normalizeContractText(baseLoginType.declaration)),
    enterpriseHash: sha256(normalizeContractText(privateLoginType.declaration)),
    reason: loginOverride.reason,
  }]
  return {
    delta,
    projection,
    templates: {
      android: mergePublicTemplateHelpers(
        readFileSync(join(publicRoot, 'sdk-src/uts/app-android/index.template.uts'), 'utf8'),
        buildEnterpriseIndexTemplate(platformPaths.android, constantNames, callables),
      ),
      ios: mergePublicTemplateHelpers(
        readFileSync(join(publicRoot, 'sdk-src/uts/app-ios/index.template.uts'), 'utf8'),
        buildEnterpriseIndexTemplate(platformPaths.ios, constantNames, callables),
      ),
      harmony: demonomorphizeHarmonySource(
        buildEnterpriseIndexTemplate(platformPaths.harmony, constantNames, callables),
        manifest,
      ),
    },
  }
}

export function writeEnterpriseComposerAuthority(
  privateRoot: string,
  authority: EnterpriseComposerAuthority,
): void {
  writeText(join(privateRoot, 'contracts/enterprise/delta.json'), JSON.stringify(authority.delta, null, 2))
  writeText(join(privateRoot, ENTERPRISE_HARMONY_PROJECTION_PATH), JSON.stringify(authority.projection, null, 2))
  for (const platform of ['android', 'ios', 'harmony'] as const) {
    writeText(join(privateRoot, ENTERPRISE_TEMPLATE_PATHS[platform]), authority.templates[platform])
  }
}

export function readEnterpriseHarmonyProjection(privateRoot: string): EnterpriseHarmonyFacadeProjection {
  const projection = JSON.parse(
    readFileSync(join(privateRoot, ENTERPRISE_HARMONY_PROJECTION_PATH), 'utf8'),
  ) as EnterpriseHarmonyFacadeProjection
  assert(projection.schemaVersion === 1, 'Unsupported Enterprise Harmony projection schema')
  assert(projection.edition === 'enterprise-harmony-facade', 'Invalid Enterprise Harmony projection edition')
  return projection
}

function normalizeOutputs(outputs: GeneratedOutput[]): GeneratedOutput[] {
  return outputs.map((output) => ({
    ...output,
    content: output.content.endsWith('\n') ? output.content : `${output.content}\n`,
  }))
}

export function buildEnterpriseGeneratedOutputs(publicRoot: string, privateRoot: string): GeneratedOutput[] {
  const base = readContract(join(publicRoot, 'contracts/base/contract.json'))
  const delta = readDelta(join(privateRoot, 'contracts/enterprise/delta.json'))
  const harmonyProjection = readEnterpriseHarmonyProjection(privateRoot)
  const contract = composeEnterpriseContract(base, delta, harmonyProjection)
  const testDisposition = buildEnterpriseTestDisposition(base, delta)
  const harmonyRaw = generateIndexFromTemplate(
    readFileSync(join(privateRoot, ENTERPRISE_TEMPLATE_PATHS.harmony), 'utf8'),
    contract,
    'harmony',
  )
  const harmony = monomorphizeHarmonySource(harmonyRaw)
  const harmonyDriver = renderHarmonyDriverBindings(privateRoot)
  const harmonyOperationCodes = renderHarmonyOperationCodes(privateRoot)
  const harmonyEventInventory = JSON.parse(
    readFileSync(join(privateRoot, 'contracts/enterprise/native-abi/harmony.json'), 'utf8'),
  ) as { events: Array<{ name: string; value: number }>; nativeEventAliases: Record<string, string> }
  const harmonyPlatformDriver = renderHarmonyPlatformDriver(
    contract,
    harmonyEventInventory,
  )
  return normalizeOutputs([
    {
      path: join(privateRoot, 'pages/index/openim-automation-profiles.uts'),
      content: generateAutomationProfileRegistry(testDisposition),
    },
    {
      path: join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/interface.uts'),
      content: generateInterface(contract),
    },
    {
      path: join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-android/index.uts'),
      content: generateIndexFromTemplate(
        readFileSync(join(privateRoot, ENTERPRISE_TEMPLATE_PATHS.android), 'utf8'),
        contract,
        'android',
      ),
    },
    {
      path: join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-ios/index.uts'),
      content: generateIndexFromTemplate(
        readFileSync(join(privateRoot, ENTERPRISE_TEMPLATE_PATHS.ios), 'utf8'),
        contract,
        'ios',
      ),
    },
    {
      path: join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-android/events.uts'),
      content: generateEvents(privateRoot, contract, 'android'),
    },
    {
      path: join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-ios/events.uts'),
      content: generateEvents(privateRoot, contract, 'ios'),
    },
    {
      path: join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-android/OpenIMDriverRuntime.kt'),
      content: generatedSource(readFileSync(join(publicRoot, 'sdk-src/native/android/OpenIMDriverRuntime.kt'), 'utf8')),
    },
    {
      path: join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-ios/OpenIMDriverRuntime.swift'),
      content: generatedSource(readFileSync(join(publicRoot, 'sdk-src/native/ios/OpenIMDriverRuntime.swift'), 'utf8')),
    },
    {
      path: join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-android/platform-driver.uts'),
      content: generatedSource(renderPlatformDriverUTS('android')),
    },
    {
      path: join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-ios/platform-driver.uts'),
      content: generatedSource(renderPlatformDriverUTS('ios')),
    },
    {
      path: join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-android/OpenIMCoreAdapter.kt'),
      content: generatedSource(renderNativeCoreAdapter(contract, 'android')),
    },
    {
      path: join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-ios/OpenIMCoreAdapter.swift'),
      content: generatedSource(renderNativeCoreAdapter(contract, 'ios')),
    },
    {
      path: join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-harmony/index.uts'),
      content: harmony.source,
    },
    {
      path: join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-harmony/OpenIMHarmonyDriver.ets'),
      content: harmonyDriver,
    },
    {
      path: join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-harmony/platform-driver.uts'),
      content: generatedSource(harmonyPlatformDriver),
    },
    {
      path: join(privateRoot, 'sdk-src/uts/app-harmony/harmony-operation-codes.uts'),
      content: harmonyOperationCodes,
    },
    {
      path: join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-harmony/harmony-operation-codes.uts'),
      content: harmonyOperationCodes,
    },
    {
      path: join(privateRoot, 'contracts/enterprise/surface.snapshot.json'),
      content: JSON.stringify(buildSurfaceSnapshot(contract), null, 2),
    },
    {
      path: join(privateRoot, 'contracts/enterprise/response-schemas.json'),
      content: JSON.stringify(buildEnterpriseResponseSchemas(base, delta), null, 2),
    },
    {
      path: join(privateRoot, 'contracts/enterprise/test-disposition.json'),
      content: JSON.stringify(testDisposition, null, 2),
    },
    {
      path: join(privateRoot, 'contracts/enterprise/harmony-monomorphic-codecs.json'),
      content: JSON.stringify(harmony.manifest, null, 2),
    },
  ])
}

export function generateEnterprise(publicRoot: string, privateRoot: string): GeneratedOutput[] {
  const outputs = buildEnterpriseGeneratedOutputs(publicRoot, privateRoot)
  const harmonyDriverOutput = outputs.find(
    (output) => output.path === join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-harmony/OpenIMHarmonyDriver.ets'),
  )
  assert(harmonyDriverOutput != null, 'Enterprise generation omitted the Harmony Driver projection')
  writeText(join(privateRoot, 'sdk-src/native/harmony/OpenIMHarmonyDriver.ets'), harmonyDriverOutput.content)
  for (const output of outputs) writeText(output.path, output.content)
  return outputs
}
