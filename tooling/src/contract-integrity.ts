import type {
  ContractCallable,
  ContractConstant,
  ContractDocument,
  ContractEvent,
  ContractType,
} from './model.js'
import { normalizeContractText, sha256 } from './source.js'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type ContractIDNamespace = 'constants' | 'types' | 'callables' | 'events'

export interface StableIDEntry {
  id: number
  name: string
  status: 'active' | 'retired'
  previousNames: string[]
  replacement?: string
}

export interface StableIDRegistry {
  schemaVersion: 1
  edition: 'public' | 'enterprise-delta'
  namespaces: Record<ContractIDNamespace, StableIDEntry[]>
}

function stableBinding(value: ContractCallable['binding']): Record<string, unknown> {
  return {
    android: value.android ?? null,
    ios: value.ios ?? null,
    harmony: value.harmony ?? null,
  }
}

function stableEventBinding(value: ContractEvent['binding']): Record<string, unknown> {
  return {
    android: value.android,
    ios: value.ios,
    harmony: value.harmony,
  }
}

export function semanticHashForConstant(value: ContractConstant): string {
  return sha256(JSON.stringify({
    name: value.name,
    type: normalizeContractText(value.type),
    value: normalizeContractText(value.value),
  }))
}

export function semanticHashForType(value: ContractType): string {
  return sha256(JSON.stringify({
    name: value.name,
    declaration: normalizeContractText(value.declaration),
  }))
}

export function semanticHashForCallable(value: ContractCallable): string {
  return sha256(JSON.stringify({
    name: value.name,
    signature: normalizeContractText(value.signature),
    completion: value.completion,
    responseCodec: value.responseCodec,
    errorPolicy: value.errorPolicy,
    rawString: value.rawString,
    role: value.role,
    declaration: {
      android: normalizeContractText(value.declaration.android),
      ios: normalizeContractText(value.declaration.ios),
      harmony: value.declaration.harmony == null ? null : normalizeContractText(value.declaration.harmony),
    },
    binding: stableBinding(value.binding),
  }))
}

export function semanticHashForEvent(value: ContractEvent): string {
  return sha256(JSON.stringify({
    name: value.name,
    callable: value.callable,
    handlerType: normalizeContractText(value.handlerType),
    rawPayload: value.rawPayload,
    dispatchArguments: {
      android: normalizeContractText(value.dispatchArguments.android),
      ios: normalizeContractText(value.dispatchArguments.ios),
      harmony: value.dispatchArguments.harmony == null ? null : normalizeContractText(value.dispatchArguments.harmony),
    },
    binding: stableEventBinding(value.binding),
    compatibilityRule: value.compatibilityRule ?? null,
  }))
}

export function withComputedSemanticHashes(contract: ContractDocument): ContractDocument {
  const result = structuredClone(contract)
  result.constants = result.constants.map((value) => ({ ...value, signatureHash: semanticHashForConstant(value) }))
  result.types = result.types.map((value) => ({ ...value, signatureHash: semanticHashForType(value) }))
  result.callables = result.callables.map((value) => ({ ...value, signatureHash: semanticHashForCallable(value) }))
  result.events = result.events.map((value) => ({ ...value, signatureHash: semanticHashForEvent(value) }))
  return result
}

export function assertContractSemanticHashes(contract: ContractDocument): void {
  const computed = withComputedSemanticHashes(contract)
  const groups: Array<[ContractIDNamespace, Array<{ name: string; signatureHash: string }>, Array<{ name: string; signatureHash: string }>]> = [
    ['constants', contract.constants, computed.constants],
    ['types', contract.types, computed.types],
    ['callables', contract.callables, computed.callables],
    ['events', contract.events, computed.events],
  ]
  const singular: Record<ContractIDNamespace, string> = {
    constants: 'constant',
    types: 'type',
    callables: 'callable',
    events: 'event',
  }
  for (const [namespace, stored, expected] of groups) {
    for (let index = 0; index < stored.length; index += 1) {
      const actual = stored[index]
      const wanted = expected[index]
      if (actual == null || wanted == null || actual.name !== wanted.name || actual.signatureHash !== wanted.signatureHash) {
        throw new Error(`Semantic hash mismatch for ${singular[namespace]} ${actual?.name ?? wanted?.name ?? index}`)
      }
    }
  }
}

