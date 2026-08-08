import type { ContractDocument } from './model.js'
import {
  withComputedSemanticHashes,
  type ContractIDNamespace,
  type StableIDEntry,
  type StableIDRegistry,
} from './contract-integrity.js'
import { sha256 } from './source.js'

export type ContractMigrationChangeKind =
  | 'add'
  | 'remove'
  | 'rename'
  | 'signature-change'
  | 'id-change'
  | 'hash-only'
  | 'provenance-only'

export interface ContractMigrationChange {
  kind: ContractMigrationChangeKind
  namespace: ContractIDNamespace | 'contract'
  beforeID?: number
  afterID?: number
  beforeName?: string
  afterName?: string
  beforeSemanticHash?: string
  afterSemanticHash?: string
}

export interface ContractMigrationOutputChange {
  path: string
  kind: 'add' | 'remove' | 'change'
  beforeHash?: string
  afterHash?: string
}

export interface ContractHashRepair {
  namespace: ContractIDNamespace
  id: number
  name: string
  storedHash: string
  computedHash: string
}

export interface ContractMigrationInput {
  currentContract: ContractDocument
  currentRegistry: StableIDRegistry
  candidateContract: ContractDocument
  candidateRegistry: StableIDRegistry
  currentOutputs?: Readonly<Record<string, string>>
  candidateOutputs?: Readonly<Record<string, string>>
}

export interface ContractMigrationPreview {
  schemaVersion: 1
  fingerprint: string
  changes: ContractMigrationChange[]
  outputChanges: ContractMigrationOutputChange[]
  invariantViolations: string[]
  normalization: {
    currentHashRepairs: ContractHashRepair[]
    candidateHashRepairs: ContractHashRepair[]
  }
  digests: {
    currentContract: string
    candidateContract: string
    currentRegistry: string
    candidateRegistry: string
  }
  normalizedCandidate: ContractDocument
  candidateOutputs: Array<{ path: string; content: string | null }>
}

export interface ContractMigrationApproval {
  schemaVersion: 1
  previewFingerprint: string
  approvedKinds: ContractMigrationChangeKind[]
  approvedBy: string
  reason: string
}

export interface ContractMigrationApprovalDetails {
  approvedBy: string
  reason: string
}

type MigrationSymbol = { id: number; name: string; signatureHash: string }

const namespaces: ContractIDNamespace[] = ['constants', 'types', 'callables', 'events']
const namespaceOrder = new Map(namespaces.map((namespace, index) => [namespace, index]))
const kindOrder: ContractMigrationChangeKind[] = [
  'remove',
  'rename',
  'id-change',
  'signature-change',
  'hash-only',
  'add',
  'provenance-only',
]

function hashRepairs(stored: ContractDocument, computed: ContractDocument): ContractHashRepair[] {
  const repairs: ContractHashRepair[] = []
  for (const namespace of namespaces) {
    const computedByID = new Map(
      (computed[namespace] as MigrationSymbol[]).map((value) => [value.id, value]),
    )
    for (const value of stored[namespace] as MigrationSymbol[]) {
      const normalized = computedByID.get(value.id)
      if (normalized != null && value.signatureHash !== normalized.signatureHash) {
        repairs.push({
          namespace,
          id: value.id,
          name: value.name,
          storedHash: value.signatureHash,
          computedHash: normalized.signatureHash,
        })
      }
    }
  }
  return repairs.sort(compareRepairs)
}

function compareRepairs(left: ContractHashRepair, right: ContractHashRepair): number {
  return (namespaceOrder.get(left.namespace) ?? 0) - (namespaceOrder.get(right.namespace) ?? 0)
    || left.id - right.id
    || left.name.localeCompare(right.name)
}

function compareChanges(left: ContractMigrationChange, right: ContractMigrationChange): number {
  const leftNamespace = left.namespace === 'contract' ? namespaces.length : (namespaceOrder.get(left.namespace) ?? 0)
  const rightNamespace = right.namespace === 'contract' ? namespaces.length : (namespaceOrder.get(right.namespace) ?? 0)
  return leftNamespace - rightNamespace
    || (left.beforeID ?? left.afterID ?? Number.MAX_SAFE_INTEGER) - (right.beforeID ?? right.afterID ?? Number.MAX_SAFE_INTEGER)
    || kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind)
    || (left.beforeName ?? left.afterName ?? '').localeCompare(right.beforeName ?? right.afterName ?? '')
}

