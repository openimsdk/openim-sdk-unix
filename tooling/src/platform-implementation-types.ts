import ts from 'typescript'
import type {
  ContractCallable,
  ContractDocument,
  DriverRequestField,
  HashedImplementationBoundaryAuthority,
  ImplementationBoundaryAuthority,
  ImplementationBoundaryAuthorityEntry,
  Platform,
} from './model.js'
import { normalizeContractText, sha256 } from './source.js'
import { splitSignatureParameters } from './signature.js'

export type {
  HashedImplementationBoundaryAuthority,
  ImplementationBoundaryAuthority,
  ImplementationBoundaryAuthorityEntry,
} from './model.js'

export const PUBLIC_IMPLEMENTATION_BOUNDARY_AUTHORITY: ImplementationBoundaryAuthority = {
  entries: [
    {
      callable: 'setConversation',
      signature: 'setConversation(params:OpenIMSetConversationParams,operationID?:string|null):Promise<string>',
      platform: 'ios',
      parameter: 'params',
      implementationType: 'UTSJSONObject',
      requestField: 'conversationInfo',
      codec: 'set-conversation-json',
      writer: 'stringifySetConversationPayload',
    },
    {
      callable: 'updateFriends',
      signature: 'updateFriends(params:OpenIMUpdateFriendsParams,operationID?:string|null):Promise<string>',
      platform: 'ios',
      parameter: 'params',
      implementationType: 'UTSJSONObject',
      requestField: 'friendInfo',
      codec: 'update-friends-json',
      writer: 'stringifyUpdateFriendsPayload',
    },
  ],
}

const BOUNDARY_CODECS = new Set([
  'set-conversation-json',
  'update-friends-json',
  'edition-json-writer',
])

function invalid(reason: string): never {
  throw new Error(`Invalid implementation boundary authority: ${reason}`)
}

function signatureParameters(callable: ContractCallable): Map<string, { optional: boolean; type: string }> {
  const prefix = `${callable.name}(`
  const separator = callable.signature.lastIndexOf('):')
  if (!callable.signature.startsWith(prefix) || separator < prefix.length) {
    return invalid(`${callable.name} canonical signature is malformed`)
  }
  const result = new Map<string, { optional: boolean; type: string }>()
  for (const parameter of splitSignatureParameters(callable.signature.slice(prefix.length, separator))) {
    const match = /^([A-Za-z_$][\w$]*)(\?)?:(.+)$/.exec(parameter.trim())
    if (match?.[1] == null || match[3] == null) {
      invalid(`${callable.name} canonical parameter is malformed: ${parameter.trim()}`)
    }
    if (result.has(match[1])) invalid(`${callable.name} canonical signature duplicates ${match[1]}`)
    result.set(match[1], { optional: match[2] != null, type: match[3] })
  }
  return result
}

function entryForCallable(
  callable: ContractCallable,
  authority: ImplementationBoundaryAuthority,
): ImplementationBoundaryAuthorityEntry | null {
  return authority.entries.find((entry) => entry.callable === callable.name) ?? null
}

export function implementationBoundaryEntriesSHA256(
  entries: readonly ImplementationBoundaryAuthorityEntry[],
): string {
  return sha256(JSON.stringify(entries))
}

export function implementationBoundaryAuthorityForEdition(
  editionAuthority?: HashedImplementationBoundaryAuthority,
): ImplementationBoundaryAuthority {
  if (editionAuthority == null) {
    return { entries: PUBLIC_IMPLEMENTATION_BOUNDARY_AUTHORITY.entries.map((entry) => ({ ...entry })) }
  }
  if (!/^[a-f0-9]{64}$/.test(editionAuthority.sha256)
    || implementationBoundaryEntriesSHA256(editionAuthority.entries) !== editionAuthority.sha256) {
    throw new Error('Invalid implementation boundary authority hash')
  }
  return {
    entries: [
      ...PUBLIC_IMPLEMENTATION_BOUNDARY_AUTHORITY.entries.map((entry) => ({ ...entry })),
      ...editionAuthority.entries.map((entry) => ({ ...entry })),
    ],
  }
}

