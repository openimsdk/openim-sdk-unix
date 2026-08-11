import assert from 'node:assert/strict'
import test from 'node:test'
import type { ContractDocument, EnterpriseDeltaDocument } from '../src/model.js'
import {
  callableOverrideHash,
  composeEnterpriseContract,
  composeHarmonyDeclaration,
  mergePublicTemplateHelpers,
  type EnterpriseHarmonyFacadeProjection,
} from '../src/enterprise-compose.js'
import { generateIndexFromTemplate } from '../src/generate.js'
import {
  demonomorphizeHarmonySource,
  monomorphizeHarmonySource,
  type HarmonyMonomorphicManifest,
} from '../src/harmony-monomorphize.js'
import { normalizeContractText, sha256 } from '../src/source.js'

function baseContract(): ContractDocument {
  return {
    schemaVersion: 2,
    edition: 'public',
    origin: {
      kind: 'imported-facade',
      repository: 'public', revision: 'base', interfacePath: 'interface.uts',
      facadePaths: { android: 'android', ios: 'ios' },
    },
    expected: { constants: 0, types: 2, callables: 1, events: 0 },
    constants: [],
    types: [
      { id: 1, name: 'GetLoginUserID', declaration: 'export type GetLoginUserID = () => Promise<string>', signatureHash: '' },
      { id: 2, name: 'Params', declaration: 'export type Params = {\n  value : string\n}', signatureHash: '' },
    ],
    callables: [{
      id: 2001,
      name: 'getLoginUserID',
      signature: 'getLoginUserID():Promise<string>',
      completion: 'promise', responseCodec: 'raw-string', errorPolicy: 'frozen-native-rejection',
      rawString: true, role: 'operation',
      testProfile: { semanticProfile: 'lifecycle-state', sideEffectProbe: 'none' },
      lowering: {
        kind: 'platform-driver', transport: 'async', operationID: 'empty', request: 'empty-object',
      },
      binding: { android: { kind: 'native', symbol: 'getLoginUserID' }, ios: { kind: 'native', symbol: 'getLoginUserID' }, harmony: undefined },
      signatureHash: '',
    }],
    events: [],
  }
}

test('Enterprise composition applies explicit overrides and additive type extensions', () => {
  const base = baseContract()
  const enterpriseType = 'export type GetLoginUserID = (operationID ?: string | null) => Promise<string>'
  const extendedParams = 'export type Params = {\n  value : string\n  extra ?: string | null\n}'
  const delta: EnterpriseDeltaDocument = {
    schemaVersion: 2,
    edition: 'enterprise-delta',
    origin: {
      kind: 'imported-facade',
      repository: 'private', revision: 'private', publicBaseRevision: 'base', importedPublicBaseContractHash: '0'.repeat(64),
      interfacePath: 'interface.uts', facadePaths: { android: 'android', ios: 'ios', harmony: 'harmony' },
    },
    expectedTotal: { constants: 0, types: 2, callables: 1, events: 0 },
    expectedDelta: { constants: 0, types: 0, callables: 0, events: 0, typeExtensions: 1 },
    approvedBaseCallableOverrides: [{
      name: 'getLoginUserID',
      baseSignature: 'getLoginUserID():Promise<string>',
      enterpriseSignature: 'getLoginUserID(operationID?:string|null):Promise<string>',
      baseHash: callableOverrideHash('getLoginUserID():Promise<string>'),
      enterpriseHash: callableOverrideHash('getLoginUserID(operationID?:string|null):Promise<string>'),
      reason: 'native ABI',
      lowering: {
        kind: 'platform-driver',
        transport: 'async',
        operationID: 'parameter',
        request: 'empty-object',
      },
    }],
    approvedBaseTypeOverrides: [{
      name: 'GetLoginUserID',
      baseDeclaration: base.types[0]!.declaration,
      enterpriseDeclaration: enterpriseType,
      baseHash: sha256(normalizeContractText(base.types[0]!.declaration)),
      enterpriseHash: sha256(normalizeContractText(enterpriseType)),
      reason: 'native ABI',
    }],
    constants: [], types: [], callables: [], events: [],
    typeExtensions: [{
      id: 150001,
      target: 'Params',
      kind: 'optional-object-members',
      addedMembers: ['extra ?: string | null'],
      privateSignatureHash: sha256(normalizeContractText(extendedParams)),
    }],
  }
  const harmony: EnterpriseHarmonyFacadeProjection = {
    schemaVersion: 1,
    edition: 'enterprise-harmony-facade',
    origin: { sourcePath: 'legacy', sourceSha256: '0'.repeat(64) },
    constants: [],
    callables: [{
      name: 'getLoginUserID',
      declaration: 'export const getLoginUserID = function (operationID ?: string | null) : Promise<string> { return Promise.resolve(operationID ?? \'\') }',
      binding: 'unsupported-by-native-abi',
    }],
    events: [],
  }

  const result = composeEnterpriseContract(base, delta, harmony)
  assert.equal(result.edition, 'enterprise')
  assert.equal(result.types.find((value) => value.name === 'GetLoginUserID')?.declaration, enterpriseType)
  assert.equal(result.types.find((value) => value.name === 'Params')?.declaration, extendedParams)
  assert.equal(result.callables[0]?.signature, 'getLoginUserID(operationID?:string|null):Promise<string>')
  assert.equal(result.callables[0]?.lowering?.kind, 'platform-driver')
  assert.equal(result.callables[0]?.lowering?.operationID, 'parameter')
  assert.equal(result.callables[0]?.declaration?.android, undefined)
  assert.equal(result.callables[0]?.declaration?.harmony, harmony.callables[0]?.declaration)
  assert.deepEqual(result.callables[0]?.binding.harmony, {
    kind: 'unsupported',
    symbol: 'unsupported-by-native-abi',
  })
})

