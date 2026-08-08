import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ContractDocument } from './model.js'
import { buildGeneratedOutputs, buildSurfaceSnapshot } from './generate.js'
import {
  assertContractSemanticHashes,
  assertStableIDRegistryMatchesContract,
  readPublicStableIDRegistry,
} from './contract-integrity.js'
import { verifyEventControlConsumerSurface, verifyNoLegacyEventControl } from './public-surface-policy.js'
import { assertGeneratedManifestCurrent, verifyDeletionRegeneration } from './generated-manifest.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function unique<T>(values: T[], label: string): void {
  assert(new Set(values).size === values.length, `Duplicate ${label}`)
}

export function readAndValidateContract(root: string): ContractDocument {
  const path = join(root, 'contracts/base/contract.json')
  const contract = JSON.parse(readFileSync(path, 'utf8')) as ContractDocument
  assert(contract.schemaVersion === 2, 'Unsupported contract schema')
  assert(contract.origin.kind === 'imported-facade', 'Contract origin kind changed')
  assert(contract.edition === 'public', 'Main must contain the public base contract')
  assert(contract.constants.length === contract.expected.constants, 'Constant count changed')
  assert(contract.types.length === contract.expected.types, 'Type count changed')
  assert(contract.callables.length === contract.expected.callables, 'Callable count changed')
  assert(contract.events.length === contract.expected.events, 'Event count changed')
  assertContractSemanticHashes(contract)
  unique(contract.constants.map((value) => value.id), 'constant IDs')
  unique(contract.constants.map((value) => value.name), 'constant names')
  unique(contract.types.map((value) => value.id), 'type IDs')
  unique(contract.types.map((value) => value.name), 'type names')
  unique(contract.callables.map((value) => value.id), 'callable IDs')
  unique(contract.callables.map((value) => value.name), 'callable names')
  unique(contract.events.map((value) => value.id), 'event IDs')
  unique(contract.events.map((value) => value.name), 'event names')
  for (const event of contract.events) {
    assert(contract.callables.some((callable) => callable.name === event.callable), `Orphan event ${event.name}`)
  }
  assertStableIDRegistryMatchesContract(readPublicStableIDRegistry(root), contract)
  return contract
}

export function verifyGenerated(root: string): void {
  readAndValidateContract(root)
  const first = buildGeneratedOutputs(root)
  const second = buildGeneratedOutputs(root)
  assert(JSON.stringify(first) === JSON.stringify(second), 'Generation is not deterministic')
  for (const output of first) {
    const actual = readFileSync(output.path, 'utf8')
    assert(actual === output.content, `Generated output is stale: ${output.path}`)
  }
  verifyNoLegacyEventControl(root)
  verifyEventControlConsumerSurface(root)
  assertGeneratedManifestCurrent(root)
  verifyDeletionRegeneration(root)
}

export function verifySurfaceSnapshot(root: string): void {
  const contract = readAndValidateContract(root)
  const expected = buildSurfaceSnapshot(contract)
  const actual = JSON.parse(readFileSync(join(root, 'contracts/base/surface.snapshot.json'), 'utf8')) as unknown
  assert(JSON.stringify(actual) === JSON.stringify(expected), 'Public surface snapshot does not match Contract IR')
}
