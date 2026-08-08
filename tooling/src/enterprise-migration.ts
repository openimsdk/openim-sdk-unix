import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { importEnterpriseDelta } from './enterprise-contract.js'
import { sha256 } from './source.js'

const ENTERPRISE_IMPORT_OUTPUTS = [
  'contracts/enterprise/delta.json',
  'contracts/enterprise/id-registry.json',
  'contracts/enterprise/response-schemas.json',
  'contracts/enterprise/test-disposition.json',
  'contracts/enterprise/native-abi/harmony.json',
] as const

export interface EnterpriseMigrationOutputChange {
  path: string
  beforeHash: string
  afterHash: string
}

export interface EnterpriseMigrationPreview {
  schemaVersion: 1
  fingerprint: string
  outputChanges: EnterpriseMigrationOutputChange[]
  candidateOutputs: Array<{ path: string; content: string }>
}

export interface EnterpriseMigrationApproval {
  schemaVersion: 1
  previewFingerprint: string
  approvedBy: string
  reason: string
}

function readOutputs(root: string): Record<string, string> {
  return Object.fromEntries(ENTERPRISE_IMPORT_OUTPUTS.map((path) => [path, readFileSync(join(root, path), 'utf8')]))
}

export function previewEnterpriseImport(publicRoot: string, privateRoot: string): EnterpriseMigrationPreview {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'openim-enterprise-import-'))
  try {
    for (const path of ['contracts/enterprise', 'uni_modules/unix-openim-sdk/utssdk', 'sdk-src']) {
      cpSync(join(privateRoot, path), join(temporaryRoot, path), { recursive: true })
    }
    importEnterpriseDelta(publicRoot, temporaryRoot)
    const current = readOutputs(privateRoot)
    const candidate = readOutputs(temporaryRoot)
    const outputChanges = ENTERPRISE_IMPORT_OUTPUTS
      .filter((path) => current[path] !== candidate[path])
      .map((path) => ({ path, beforeHash: sha256(current[path]!), afterHash: sha256(candidate[path]!) }))
    const fingerprint = sha256(JSON.stringify({ schemaVersion: 1, outputChanges }))
    return {
      schemaVersion: 1,
      fingerprint,
      outputChanges,
      candidateOutputs: outputChanges.map(({ path }) => ({ path, content: candidate[path]! })),
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

export function applyEnterpriseMigration(
  privateRoot: string,
  preview: EnterpriseMigrationPreview,
  approval: EnterpriseMigrationApproval | undefined,
): void {
  if (approval == null) throw new Error('Explicit Enterprise migration approval is required')
  if (approval.schemaVersion !== 1 || approval.previewFingerprint !== preview.fingerprint) {
    throw new Error('Enterprise migration approval does not match preview fingerprint')
  }
  if (approval.approvedBy.trim() === '' || approval.reason.trim() === '') {
    throw new Error('Enterprise migration approval requires approvedBy and reason')
  }
  for (const output of preview.candidateOutputs) {
    const path = join(privateRoot, output.path)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, output.content)
  }
}

export function readEnterpriseMigrationApproval(path: string): EnterpriseMigrationApproval {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as EnterpriseMigrationApproval
}

export function assertEnterpriseExtractionCurrent(publicRoot: string, privateRoot: string): void {
  const preview = previewEnterpriseImport(publicRoot, privateRoot)
  if (preview.outputChanges.length > 0) {
    throw new Error(`Enterprise façade extraction is stale: ${preview.outputChanges.map((value) => value.path).join(', ')}`)
  }
}