function changesForNamespace(
  namespace: ContractIDNamespace,
  currentStored: MigrationSymbol[],
  currentComputed: MigrationSymbol[],
  candidateStored: MigrationSymbol[],
  candidateComputed: MigrationSymbol[],
): ContractMigrationChange[] {
  const changes: ContractMigrationChange[] = []
  const currentComputedByID = new Map(currentComputed.map((value) => [value.id, value]))
  const candidateComputedByID = new Map(candidateComputed.map((value) => [value.id, value]))
  const currentStoredByID = new Map(currentStored.map((value) => [value.id, value]))
  const candidateStoredByID = new Map(candidateStored.map((value) => [value.id, value]))
  const candidateByName = new Map(candidateComputed.map((value) => [value.name, value]))
  const pairedCurrent = new Set<number>()
  const pairedCandidate = new Set<number>()
  const pairs: Array<[MigrationSymbol, MigrationSymbol]> = []

  // Name-first matching exposes an ID change as one operation instead of a
  // misleading remove/add pair. Remaining equal IDs represent approved renames.
  for (const current of currentComputed) {
    const candidate = candidateByName.get(current.name)
    if (candidate == null || pairedCandidate.has(candidate.id)) continue
    pairs.push([current, candidate])
    pairedCurrent.add(current.id)
    pairedCandidate.add(candidate.id)
  }
  for (const current of currentComputed) {
    if (pairedCurrent.has(current.id)) continue
    const candidate = candidateComputedByID.get(current.id)
    if (candidate == null || pairedCandidate.has(candidate.id)) continue
    pairs.push([current, candidate])
    pairedCurrent.add(current.id)
    pairedCandidate.add(candidate.id)
  }

  for (const [current, candidate] of pairs) {
    const common = {
      namespace,
      beforeID: current.id,
      afterID: candidate.id,
      beforeName: current.name,
      afterName: candidate.name,
      beforeSemanticHash: current.signatureHash,
      afterSemanticHash: candidate.signatureHash,
    }
    if (current.id !== candidate.id) changes.push({ kind: 'id-change', ...common })
    if (current.name !== candidate.name) changes.push({ kind: 'rename', ...common })
    if (current.signatureHash !== candidate.signatureHash) {
      changes.push({ kind: 'signature-change', ...common })
    } else {
      const currentStoredHash = currentStoredByID.get(current.id)?.signatureHash
      const candidateStoredHash = candidateStoredByID.get(candidate.id)?.signatureHash
      if (
        currentStoredHash !== current.signatureHash
        || candidateStoredHash !== candidate.signatureHash
        || currentStoredHash !== candidateStoredHash
      ) {
        changes.push({ kind: 'hash-only', ...common })
      }
    }
  }

  for (const current of currentComputed) {
    if (pairedCurrent.has(current.id)) continue
    changes.push({
      kind: 'remove',
      namespace,
      beforeID: current.id,
      beforeName: current.name,
      beforeSemanticHash: current.signatureHash,
    })
  }
  for (const candidate of candidateComputed) {
    if (pairedCandidate.has(candidate.id)) continue
    changes.push({
      kind: 'add',
      namespace,
      afterID: candidate.id,
      afterName: candidate.name,
      afterSemanticHash: candidate.signatureHash,
    })
  }
  return changes
}

function outputChanges(
  current: Readonly<Record<string, string>>,
  candidate: Readonly<Record<string, string>>,
): ContractMigrationOutputChange[] {
  const paths = [...new Set([...Object.keys(current), ...Object.keys(candidate)])].sort()
  const changes: ContractMigrationOutputChange[] = []
  for (const path of paths) {
    const before = current[path]
    const after = candidate[path]
    if (before === after) continue
    changes.push({
      path,
      kind: before == null ? 'add' : after == null ? 'remove' : 'change',
      ...(before == null ? {} : { beforeHash: sha256(before) }),
      ...(after == null ? {} : { afterHash: sha256(after) }),
    })
  }
  return changes
}

function findEntry(registry: StableIDRegistry, namespace: ContractIDNamespace, id: number): StableIDEntry | undefined {
  return registry.namespaces[namespace].find((entry) => entry.id === id)
}

