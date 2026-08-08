import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import type { ContractDocument } from './model.js'
import type { StableIDRegistry } from './contract-integrity.js'
import { importPublicContract } from './import-contract.js'
import { buildGeneratedOutputs, generate } from './generate.js'
import { GENERATED_MANIFEST_PATH, writeGeneratedManifest } from './generated-manifest.js'
import {
  applyApprovedMigration,
  previewContractMigration,
  type ContractMigrationApproval,
  type ContractMigrationPreview,
} from './contract-migration.js'

const IMPORT_AUTHORITY_OUTPUTS = [
  'contracts/base/contract.json',
  'contracts/base/id-registry.json',
  'sdk-src/uts/app-android/index.template.uts',
  'sdk-src/uts/app-ios/index.template.uts',
  'sdk-src/uts/app-android/events.prelude.uts',
  'sdk-src/uts/app-ios/events.prelude.uts',
] as const

function readJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function readOutputs(root: string, paths: readonly string[]): Record<string, string> {
  return Object.fromEntries(paths.map((path) => [path, readFileSync(join(root, path), 'utf8')]))
}

function candidatePaths(root: string): string[] {
  return [...new Set([
    ...IMPORT_AUTHORITY_OUTPUTS,
    ...buildGeneratedOutputs(root).map((output) => relative(root, output.path)),
    GENERATED_MANIFEST_PATH,
  ])].sort()
}

export function previewPublicContractImport(root: string): ContractMigrationPreview {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'openim-contract-import-'))
  try {
    for (const path of ['contracts/base', 'sdk-src', 'uni_modules/unix-openim-sdk/utssdk']) {
      cpSync(join(root, path), join(temporaryRoot, path), { recursive: true })
    }

    const currentContract = readJSON<ContractDocument>(join(root, 'contracts/base/contract.json'))
    const currentRegistry = readJSON<StableIDRegistry>(join(root, 'contracts/base/id-registry.json'))
    importPublicContract(temporaryRoot)
    generate(temporaryRoot)
    writeGeneratedManifest(temporaryRoot)
    const candidateContract = readJSON<ContractDocument>(join(temporaryRoot, 'contracts/base/contract.json'))
    const candidateRegistry = readJSON<StableIDRegistry>(join(temporaryRoot, 'contracts/base/id-registry.json'))
    const paths = candidatePaths(temporaryRoot)
    return previewContractMigration({
      currentContract,
      currentRegistry,
      candidateContract,
      candidateRegistry,
      currentOutputs: readOutputs(root, paths),
      candidateOutputs: readOutputs(temporaryRoot, paths),
    })
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

export function applyPublicContractImport(
  root: string,
  preview: ContractMigrationPreview,
  approval: ContractMigrationApproval | undefined,
): void {
  applyApprovedMigration(preview, approval, (path, content) => {
    const target = join(root, path)
    if (content == null) {
      unlinkSync(target)
      return
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  })
}

export function readMigrationApproval(path: string): ContractMigrationApproval {
  return readJSON<ContractMigrationApproval>(path)
}

export function migrationPreviewSummary(preview: ContractMigrationPreview): Record<string, unknown> {
  return {
    schemaVersion: preview.schemaVersion,
    fingerprint: preview.fingerprint,
    changes: preview.changes,
    outputChanges: preview.outputChanges,
    invariantViolations: preview.invariantViolations,
    normalization: preview.normalization,
    writeApproved: false,
  }
}