test('Harmony monomorphization is a pure reproducible projection', () => {
  const generic = `// <openim-generated-harmony-monomorphic-codecs>\n// </openim-generated-harmony-monomorphic-codecs>\nfunction use(p : Promise<string>) : Promise<string> { return wrapHarmonyPromise<string>(p, 'use') }\nfunction map(params : ESObject) : Promise<string> { return invokeHarmonyMapped<string>('map', params, (_payload : ESObject) : string => { return '' }) }\n`
  const first = monomorphizeHarmonySource(generic)
  const second = monomorphizeHarmonySource(generic)
  assert.deepEqual(first, second)
  assert.equal(first.source.includes('wrapHarmonyPromise<string>'), false)
  assert.equal(first.source.includes('invokeHarmonyMapped<string>'), false)
  assert.match(first.source, /reason instanceof UniError/)
  assert.match(first.source, /reject\(reason\)/)
  assert.match(first.source, /rejectNativeError\(reject, -1, readErrorMessage\(reason, method\)\)/)
  const recovered = demonomorphizeHarmonySource(first.source, first.manifest as HarmonyMonomorphicManifest)
  assert.match(recovered, /wrapHarmonyPromise<string>/)
  assert.match(recovered, /invokeHarmonyMapped<string>/)
})

test('Enterprise templates inherit newly introduced Public helpers', () => {
  const publicTemplate = `function shared() : string { return 'public' }\nfunction added() : string { return shared() }\n// <openim-generated:event-callables>\n`
  const enterpriseTemplate = `function shared() : string { return 'enterprise' }\nfunction privateOnly() : string { return '' }\n// <openim-generated:event-callables>\n`
  const result = mergePublicTemplateHelpers(publicTemplate, enterpriseTemplate)
  assert.match(result, /function added\(\)/)
  assert.match(result, /return 'enterprise'/)
  assert.match(result, /function privateOnly\(\)/)
  assert.equal(result.match(/function shared\(\)/g)?.length, 1)
})

test('Enterprise imported helpers are not duplicated from the Public template', () => {
  const publicTemplate = `function parseNativeStringListValue(data : string) : Array<string> | null { return null }\n// <openim-generated:event-callables>\n`
  const enterpriseTemplate = `import { parseNativeStringListValue } from './native-call.uts'\n// <openim-generated:event-callables>\n`
  const result = mergePublicTemplateHelpers(publicTemplate, enterpriseTemplate)
  assert.equal(result.match(/parseNativeStringListValue/g)?.length, 1)
  assert.equal(result.includes('function parseNativeStringListValue'), false)
})

