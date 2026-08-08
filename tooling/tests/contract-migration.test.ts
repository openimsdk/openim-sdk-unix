import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  applyApprovedMigration,
  assertApprovedMigration,
  createMigrationApproval,
  previewContractMigration,
} from '../src/contract-migration.js'
import {
  buildStableIDRegistry,
  semanticHashForCallable,
  withComputedSemanticHashes,
  type StableIDRegistry,
} from '../src/contract-integrity.js'
import type { ContractCallable, ContractDocument } from '../src/model.js'
import { previewPublicContractImport } from '../src/public-contract-import.js'
import { generate } from '../src/generate.js'
import { writeGeneratedManifest } from '../src/generated-manifest.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function callable(id: number, name: string, signature = `${name}():void`): ContractCallable {
  const value: ContractCallable = {
    id,
    name,
    signature,
    completion: 'void',
    responseCodec: 'void',
    errorPolicy: 'none',
    rawString: false,
    role: 'operation',
    declaration: {
      android: `export function ${signature} {}`,
      ios: `export function ${signature} {}`,
    },
    binding: {
      android: { kind: 'native', symbol: name },
      ios: { kind: 'native', symbol: name },
      harmony: undefined,
    },
    signatureHash: '',
  }
  value.signatureHash = semanticHashForCallable(value)
  return value
}

function contract(callables: ContractCallable[], revision = 'current'): ContractDocument {
  return withComputedSemanticHashes({
    schemaVersion: 2,
    edition: 'public',
    origin: {
      kind: 'imported-facade',
      repository: 'fixture',
      revision,
      interfacePath: 'interface.uts',
      facadePaths: { android: 'android/index.uts', ios: 'ios/index.uts' },
    },
    expected: { constants: 0, types: 0, callables: callables.length, events: 0 },
    constants: [],
    types: [],
    callables,
    events: [],
  })
}

function renamedRegistry(current: StableIDRegistry, id: number, oldName: string, newName: string): StableIDRegistry {
  const candidate = structuredClone(current)
  const entry = candidate.namespaces.callables.find((value) => value.id === id)
  assert.ok(entry)
  entry.name = newName
  entry.previousNames = [...entry.previousNames, oldName]
  return candidate
}

test('preview is deterministic and reorder does not create semantic changes', () => {
  const current = contract([callable(2001, 'first'), callable(2002, 'second')])
  const candidate = contract([...current.callables].reverse())
  const registry = buildStableIDRegistry(current)

  const left = previewContractMigration({
    currentContract: current,
    currentRegistry: registry,
    candidateContract: candidate,
    candidateRegistry: structuredClone(registry),
    currentOutputs: { 'b.txt': 'same', 'a.txt': 'same' },
    candidateOutputs: { 'a.txt': 'same', 'b.txt': 'same' },
  })
  const right = previewContractMigration({
    currentContract: current,
    currentRegistry: registry,
    candidateContract: candidate,
    candidateRegistry: structuredClone(registry),
    currentOutputs: { 'a.txt': 'same', 'b.txt': 'same' },
    candidateOutputs: { 'b.txt': 'same', 'a.txt': 'same' },
  })

  assert.deepEqual(left.changes, [])
  assert.deepEqual(left.outputChanges, [])
  assert.equal(left.fingerprint, right.fingerprint)
})

test('preview distinguishes add, remove, rename, signature, ID, hash, and provenance changes', () => {
  const current = contract([
    callable(2001, 'removed'),
    callable(2002, 'oldName'),
    callable(2003, 'signature'),
    callable(2004, 'moved'),
    callable(2005, 'hashRepair'),
  ], 'old-revision')
  const currentRegistry = buildStableIDRegistry(current)
  const candidate = contract([
    callable(2002, 'newName'),
    callable(2003, 'signature', 'signature(value:string):void'),
    callable(2014, 'moved'),
    callable(2005, 'hashRepair'),
    callable(2015, 'added'),
  ], 'new-revision')
  const repaired = candidate.callables.find((value) => value.name === 'hashRepair')
  assert.ok(repaired)
  repaired.signatureHash = 'stale-candidate-hash'

  const candidateRegistry = renamedRegistry(currentRegistry, 2002, 'oldName', 'newName')
  candidateRegistry.namespaces.callables.find((value) => value.id === 2001)!.status = 'retired'
  candidateRegistry.namespaces.callables.push(
    { id: 2014, name: 'moved', status: 'active', previousNames: [] },
    { id: 2015, name: 'added', status: 'active', previousNames: [] },
  )
  candidateRegistry.namespaces.callables = candidateRegistry.namespaces.callables
    .filter((value) => !(value.id === 2004 && value.name === 'moved'))

  const preview = previewContractMigration({
    currentContract: current,
    currentRegistry,
    candidateContract: candidate,
    candidateRegistry,
    currentOutputs: { 'surface.json': 'old' },
    candidateOutputs: { 'surface.json': 'new' },
  })

  assert.deepEqual(new Set(preview.changes.map((value) => value.kind)), new Set([
    'add',
    'remove',
    'rename',
    'signature-change',
    'id-change',
    'hash-only',
    'provenance-only',
  ]))
  assert.equal(preview.normalization.candidateHashRepairs.length, 1)
  assert.equal(
    preview.normalizedCandidate.callables.find((value) => value.name === 'hashRepair')?.signatureHash,
    semanticHashForCallable(repaired),
  )
  assert.equal(preview.outputChanges[0]?.path, 'surface.json')
})