function registryViolations(
  current: StableIDRegistry,
  candidate: StableIDRegistry,
  candidateContract: ContractDocument,
): string[] {
  const violations: string[] = []
  if (current.schemaVersion !== candidate.schemaVersion || current.edition !== candidate.edition) {
    violations.push('Stable ID registry schemaVersion and edition cannot change during a migration')
  }

  for (const namespace of namespaces) {
    const candidateEntries = candidate.namespaces[namespace]
    const candidateSymbols = candidateContract[namespace] as MigrationSymbol[]
    const seenIDs = new Set<number>()
    const seenNames = new Set<string>()
    for (const entry of candidateEntries) {
      if (seenIDs.has(entry.id)) violations.push(`Duplicate ${namespace} ID ${entry.id} in candidate registry`)
      if (seenNames.has(entry.name)) violations.push(`Duplicate ${namespace} name ${entry.name} in candidate registry`)
      seenIDs.add(entry.id)
      seenNames.add(entry.name)
    }
    const seenContractIDs = new Set<number>()
    const seenContractNames = new Set<string>()
    for (const symbol of candidateSymbols) {
      if (seenContractIDs.has(symbol.id)) violations.push(`Duplicate ${namespace} ID ${symbol.id} in candidate contract`)
      if (seenContractNames.has(symbol.name)) violations.push(`Duplicate ${namespace} name ${symbol.name} in candidate contract`)
      seenContractIDs.add(symbol.id)
      seenContractNames.add(symbol.name)
    }

    const historicalMax = Math.max(0, ...current.namespaces[namespace].map((entry) => entry.id))
    for (const entry of current.namespaces[namespace]) {
      const next = findEntry(candidate, namespace, entry.id)
      if (next == null) {
        violations.push(`Historical ${namespace} ID ${entry.id} was deleted from the candidate registry`)
        continue
      }
      if (entry.status === 'retired' && next.status !== 'retired') {
        violations.push(`Retired ${namespace} ID ${entry.id} cannot be reactivated`)
      }
      if (entry.status === 'retired' && next.name !== entry.name) {
        violations.push(`Retired ${namespace} ID ${entry.id} cannot be reused by ${next.name}`)
      }
      if (entry.status === 'active' && next.name !== entry.name && !next.previousNames.includes(entry.name)) {
        violations.push(`Renamed ${namespace} ID ${entry.id} must retain ${entry.name} in previousNames`)
      }
    }
    for (const entry of candidateEntries) {
      if (findEntry(current, namespace, entry.id) == null && entry.id <= historicalMax) {
        violations.push(`New ${namespace} symbol ${entry.name} reuses historical ID ${entry.id}`)
      }
    }

    const contractByID = new Map(candidateSymbols.map((value) => [value.id, value]))
    for (const entry of candidateEntries) {
      const symbol = contractByID.get(entry.id)
      if (entry.status === 'active' && (symbol == null || symbol.name !== entry.name)) {
        violations.push(`Active candidate ${namespace} ID ${entry.id} does not match the candidate contract`)
      }
      if (entry.status === 'retired' && symbol != null) {
        violations.push(`Retired candidate ${namespace} ID ${entry.id} remains active in the candidate contract`)
      }
    }
    for (const symbol of contractByID.values()) {
      const entry = findEntry(candidate, namespace, symbol.id)
      if (entry == null || entry.status !== 'active' || entry.name !== symbol.name) {
        violations.push(`Candidate contract ${namespace} ${symbol.name} has no matching active registry entry`)
      }
    }
  }
  return [...new Set(violations)].sort()
}