export function validateImplementationBoundaryAuthority(
  contract: ContractDocument,
  authority: ImplementationBoundaryAuthority,
): void {
  if (authority == null || !Array.isArray(authority.entries)) invalid('entries are missing')
  const callableByName = new Map(contract.callables.map((callable) => [callable.name, callable]))
  const entryByCallable = new Map<string, ImplementationBoundaryAuthorityEntry>()
  const writerOwners = new Map<string, string>()

  for (const entry of authority.entries) {
    if (entry == null || typeof entry !== 'object') invalid('entry is malformed')
    if (!/^[A-Za-z_$][\w$]*$/.test(entry.callable)) invalid('callable is malformed')
    if (entryByCallable.has(entry.callable)) invalid(`duplicate entry for ${entry.callable}`)
    entryByCallable.set(entry.callable, entry)
    if (entry.platform !== 'ios') invalid(`${entry.callable} platform must be ios`)
    if (!/^[A-Za-z_$][\w$]*$/.test(entry.parameter)) invalid(`${entry.callable} parameter is malformed`)
    if (entry.implementationType !== 'UTSJSONObject') invalid(`${entry.callable} type must be UTSJSONObject`)
    if (!/^[A-Za-z_$][\w$]*$/.test(entry.requestField)) invalid(`${entry.callable} request field is malformed`)
    if (!BOUNDARY_CODECS.has(entry.codec)) invalid(`${entry.callable} codec is not a raw JSON writer codec`)
    if (!/^[A-Za-z_$][\w$]*$/.test(entry.writer)) invalid(`${entry.callable} writer is malformed`)
    const writerOwner = writerOwners.get(entry.writer)
    if (writerOwner != null) invalid(`duplicate writer ${entry.writer} for ${writerOwner} and ${entry.callable}`)
    writerOwners.set(entry.writer, entry.callable)

    const callable = callableByName.get(entry.callable)
    if (callable == null) invalid(`wrong callable ${entry.callable}`)
    if (callable.signature !== entry.signature) invalid(`${entry.callable} canonical signature changed`)
    if (callable.lowering?.kind !== 'platform-driver') invalid(`${entry.callable} is not a platform-driver callable`)
    const parameterTypes = callable.lowering.parameterTypes
    if (parameterTypes == null) invalid(`unused entry for ${entry.callable}`)
    const platformKeys = Object.keys(parameterTypes)
    if (platformKeys.length !== 1 || platformKeys[0] !== entry.platform) {
      invalid(`${entry.callable} parameter type platform does not match authority`)
    }
    const platformTypes = parameterTypes[entry.platform]
    if (platformTypes == null) invalid(`${entry.callable} parameter type platform is missing`)
    const parameterKeys = Object.keys(platformTypes)
    if (parameterKeys.length !== 1 || parameterKeys[0] !== entry.parameter) {
      invalid(`${entry.callable} parameter does not match authority`)
    }
    if (platformTypes[entry.parameter] !== entry.implementationType) {
      invalid(`${entry.callable} implementation type does not match authority`)
    }
    if (!signatureParameters(callable).has(entry.parameter)) {
      invalid(`${entry.callable} parameter is absent from the canonical signature`)
    }
    if (typeof callable.lowering.request !== 'object' || callable.lowering.request.kind !== 'fields') {
      invalid(`${entry.callable} requires a fields request`)
    }
    const fields = callable.lowering.request.fields.filter((field) => field.name === entry.requestField)
    if (fields.length !== 1) invalid(`${entry.callable} request field does not match authority`)
    const field = fields[0]!
    if (Object.prototype.hasOwnProperty.call(field, 'writer')) {
      invalid(`${entry.callable} request field cannot override the authority writer`)
    }
    if (field.parameter !== entry.parameter || field.member != null) {
      invalid(`${entry.callable} request field is not bound to the whole authority parameter`)
    }
    if (field.codec !== entry.codec) invalid(`${entry.callable} request codec does not match authority`)
  }

  for (const callable of contract.callables) {
    if (callable.lowering?.kind !== 'platform-driver' || callable.lowering.parameterTypes == null) continue
    if (!entryByCallable.has(callable.name)) invalid(`missing entry for ${callable.name}`)
  }
}