test('edition extensions lower local promises, synthetic events, and lifecycle hooks without business names in Public tooling', () => {
  const base = baseContract()
  const baseCallable = base.callables[0]!
  baseCallable.signature = 'getLoginUserID(userID:string):Promise<string>'
  baseCallable.lowering = {
    kind: 'platform-driver',
    transport: 'async',
    operationID: 'empty',
    request: 'empty-object',
  }
  const delta = {
    schemaVersion: 2,
    edition: 'enterprise-delta',
    origin: {
      kind: 'imported-facade', repository: 'private', revision: 'private', publicBaseRevision: 'base',
      importedPublicBaseContractHash: '0'.repeat(64), interfacePath: 'interface.uts',
      facadePaths: { android: 'android', ios: 'ios', harmony: 'harmony' },
    },
    expectedTotal: { constants: 0, types: 2, callables: 3, events: 1 },
    expectedDelta: { constants: 0, types: 0, callables: 2, events: 1, typeExtensions: 0 },
    approvedBaseCallableOverrides: [], approvedBaseTypeOverrides: [],
    constants: [], types: [], typeExtensions: [],
    editionExtensions: {
      localOperations: ['readLocalState'],
      syntheticEvents: ['onLocalStateChanged'],
      lifecycleEffects: [{
        callable: 'getLoginUserID',
        successHook: {
          symbol: 'recordLocalState',
          when: 'always',
          arguments: [{ kind: 'parameter', name: 'userID' }, { kind: 'result' }],
        },
      }],
    },
    callables: [
      {
        id: 3001, name: 'readLocalState', signature: 'readLocalState():Promise<string>', completion: 'promise',
        responseCodec: 'raw-string', errorPolicy: 'none', rawString: false, role: 'operation',
        testProfile: { semanticProfile: 'local-state', sideEffectProbe: 'none' },
        lowering: { kind: 'local-promise', symbol: 'readLocalStateLocal', arguments: [] },
        binding: {
          android: { kind: 'facade-alias', symbol: 'readLocalStateLocal' },
          ios: { kind: 'facade-alias', symbol: 'readLocalStateLocal' },
          harmony: { kind: 'facade-alias', symbol: 'readLocalStateLocal' },
        },
        signatureHash: '',
      },
      {
        id: 3002, name: 'onLocalStateChanged', signature: 'onLocalStateChanged(handler:LocalHandler):OpenIMSDKEventSubscription',
        completion: 'sync', responseCodec: 'event-handler', errorPolicy: 'none', rawString: false,
        role: 'event-subscription', testProfile: { semanticProfile: 'event-listener', sideEffectProbe: 'none' },
        lowering: {
          kind: 'synthetic-event-subscription', eventName: 'onLocalStateChanged', registerSymbol: 'registerLocalStateChanged',
        },
        binding: {
          android: { kind: 'facade-alias', symbol: 'registerLocalStateChanged' },
          ios: { kind: 'facade-alias', symbol: 'registerLocalStateChanged' },
          harmony: { kind: 'facade-alias', symbol: 'registerLocalStateChanged' },
        },
        signatureHash: '',
      },
    ],
    events: [{
      id: 4001, name: 'onLocalStateChanged', callable: 'onLocalStateChanged', handlerType: 'LocalHandler',
      decoder: { kind: 'parser', symbol: 'parseLocalState' }, rawPayload: false,
      binding: { android: 'projected', ios: 'projected', harmony: 'projected' }, signatureHash: '',
    }],
  } as unknown as EnterpriseDeltaDocument
  const harmony = {
    schemaVersion: 1,
    edition: 'enterprise-harmony-facade',
    origin: { sourcePath: 'legacy', sourceSha256: '0'.repeat(64) },
    constants: [],
    callables: [
      { name: 'getLoginUserID', declaration: 'export const getLoginUserID = function (userID : string) : Promise<string> { return Promise.resolve(userID).then((data : string) : string => { recordLocalState(userID, data); return data }) }' },
      { name: 'readLocalState', declaration: 'legacy local declaration' },
      { name: 'onLocalStateChanged', declaration: 'legacy synthetic declaration' },
    ],
    events: [{ name: 'onLocalStateChanged', dispatchArguments: '', binding: 'projected' }],
  } as EnterpriseHarmonyFacadeProjection

  const contract = composeEnterpriseContract(base, delta, harmony)
  const template = '// <openim-generated:constants>\n// <openim-generated:event-callables>\n// <openim-generated:operations>\n'
  const android = generateIndexFromTemplate(template, contract, 'android')
  const harmonySource = generateIndexFromTemplate(template, contract, 'harmony')
  assert.match(android, /return readLocalStateLocal\(\)/)
  assert.match(android, /@UTSJS\.keepAlive[\s\S]*return registerLocalStateChanged\(handler\)/)
  assert.match(android, /recordLocalState\(userID, data\)/)
  assert.match(harmonySource, /return readLocalStateLocal\(\)/)
  assert.match(harmonySource, /return registerLocalStateChanged\(handler\)/)
})