function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJSON(item)).join(',')}]`
  if (value != null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function contractDigest(contract: ContractDocument): string {
  const canonical = structuredClone(contract)
  for (const namespace of namespaces) {
    canonical[namespace].sort((left, right) => left.id - right.id || left.name.localeCompare(right.name))
  }
  return sha256(canonicalJSON(canonical))
}

function registryDigest(registry: StableIDRegistry): string {
  const canonical = structuredClone(registry)
  for (const namespace of namespaces) {
    canonical.namespaces[namespace].sort((left, right) => left.id - right.id || left.name.localeCompare(right.name))
    for (const entry of canonical.namespaces[namespace]) entry.previousNames.sort()
  }
  return sha256(canonicalJSON(canonical))
}

type FingerprintData = Omit<ContractMigrationPreview, 'fingerprint' | 'normalizedCandidate' | 'candidateOutputs'>

function fingerprintFor(preview: FingerprintData): string {
  return sha256(JSON.stringify(preview))
}

function fingerprintData(preview: ContractMigrationPreview): FingerprintData {
  return {
    schemaVersion: preview.schemaVersion,
    changes: preview.changes,
    outputChanges: preview.outputChanges,
    invariantViolations: preview.invariantViolations,
    normalization: preview.normalization,
    digests: preview.digests,
  }
}

export function previewContractMigration(input: ContractMigrationInput): ContractMigrationPreview {
  const normalizedCurrent = withComputedSemanticHashes(input.currentContract)
  const normalizedCandidate = withComputedSemanticHashes(input.candidateContract)
  const changes: ContractMigrationChange[] = []
  for (const namespace of namespaces) {
    changes.push(...changesForNamespace(
      namespace,
      input.currentContract[namespace] as MigrationSymbol[],
      normalizedCurrent[namespace] as MigrationSymbol[],
      input.candidateContract[namespace] as MigrationSymbol[],
      normalizedCandidate[namespace] as MigrationSymbol[],
    ))
  }
  if (JSON.stringify(input.currentContract.generatedFrom) !== JSON.stringify(input.candidateContract.generatedFrom)) {
    changes.push({ kind: 'provenance-only', namespace: 'contract' })
  }
  changes.sort(compareChanges)

  const currentOutputs = input.currentOutputs ?? {}
  const candidateOutputs = input.candidateOutputs ?? {}
  const previewData = {
    schemaVersion: 1 as const,
    changes,
    outputChanges: outputChanges(currentOutputs, candidateOutputs),
    invariantViolations: registryViolations(input.currentRegistry, input.candidateRegistry, normalizedCandidate),
    normalization: {
      currentHashRepairs: hashRepairs(input.currentContract, normalizedCurrent),
      candidateHashRepairs: hashRepairs(input.candidateContract, normalizedCandidate),
    },
    digests: {
      currentContract: contractDigest(normalizedCurrent),
      candidateContract: contractDigest(normalizedCandidate),
      currentRegistry: registryDigest(input.currentRegistry),
      candidateRegistry: registryDigest(input.candidateRegistry),
    },
  }
  return {
    ...previewData,
    fingerprint: fingerprintFor(previewData),
    normalizedCandidate,
    candidateOutputs: [...new Set([...Object.keys(currentOutputs), ...Object.keys(candidateOutputs)])]
      .sort()
      .filter((path) => currentOutputs[path] !== candidateOutputs[path])
      .map((path) => ({ path, content: candidateOutputs[path] ?? null })),
  }
}

function uniqueKinds(preview: ContractMigrationPreview): ContractMigrationChangeKind[] {
  const included = new Set(preview.changes.map((change) => change.kind))
  return kindOrder.filter((kind) => included.has(kind))
}

export function createMigrationApproval(
  preview: ContractMigrationPreview,
  details: ContractMigrationApprovalDetails,
): ContractMigrationApproval {
  return {
    schemaVersion: 1,
    previewFingerprint: preview.fingerprint,
    approvedKinds: uniqueKinds(preview),
    approvedBy: details.approvedBy,
    reason: details.reason,
  }
}

export function assertApprovedMigration(
  preview: ContractMigrationPreview,
  approval: ContractMigrationApproval | undefined,
): asserts approval is ContractMigrationApproval {
  if (approval == null) throw new Error('Explicit migration approval is required before writing outputs')
  if (fingerprintFor(fingerprintData(preview)) !== preview.fingerprint) {
    throw new Error('Contract migration preview was modified after it was created')
  }
  if (contractDigest(preview.normalizedCandidate) !== preview.digests.candidateContract) {
    throw new Error('Normalized candidate was modified after the migration preview was created')
  }
  const outputByPath = new Map(preview.outputChanges.map((output) => [output.path, output]))
  if (preview.candidateOutputs.length !== preview.outputChanges.length) {
    throw new Error('Candidate outputs were modified after the migration preview was created')
  }
  for (const output of preview.candidateOutputs) {
    const expected = outputByPath.get(output.path)
    if (expected == null || (output.content == null ? expected.kind !== 'remove' : sha256(output.content) !== expected.afterHash)) {
      throw new Error(`Candidate output ${output.path} was modified after the migration preview was created`)
    }
  }
  if (preview.invariantViolations.length > 0) {
    throw new Error(`Contract migration has invariant violations:\n${preview.invariantViolations.join('\n')}`)
  }
  if (approval.schemaVersion !== 1 || approval.previewFingerprint !== preview.fingerprint) {
    throw new Error('Migration approval does not match preview fingerprint')
  }
  if (approval.approvedBy.trim() === '' || approval.reason.trim() === '') {
    throw new Error('Migration approval requires approvedBy and reason')
  }
  const expectedKinds = uniqueKinds(preview)
  const approvedKinds = [...new Set(approval.approvedKinds)].sort((left, right) => kindOrder.indexOf(left) - kindOrder.indexOf(right))
  if (JSON.stringify(approvedKinds) !== JSON.stringify(expectedKinds)) {
    throw new Error(`Migration approval kinds do not match preview: expected ${expectedKinds.join(', ')}`)
  }
}

export function applyApprovedMigration(
  preview: ContractMigrationPreview,
  approval: ContractMigrationApproval | undefined,
  writeOutput: (path: string, content: string | null) => void,
): void {
  assertApprovedMigration(preview, approval)
  for (const output of preview.candidateOutputs) writeOutput(output.path, output.content)
}