function writerFunction(template: string, writer: string): ts.FunctionDeclaration | null {
  const source = ts.createSourceFile('index.template.uts', template, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const matches = source.statements.filter((statement): statement is ts.FunctionDeclaration => (
    ts.isFunctionDeclaration(statement) && statement.name?.text === writer
  ))
  if (matches.length > 1) invalid(`duplicate template writer ${writer}`)
  return matches[0] ?? null
}

export function validateImplementationBoundaryTemplate(
  template: string,
  contract: ContractDocument,
  platform: Platform,
  authority: ImplementationBoundaryAuthority,
): void {
  validateImplementationBoundaryAuthority(contract, authority)
  if (platform === 'harmony') return
  const callableByName = new Map(contract.callables.map((callable) => [callable.name, callable]))
  for (const entry of authority.entries) {
    const callable = callableByName.get(entry.callable)!
    const declaration = writerFunction(template, entry.writer)
    if (declaration == null) invalid(`${entry.callable} writer is missing: ${entry.writer}`)
    const canonicalParameter = signatureParameters(callable).get(entry.parameter)
    if (canonicalParameter == null) invalid(`${entry.callable} canonical writer parameter is missing`)
    const expectedType = platform === entry.platform ? entry.implementationType : canonicalParameter.type
    const parameter = declaration.parameters[0]
    const parameterName = parameter != null && ts.isIdentifier(parameter.name) ? parameter.name.text : ''
    const parameterType = parameter?.type?.getText(declaration.getSourceFile()) ?? ''
    const returnType = declaration.type?.getText(declaration.getSourceFile()) ?? ''
    if (declaration.parameters.length !== 1
      || parameterName !== entry.parameter
      || parameter?.questionToken != null
      || normalizeContractText(parameterType) !== normalizeContractText(expectedType)
      || normalizeContractText(returnType) !== 'string') {
      invalid(`${entry.callable} writer signature does not match ${platform} authority`)
    }
  }
}

export function implementationParameterTypes(
  callable: ContractCallable,
  platform: Platform,
  authority: ImplementationBoundaryAuthority,
): Record<string, string> {
  const entry = entryForCallable(callable, authority)
  if (entry == null || entry.platform !== platform) return {}
  return { [entry.parameter]: entry.implementationType }
}

export function implementationBoundaryForRequestField(
  callable: ContractCallable,
  field: DriverRequestField,
  authority: ImplementationBoundaryAuthority,
): ImplementationBoundaryAuthorityEntry | null {
  const entry = entryForCallable(callable, authority)
  return entry?.requestField === field.name ? entry : null
}

export function isRegisteredJSONObjectImplementationBoundary(
  callable: ContractCallable,
  platform: Platform,
  authority: ImplementationBoundaryAuthority,
): boolean {
  const entry = entryForCallable(callable, authority)
  return entry != null
    && entry.platform === platform
    && entry.implementationType === 'UTSJSONObject'
}

export function implementationSignature(signature: string, parameterTypes: Record<string, string>): string {
  if (Object.keys(parameterTypes).length === 0) return signature
  const open = signature.indexOf('(')
  const close = signature.lastIndexOf('):')
  if (open < 0 || close < open) throw new Error(`Invalid canonical implementation signature: ${signature}`)
  const parameters = splitSignatureParameters(signature.slice(open + 1, close)).map((parameter) => {
    const match = /^([A-Za-z_$][\w$]*)(\?)?:(.+)$/.exec(parameter)
    if (match == null) throw new Error(`Invalid canonical implementation parameter: ${parameter}`)
    const name = match[1] ?? ''
    return `${name}${match[2] ?? ''}:${parameterTypes[name] ?? match[3] ?? ''}`
  })
  return `${signature.slice(0, open + 1)}${parameters.join(',')}${signature.slice(close)}`
}