test('Harmony event subscriptions and offAll are projected through the public-name registry', () => {
  const eventCallable = {
    id: 2003,
    name: 'onConnecting',
    role: 'event-subscription',
  } as ContractDocument['callables'][number]
  const eventDeclaration = "export function onConnecting(handler : OpenIMVoidEventHandler) : OpenIMSDKEventSubscription { return onVoidHarmonyEvent('onConnecting', harmonyEventCode('EventOnConnecting'), handler) }"
  assert.equal(
    composeHarmonyDeclaration(eventCallable, eventDeclaration),
    "export function onConnecting(handler : OpenIMVoidEventHandler) : OpenIMSDKEventSubscription { return onVoidHarmonyEvent('onConnecting', handler) }",
  )
  const offAll = { id: 2002, name: 'offAll', role: 'event-control' } as ContractDocument['callables'][number]
  assert.equal(
    composeHarmonyDeclaration(offAll, 'legacy native-code cleanup'),
    'export function offAll(eventName : OpenIMSDKEventName) : void { offAllHarmonyUTSSubscriptions(eventName) }',
  )
})

test('Harmony local operation wrappers lower to the PlatformDriver seam', () => {
  const cases = [
    {
      id: 2069,
      name: 'setAppBackgroundStatus',
      declaration: "export const setAppBackgroundStatus = function (data : boolean, operationID ?: string | null) : Promise<string> { return wrapHarmonyPromise<string>(OpenIMHarmonyDriver.setAppBackgroundStatus(data, normalizeOperationID(operationID)), 'setAppBackgroundStatus') }",
      expected: "invokeHarmonyEmpty(2069, 'setAppBackgroundStatus', { isBackground: data } as ESObject, operationID)",
    },
    {
      id: 2070,
      name: 'setAppBadge',
      declaration: "export const setAppBadge = function (appUnreadCount : number, operationID ?: string | null) : Promise<string> { return wrapHarmonyPromise<string>(OpenIMHarmonyDriver.setAppBadge(appUnreadCount, normalizeOperationID(operationID)), 'setAppBadge') }",
      expected: "invokeHarmonyEmpty(2070, 'setAppBadge', { appUnreadCount: appUnreadCount } as ESObject, operationID)",
    },
    {
      id: 2071,
      name: 'networkStatusChanged',
      declaration: "export const networkStatusChanged = function (operationID ?: string | null) : Promise<string> { return wrapHarmonyPromise<string>(OpenIMHarmonyDriver.networkStatusChanged(normalizeOperationID(operationID)), 'networkStatusChanged') }",
      expected: "invokeHarmonyEmpty(2071, 'networkStatusChanged', {} as ESObject, operationID)",
    },
    {
      id: 200034,
      name: 'cancelUpload',
      declaration: "export const cancelUpload = function (params : OpenIMCancelUploadParams, operationID ?: string | null) : Promise<string> { return wrapHarmonyPromise<string>(OpenIMHarmonyDriver.cancelUpload(params.cancelID, normalizeOperationID(operationID)), 'cancelUpload') }",
      expected: "invokeHarmonyEmpty(200034, 'cancelUpload', { cancelID: params.cancelID } as ESObject, operationID)",
    },
  ]
  for (const value of cases) {
    const callable = { id: value.id, name: value.name, role: 'operation' } as ContractDocument['callables'][number]
    const declaration = composeHarmonyDeclaration(callable, value.declaration)
    assert.match(declaration, new RegExp(value.expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.doesNotMatch(declaration, /OpenIMHarmonyDriver/)
  }
})
