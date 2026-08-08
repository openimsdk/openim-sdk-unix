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
  declaration: SourceByPlatform
  signatureHash: string
}

export type DriverRequestFieldCodec =
  | 'identity'
  | 'json'
  | 'file-json'
  | 'local-media-path'
  | 'message-entity-list-json'
  | 'message-json'
  | 'message-list-json'
  | 'optional-message-json'
  | 'optional-string'
  | 'picture-json'
  | 'sound-json'
  | 'video-json'
  | 'offline-push-json'
  | 'online-only'

export interface DriverRequestField {
  name: string
  parameter: string
  member?: string
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
}

export type CallableLowering =
  | {
    kind: 'event-control'
    action: 'remove-subscription' | 'remove-all'
  }
  | {
    kind: 'platform-driver'
    transport: 'async' | 'sync'
    operationID: 'parameter' | 'send-options' | 'empty'
    request: DriverRequest
    nativeInvocation?: DriverNativeInvocation
    precondition?: 'logged-in-create'
    bindEvents?: boolean
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
  declaration?: Partial<SourceByPlatform>
  lowering?: CallableLowering
  binding: Record<Platform, NativeBinding | undefined>
  signatureHash: string
}

export interface ContractEvent {
  id: number
  name: string
  callable: string
  handlerType: string
  dispatchArguments: SourceByPlatform
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
  constants: ContractConstant[]
  types: ContractType[]
  typeExtensions: EnterpriseTypeExtension[]
  callables: ContractCallable[]
  events: ContractEvent[]
}
