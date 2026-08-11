import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EnterpriseDeltaDocument } from './model.js'
import type { StableIDEntry } from './contract-integrity.js'

export type EnterpriseIDNamespace = 'constants' | 'types' | 'typeExtensions' | 'callables' | 'events'

export interface EnterpriseStableIDRegistry {
  schemaVersion: 1
  edition: 'enterprise-delta'
  namespaces: Record<EnterpriseIDNamespace, StableIDEntry[]>
}

function active(values: Array<{ id: number; name: string }>): StableIDEntry[] {
  return values.map(({ id, name }) => ({ id, name, status: 'active', previousNames: [] }))
}

export function buildEnterpriseStableIDRegistry(delta: EnterpriseDeltaDocument): EnterpriseStableIDRegistry {
  return {
    schemaVersion: 1,
    edition: 'enterprise-delta',
    namespaces: {
      constants: active(delta.constants),
      types: active(delta.types),
      typeExtensions: active(delta.typeExtensions.map((value) => ({ id: value.id, name: value.target }))),
      callables: active(delta.callables),
      events: active(delta.events),
    },
  }
}

export function enterpriseStableIDRegistryPath(privateRoot: string): string {
  return join(privateRoot, 'contracts/enterprise/id-registry.json')
}

export function readEnterpriseStableIDRegistry(privateRoot: string): EnterpriseStableIDRegistry {
  const registry = JSON.parse(readFileSync(enterpriseStableIDRegistryPath(privateRoot), 'utf8')) as EnterpriseStableIDRegistry
  if (registry.schemaVersion !== 1 || registry.edition !== 'enterprise-delta') throw new Error('Invalid Enterprise stable ID registry')
  return registry
}

export function writeEnterpriseStableIDRegistry(privateRoot: string, registry: EnterpriseStableIDRegistry): void {
  writeFileSync(enterpriseStableIDRegistryPath(privateRoot), `${JSON.stringify(registry, null, 2)}\n`)
}

export function reconcileEnterpriseIDs(
  registry: EnterpriseStableIDRegistry,
  namespace: EnterpriseIDNamespace,
  names: string[],
): { ids: number[]; registry: EnterpriseStableIDRegistry } {
  if (new Set(names).size !== names.length) throw new Error(`Duplicate Enterprise ${namespace} name`)
  const entries = registry.namespaces[namespace]
  const activeByName = new Map(entries.filter((entry) => entry.status === 'active').map((entry) => [entry.name, entry]))
  const reservedByName = new Map<string, StableIDEntry>()
  for (const entry of entries) {
    reservedByName.set(entry.name, entry)
    for (const previousName of entry.previousNames) reservedByName.set(previousName, entry)
  }
  const matched = new Set<number>()
  let nextID = Math.max(0, ...entries.map((entry) => entry.id)) + 1
  const additions: StableIDEntry[] = []
  const ids = names.map((name) => {
    const existing = activeByName.get(name)
    if (existing != null) {
      matched.add(existing.id)
      return existing.id
    }
    const reserved = reservedByName.get(name)
    if (reserved != null) throw new Error(`Reserved Enterprise ${namespace} name ${name} belongs to ${reserved.status} ID ${reserved.id}`)
    const added: StableIDEntry = { id: nextID, name, status: 'active', previousNames: [] }
    nextID += 1
    additions.push(added)
    return added.id
  })
  for (const entry of entries) {
    if (entry.status === 'active' && !matched.has(entry.id)) throw new Error(`Unapproved removal of Enterprise ${namespace} ${entry.name}`)
  }
  const updated = structuredClone(registry)
  updated.namespaces[namespace] = [...entries, ...additions].sort((left, right) => left.id - right.id)
  return { ids, registry: updated }
}

export function assertEnterpriseStableIDs(
  registry: EnterpriseStableIDRegistry,
  delta: EnterpriseDeltaDocument,
): void {
  const actual: Record<EnterpriseIDNamespace, Array<{ id: number; name: string }>> = {
    constants: delta.constants,
    types: delta.types,
    typeExtensions: delta.typeExtensions.map((value) => ({ id: value.id, name: value.target })),
    callables: delta.callables,
    events: delta.events,
  }
  for (const namespace of Object.keys(actual) as EnterpriseIDNamespace[]) {
    const activeByID = new Map(actual[namespace].map((value) => [value.id, value.name]))
    for (const entry of registry.namespaces[namespace]) {
      if (entry.status === 'retired') {
        if (activeByID.has(entry.id)) throw new Error(`Retired Enterprise ${namespace} ID ${entry.id} remains active`)
        continue
      }
      if (activeByID.get(entry.id) !== entry.name) throw new Error(`Enterprise stable ID drift for ${namespace} ${entry.name}`)
      activeByID.delete(entry.id)
    }
    if (activeByID.size > 0) throw new Error(`Enterprise ${namespace} contains unregistered IDs`)
  }
}