test('writes are impossible without an exact approval and occur in sorted order after approval', () => {
  const current = contract([callable(2001, 'operation')])
  const candidate = contract([callable(2001, 'operation'), callable(2002, 'added')])
  const currentRegistry = buildStableIDRegistry(current)
  const candidateRegistry = buildStableIDRegistry(candidate)
  const preview = previewContractMigration({
    currentContract: current,
    currentRegistry,
    candidateContract: candidate,
    candidateRegistry,
    candidateOutputs: { 'z.txt': 'last', 'a.txt': 'first' },
  })
  const writes: Array<[string, string | null]> = []

  assert.throws(
    () => applyApprovedMigration(preview, undefined, (path, content) => writes.push([path, content] as [string, string | null])),
    /Explicit migration approval is required/,
  )
  assert.equal(writes.length, 0)

  const wrongApproval = createMigrationApproval(preview, { approvedBy: 'test', reason: 'fixture' })
  wrongApproval.previewFingerprint = 'different-preview'
  assert.throws(() => assertApprovedMigration(preview, wrongApproval), /does not match preview/)
  assert.equal(writes.length, 0)

  const approval = createMigrationApproval(preview, { approvedBy: 'test', reason: 'fixture' })
  applyApprovedMigration(preview, approval, (path, content) => writes.push([path, content] as [string, string | null]))
  assert.deepEqual(writes, [['a.txt', 'first'], ['z.txt', 'last']])
})

test('retired IDs can never be reactivated or reused, even with approval', () => {
  const current = contract([callable(2002, 'active')])
  const currentRegistry = buildStableIDRegistry(current)
  currentRegistry.namespaces.callables.unshift({
    id: 2001,
    name: 'retired',
    status: 'retired',
    previousNames: [],
  })
  const candidate = contract([callable(2001, 'replacement'), callable(2002, 'active')])
  const candidateRegistry = structuredClone(currentRegistry)
  candidateRegistry.namespaces.callables[0] = {
    id: 2001,
    name: 'replacement',
    status: 'active',
    previousNames: ['retired'],
  }
  const preview = previewContractMigration({
    currentContract: current,
    currentRegistry,
    candidateContract: candidate,
    candidateRegistry,
  })
  const approval = createMigrationApproval(preview, { approvedBy: 'test', reason: 'must remain forbidden' })

  assert.match(preview.invariantViolations.join('\n'), /Retired callables ID 2001 cannot be reactivated/)
  assert.throws(() => assertApprovedMigration(preview, approval), /invariant violations/)
})

test('public contract import defaults to a temporary read-only preview', () => {
  const publicProjection = mkdtempSync(resolve(tmpdir(), 'openim-public-import-test-'))
  cpSync(resolve(root, 'contracts/base'), resolve(publicProjection, 'contracts/base'), { recursive: true })
  cpSync(resolve(root, 'sdk-src'), resolve(publicProjection, 'sdk-src'), { recursive: true })
  cpSync(resolve(root, 'tooling/src'), resolve(publicProjection, 'tooling/src'), { recursive: true })
  generate(publicProjection)
  writeGeneratedManifest(publicProjection)
  const contractPath = resolve(publicProjection, 'contracts/base/contract.json')
  const before = readFileSync(contractPath)
  const beforeModified = statSync(contractPath).mtimeMs

  const preview = previewPublicContractImport(publicProjection)

  assert.equal(preview.invariantViolations.length, 0)
  assert.equal(readFileSync(contractPath).equals(before), true)
  assert.equal(statSync(contractPath).mtimeMs, beforeModified)
})