export function buildStableIDRegistry(contract: ContractDocument): StableIDRegistry {
  const active = (values: Array<{ id: number; name: string }>): StableIDEntry[] => values.map(({ id, name }) => ({
    id,
    name,
    status: 'active',
    previousNames: [],
  }))
  return {
    schemaVersion: 1,
    edition: contract.edition === 'public' ? 'public' : 'enterprise-delta',
    namespaces: {
      constants: active(contract.constants),
      types: active(contract.types),
      callables: active(contract.callables),
      events: active(contract.events),
    },
  }
}

export function publicStableIDRegistryPath(root: string): string {
  return join(root, 'contracts/base/id-registry.json')
}

export function readPublicStableIDRegistry(root: string): StableIDRegistry {
  const registry = JSON.parse(readFileSync(publicStableIDRegistryPath(root), 'utf8')) as StableIDRegistry
  if (registry.schemaVersion !== 1 || registry.edition !== 'public') throw new Error('Invalid public stable ID registry')
  return registry
}

export function writePublicStableIDRegistry(root: string, registry: StableIDRegistry): void {
  writeFileSync(publicStableIDRegistryPath(root), `${JSON.stringify(registry, null, 2)}\n`)
}

export function assertStableIDRegistryMatchesContract(registry: StableIDRegistry, contract: ContractDocument): void {
  for (const namespace of ['constants', 'types', 'callables', 'events'] as const) {
    const contractByName = new Map(contract[namespace].map((value) => [value.name, value.id]))
    for (const entry of registry.namespaces[namespace]) {
      if (entry.status === 'retired') {
        if (contractByName.has(entry.name)) throw new Error(`Retired ${namespace.slice(0, -1)} ${entry.name} remains active`)
        continue
      }
      const contractID = contractByName.get(entry.name)
      if (contractID == null) throw new Error(`Active ${namespace.slice(0, -1)} ${entry.name} is missing from contract`)
      if (contractID !== entry.id) throw new Error(`Stable ID mismatch for ${namespace.slice(0, -1)} ${entry.name}`)
      for (const previousName of entry.previousNames) {
        if (contractByName.has(previousName)) throw new Error(`Historical ${namespace.slice(0, -1)} name ${previousName} remains active`)
      }
      contractByName.delete(entry.name)
    }
    if (contractByName.size > 0) {
      throw new Error(`Contract contains unregistered ${namespace}: ${[...contractByName.keys()].join(', ')}`)
    }
  }
}

function namespaceStart(registry: StableIDRegistry, namespace: ContractIDNamespace): number {
  const base = registry.edition === 'enterprise-delta' ? 100000 : 0
  if (namespace === 'constants') return base + 1
  if (namespace === 'types') return base + 1001
  if (namespace === 'callables') return base + 2001
  return base + 3001
}

export function reconcileStableIDs(
  registry: StableIDRegistry,
  namespace: ContractIDNamespace,
  names: string[],
): { entries: StableIDEntry[]; registry: StableIDRegistry } {
  if (new Set(names).size !== names.length) throw new Error(`Duplicate ${namespace} name in imported surface`)
  const current = registry.namespaces[namespace]
  const activeByName = new Map(current.filter((entry) => entry.status === 'active').map((entry) => [entry.name, entry]))
  const reservedNames = new Map<string, StableIDEntry>()
  for (const entry of current) {
    reservedNames.set(entry.name, entry)
    for (const previousName of entry.previousNames) reservedNames.set(previousName, entry)
  }

  const matched = new Set<number>()
  let nextID = Math.max(namespaceStart(registry, namespace) - 1, ...current.map((entry) => entry.id)) + 1
  const imported: StableIDEntry[] = []
  const additions: StableIDEntry[] = []
  for (const name of names) {
    const active = activeByName.get(name)
    if (active != null) {
      matched.add(active.id)
      imported.push(structuredClone(active))
      continue
    }
    const reserved = reservedNames.get(name)
    if (reserved != null) {
      throw new Error(`Reserved ${namespace} name ${name} belongs to ${reserved.status} ID ${reserved.id}`)
    }
    const added: StableIDEntry = { id: nextID, name, status: 'active', previousNames: [] }
    nextID += 1
    additions.push(added)
    imported.push(structuredClone(added))
  }

  for (const entry of current) {
    if (entry.status === 'active' && !matched.has(entry.id)) {
      throw new Error(`Unapproved removal of ${namespace.slice(0, -1)} ${entry.name}`)
    }
  }

  const updated = structuredClone(registry)
  updated.namespaces[namespace] = [...current, ...additions].sort((left, right) => left.id - right.id)
  return { entries: imported, registry: updated }
}
