export type Platform = 'android' | 'ios' | 'harmony'

export type CompletionMode = 'promise' | 'sync' | 'void'

export interface SourceByPlatform {
  android: string
  ios: string
  harmony?: string
}

export interface NativeBinding {
  kind: 'native' | 'facade-alias' | 'event' | 'none' | 'dynamic-invoke' | 'unsupported'
  symbol: string
}

export interface ContractType {
  id: number
  name: string
  declaration: string
  signatureHash: string
}

export interface ContractConstant {
  id: number
  name: string
  type: string
  value: string
  signatureHash: string
}

export type DriverRequestFieldCodec =
  | 'identity'
  | 'json'
  | 'file-json'
  | 'file-message-path'
  | 'image-source-path'
  | 'local-media-path'
  | 'literal'
  | 'message-entity-list-json'
  | 'message-json'
  | 'message-list-json'
  | 'optional-message-json'
  | 'optional-boolean'
  | 'optional-string'
  | 'picture-json'
  | 'set-group-info-json'
  | 'set-group-member-info-json'
  | 'sound-json'
  | 'stored-message-json'
  | 'update-friend-json'
  | 'update-friends-json'
  | 'fetch-surrounding-messages-json'
  | 'modify-message-json'
  | 'video-json'
  | 'video-message-path'
  | 'video-snapshot-path'
  | 'offline-push-json'
  | 'online-only'

export interface DriverRequestField {
  name: string
  parameter?: string
  member?: string
  value?: string | number | boolean
  codec: DriverRequestFieldCodec
  wireType: 'string' | 'number' | 'boolean'
}

export type DriverRequest =
  | 'init-config'
  | 'login-credentials'
  | 'empty-object'
  | { kind: 'fields'; fields: DriverRequestField[] }

export interface DriverNativeInvocation {
  completion: 'sync-return' | 'callback'
  strategy?: {
    kind: 'path-prefix-dispatch'
    field: string
    alternateSymbol: string
  }
  deferIOSResolution?: boolean
}

export type DriverSuccessHookArgument =
  | { kind: 'parameter'; name: string }
  | { kind: 'result' }
  | { kind: 'literal'; value: string | number | boolean | null }

export interface DriverSuccessHook {
  symbol: string
  when: 'always' | 'boolean-true'
  arguments: DriverSuccessHookArgument[]
}

export type CallableLowering =
  | {
    kind: 'event-control'
    action: 'remove-subscription' | 'remove-all'
  }
  | {
    kind: 'local-helper'
    symbol: string
  }
  | {
    kind: 'local-promise'
    symbol: string
    arguments: string[]
  }
  | {
    kind: 'event-subscription'
    eventName: string
  }
  | {
    kind: 'synthetic-event-subscription'
    eventName: string
    registerSymbol: string
  }
  | {
    kind: 'callable-alias'
    target: string
    arguments: string[]
  }
  | {
    kind: 'platform-driver'
    transport: 'async' | 'sync'
    operationID: 'parameter' | 'send-options' | 'empty'
    request: DriverRequest
    nativeInvocation?: DriverNativeInvocation
    precondition?: 'logged-in-create'
    bindEvents?: boolean
    successHook?: DriverSuccessHook
  }

export interface ContractCallable {
  id: number
  name: string
  signature: string
  completion: CompletionMode
  responseCodec: string
  errorPolicy: string
  rawString: boolean
  role: 'operation' | 'event-subscription' | 'event-control'
  testProfile: {
    semanticProfile: string
    sideEffectProbe: string
    expectedEvents?: string[]
  }
  declaration?: Partial<SourceByPlatform>
  lowering?: CallableLowering
  binding: Record<Platform, NativeBinding | undefined>
  signatureHash: string
}

export type EventDecoder =
  | { kind: 'void' }
  | { kind: 'native-error' }
  | { kind: 'boolean' }
  | { kind: 'number' }
  | { kind: 'raw-string' }
  | { kind: 'parser'; symbol: string }

export interface ContractEvent {
  id: number
  name: string
  callable: string
  handlerType: string
  decoder: EventDecoder
  rawPayload: boolean
  binding: Record<Platform, 'bound' | 'projected' | 'unsupported-by-native-abi' | 'not-in-edition'>
  compatibilityRule?: string
  signatureHash: string
}

export interface ContractDocument {
  schemaVersion: 2
  edition: 'public' | 'enterprise'
  origin: {
    kind: 'imported-facade'
    repository: string
    revision: string
    interfacePath: string
    facadePaths: SourceByPlatform
  }
  expected: {
    constants: number
    types: number
    callables: number
    events: number
  }
  constants: ContractConstant[]
  types: ContractType[]
  callables: ContractCallable[]
  events: ContractEvent[]
}

export interface SurfaceSnapshot {
  schemaVersion: 1
  edition: 'public' | 'enterprise'
  counts: ContractDocument['expected']
  constants: Array<{ id: number; name: string; type: string; value: string; signatureHash: string }>
  types: Array<{ id: number; name: string; signatureHash: string }>
  callables: Array<{ id: number; name: string; signature: string; signatureHash: string }>
  events: Array<{ id: number; name: string; callable: string; handlerType: string; signatureHash: string }>
  contractHash: string
}

export interface EnterpriseTypeExtension {
  id: number
  target: string
  kind: 'optional-object-members' | 'string-union-members'
  addedMembers: string[]
  privateSignatureHash: string
}

export interface EnterpriseDeltaDocument {
  schemaVersion: 2
  edition: 'enterprise-delta'
  origin: {
    kind: 'imported-facade'
    repository: string
    revision: string
    publicBaseRevision: string
    importedPublicBaseContractHash: string
    interfacePath: string
    facadePaths: SourceByPlatform
  }
  expectedTotal: ContractDocument['expected']
  expectedDelta: ContractDocument['expected'] & { typeExtensions: number }
  approvedBaseCallableOverrides: Array<{
    name: string
    baseSignature: string
    enterpriseSignature: string
    baseHash?: string
    enterpriseHash?: string
    reason: string
    declaration?: SourceByPlatform
    lowering?: CallableLowering
    binding?: Record<Platform, NativeBinding | undefined>
  }>
  approvedBaseTypeOverrides?: Array<{
    name: string
    baseDeclaration: string
    enterpriseDeclaration: string
    baseHash: string
    enterpriseHash: string
    reason: string
  }>
  editionExtensions?: {
    localOperations: string[]
    syntheticEvents: string[]
    lifecycleEffects: Array<{
      callable: string
      successHook: DriverSuccessHook
    }>
  }
  constants: ContractConstant[]
  types: ContractType[]
  typeExtensions: EnterpriseTypeExtension[]
  callables: ContractCallable[]
  events: ContractEvent[]
}
