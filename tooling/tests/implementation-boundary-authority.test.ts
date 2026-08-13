import assert from 'node:assert/strict'
import test from 'node:test'
import { generateIndexFromTemplate } from '../src/generate.js'
import type {
  ContractCallable,
  ContractDocument,
  ImplementationBoundaryAuthority,
} from '../src/model.js'
import {
  PUBLIC_IMPLEMENTATION_BOUNDARY_AUTHORITY,
  implementationBoundaryAuthorityForEdition,
  implementationBoundaryEntriesSHA256,
} from '../src/platform-implementation-types.js'

const editionSignature = 'editionOperation(params:EditionOperationParams,operationID?:string|null):Promise<string>'

function editionCallable(): ContractCallable {
  return {
    id: 900001,
    name: 'editionOperation',
    signature: editionSignature,
    completion: 'promise',
    responseCodec: 'raw-string',
    errorPolicy: 'frozen-native-rejection',
    rawString: true,
    role: 'operation',
    testProfile: { semanticProfile: 'response-identity', sideEffectProbe: 'none' },
    lowering: {
      kind: 'platform-driver',
      transport: 'async',
      operationID: 'parameter',
      parameterTypes: { ios: { params: 'UTSJSONObject' } },
      request: {
        kind: 'fields',
        fields: [{
          name: 'editionInfo',
          parameter: 'params',
          codec: 'edition-json-writer',
          wireType: 'string',
        }],
      },
    },
    binding: {
      android: { kind: 'native', symbol: 'editionOperation' },
      ios: { kind: 'native', symbol: 'editionOperation' },
      harmony: undefined,
    },
    signatureHash: '',
  }
}

function editionContract(): ContractDocument {
  return {
    schemaVersion: 2,
    edition: 'enterprise',
    origin: {
      kind: 'imported-facade',
      repository: 'fixture',
      revision: 'fixture',
      interfacePath: 'interface.uts',
      facadePaths: { android: 'android/index.uts', ios: 'ios/index.uts' },
    },
    expected: { constants: 0, types: 0, callables: 1, events: 0 },
    constants: [],
    types: [],
    callables: [editionCallable()],
    events: [],
  }
}

function authority(): ImplementationBoundaryAuthority {
  return {
    entries: [{
      callable: 'editionOperation',
      signature: editionSignature,
      platform: 'ios',
      parameter: 'params',
      implementationType: 'UTSJSONObject',
      requestField: 'editionInfo',
      codec: 'edition-json-writer',
      writer: 'stringifyEditionOperationPayload',
    }],
  }
}

function template(parameterType: string, writer = 'stringifyEditionOperationPayload'): string {
  return `function ${writer}(params : ${parameterType}) : string { return '{}' }
// <openim-generated:constants>
// <openim-generated:event-callables>
// <openim-generated:operations>
`
}

test('edition authority extends the raw iOS implementation seam without edition API knowledge in Public tooling', () => {
  const document = editionContract()
  const extension = authority()
  const ios = generateIndexFromTemplate(template('UTSJSONObject'), document, 'ios', extension)
  const android = generateIndexFromTemplate(template('EditionOperationParams'), document, 'android', extension)

  assert.match(ios, /editionOperation = function \(params : UTSJSONObject, operationID \?: string \| null\)/)
  assert.match(ios, /stringifyEditionOperationPayload\(params\)/)
  assert.match(android, /editionOperation = function \(params : EditionOperationParams, operationID \?: string \| null\)/)
  assert.match(android, /stringifyEditionOperationPayload\(params\)/)
})

test('authority validation fails closed for missing, duplicate, unused, and every bound dimension', () => {
  const cases: Array<[string, (document: ContractDocument, value: ImplementationBoundaryAuthority) => void]> = [
    ['missing', (_document, value) => { value.entries = [] }],
    ['duplicate', (_document, value) => { value.entries.push(structuredClone(value.entries[0]!)) }],
    ['unused', (document) => {
      const lowering = document.callables[0]?.lowering
      if (lowering?.kind === 'platform-driver') delete lowering.parameterTypes
    }],
    ['wrong callable', (_document, value) => { value.entries[0]!.callable = 'unknownEditionOperation' }],
    ['wrong signature', (_document, value) => { value.entries[0]!.signature = editionSignature.replace('Promise<string>', 'Promise<boolean>') }],
    ['wrong platform', (_document, value) => { value.entries[0]!.platform = 'android' }],
    ['wrong parameter', (_document, value) => { value.entries[0]!.parameter = 'data' }],
    ['wrong type', (_document, value) => { value.entries[0]!.implementationType = 'any' }],
    ['wrong request field', (_document, value) => { value.entries[0]!.requestField = 'unknownInfo' }],
    ['wrong codec', (_document, value) => { value.entries[0]!.codec = 'json' }],
    ['wrong writer', (_document, value) => { value.entries[0]!.writer = 'not-valid()' }],
    ['request field writer escape', (document) => {
      const lowering = document.callables[0]?.lowering
      if (lowering?.kind !== 'platform-driver' || typeof lowering.request === 'string') return
      Object.assign(lowering.request.fields[0]!, { writer: 'bypassAuthorityWriter' })
    }],
  ]

  for (const [label, mutate] of cases) {
    const document = editionContract()
    const value = authority()
    mutate(document, value)
    assert.throws(
      () => generateIndexFromTemplate(template('UTSJSONObject'), document, 'ios', value),
      /Invalid implementation boundary authority/,
      `${label} authority drift escaped validation`,
    )
  }
})

test('template writer presence and platform-specific signatures are authority checked', () => {
  const document = editionContract()
  const value = authority()
  assert.throws(
    () => generateIndexFromTemplate(template('EditionOperationParams'), document, 'ios', value),
    /Invalid implementation boundary authority.*writer signature/,
  )
  assert.throws(
    () => generateIndexFromTemplate(template('UTSJSONObject'), document, 'android', value),
    /Invalid implementation boundary authority.*writer signature/,
  )
  assert.throws(
    () => generateIndexFromTemplate(template('UTSJSONObject', 'differentWriter'), document, 'ios', value),
    /Invalid implementation boundary authority.*writer is missing/,
  )
})

test('edition boundary hash is mandatory and exact before Public and edition authorities compose', () => {
  const entries = authority().entries
  const sha256 = implementationBoundaryEntriesSHA256(entries)
  const combined = implementationBoundaryAuthorityForEdition({ entries, sha256 })
  assert.deepEqual(combined.entries, [...PUBLIC_IMPLEMENTATION_BOUNDARY_AUTHORITY.entries, ...entries])
  assert.throws(
    () => implementationBoundaryAuthorityForEdition({ entries, sha256: '0'.repeat(64) }),
    /Invalid implementation boundary authority hash/,
  )
})

test('Public boundary authority is limited to runtime-supported Public seams', () => {
  assert.deepEqual(
    PUBLIC_IMPLEMENTATION_BOUNDARY_AUTHORITY.entries.map((entry) => entry.callable),
    ['setConversation', 'updateFriends'],
  )
})
