import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, relative, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { releaseProvenanceDigest, stableJSONStringify } = require('../runtime/automation-run-provenance.cjs') as {
  releaseProvenanceDigest: (data: unknown) => string
  stableJSONStringify: (data: unknown) => string
}

export type RuntimePlatform = 'android' | 'ios' | 'harmony'
export type RuntimeDeviceKind = 'emulator' | 'simulator' | 'physical'

export type RuntimeEvidence = {
  schemaVersion: 2 | 3
  runId: string
  generatedAt: string
  platform: RuntimePlatform
  fullRun: boolean
  series: { id: string; sequence: number; total: number }
  runManifest?: {
    runId: string
    path: string
    provenance: { schemaVersion: 1; sha256: string; data: Record<string, unknown> }
  }
  repository: { revision: string; dirty: boolean }
  runtime: {
    target: string
    deviceID: string
    deviceKind: RuntimeDeviceKind | string
    osVersion: string
    architecture: string
    buildConfiguration: string
  }
  sourceReport: {
    path: string
    headline: string
    total: number
    passed: number
    failed: number
    skipped: number
    knownIssues?: number
  }
  contractEvidence: { passed: boolean; issues: unknown[]; [key: string]: unknown }
  responseStructureEvidence: { passed: boolean; detail: string }
  redactedReport: unknown
}

export type RuntimeEvidenceOptions = {
  expectedPlatform: RuntimePlatform
  expectedRevision?: string
  release?: boolean
  minimumRuns?: number
  requireArm64PhysicalRelease?: boolean
}

const SHA = /^[0-9a-f]{40}$/i
const SHA256 = /^[0-9a-f]{64}$/i
const ARM64 = /^(?:arm64|arm64-v8a|aarch64)$/i
const deviceKinds = new Set<RuntimeDeviceKind>(['emulator', 'simulator', 'physical'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value))
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value !== 'unknown'
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function safeRepositoryRelativePath(value: unknown): value is string {
  if (!nonempty(value) || isAbsolute(value) || /^(?:[A-Za-z]:[\\/]|[\\/])/.test(value)) return false
  return value.replaceAll('\\', '/').split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function evidenceLabel(index: number, evidence: unknown): string {
  if (isRecord(evidence) && nonempty(evidence.runId)) return `evidence ${index + 1} (${evidence.runId})`
  return `evidence ${index + 1}`
}

function immutableManifestPath(value: unknown, platform: unknown, runId: unknown): boolean {
  if (!safeRepositoryRelativePath(value) || typeof platform !== 'string' || typeof runId !== 'string') return false
  const safeRunId = runId.replace(/[^A-Za-z0-9._-]/g, '-')
  return value.replaceAll('\\', '/') === `test-results/openim-automation/${platform}-${safeRunId}-manifest.json`
}

function releaseProvenanceFindings(label: string, data: Record<string, unknown>, value: Record<string, unknown>): string[] {
  const findings: string[] = []
  const platform = value.platform
  const sdk = isRecord(data.sdk) ? data.sdk : null
  const core = isRecord(data.core) ? data.core : null
  const artifact = isRecord(data.artifact) ? data.artifact : null
  const toolchain = isRecord(data.toolchain) ? data.toolchain : null
  const provenanceRuntime = isRecord(data.runtime) ? data.runtime : null
  const provenanceSeries = isRecord(data.series) ? data.series : null
  if (sdk == null || typeof sdk.revision !== 'string' || !SHA.test(sdk.revision) || sdk.dirty !== false) findings.push(`${label}: provenance SDK identity is not a clean full Git revision`)
  if (core == null || typeof core.revision !== 'string' || !SHA.test(core.revision) || core.dirty !== false) findings.push(`${label}: provenance Core identity is not a clean full Git revision`)
  if (toolchain == null || !nonempty(toolchain.hbuilderxVersion) || typeof toolchain.hbuilderxCliSha256 !== 'string' || !SHA256.test(toolchain.hbuilderxCliSha256)) findings.push(`${label}: provenance toolchain identity is incomplete`)
  if (data.edition === 'private' && (toolchain == null || typeof toolchain.automationPeerAuthoritySha256 !== 'string' || !SHA256.test(toolchain.automationPeerAuthoritySha256))) findings.push(`${label}: private provenance automation peer identity is incomplete`)
  if (!isRecord(value.runtime) || provenanceRuntime == null || stableJSONStringify(provenanceRuntime) !== stableJSONStringify(value.runtime)) findings.push(`${label}: provenance runtime identity does not match evidence`)
  if (!isRecord(value.series) || provenanceSeries == null || stableJSONStringify(provenanceSeries) !== stableJSONStringify(value.series)) findings.push(`${label}: provenance series identity does not match evidence`)
  if (typeof data.vapor !== 'boolean') findings.push(`${label}: provenance Vapor mode is missing`)
  if (platform === 'harmony') {
    if (data.vapor !== false) findings.push(`${label}: Harmony release provenance must not claim Vapor`)
    if (toolchain == null || !nonempty(toolchain.devEcoVersion)) findings.push(`${label}: Harmony provenance DevEco identity is missing`)
    if (artifact == null
      || artifact.kind !== 'harmony-har-hap'
      || typeof artifact.harSha256 !== 'string' || !SHA256.test(artifact.harSha256)
      || artifact.harSha256 !== artifact.lockedHarSha256
      || typeof artifact.nativeABIContractSha256 !== 'string' || !SHA256.test(artifact.nativeABIContractSha256)
      || typeof artifact.hapSha256 !== 'string' || !SHA256.test(artifact.hapSha256)
      || artifact.hapFreshForRun !== true) findings.push(`${label}: Harmony provenance does not bind the locked HAR and fresh HAP`)
  } else {
    const expectedNativeKind = platform === 'ios' ? 'xcframework-inventory' : 'aar'
    if (artifact == null
      || artifact.kind !== 'custom-base'
      || typeof artifact.sha256 !== 'string' || !SHA256.test(artifact.sha256)
      || artifact.nativeArtifactKind !== expectedNativeKind
      || typeof artifact.nativeArtifactSha256 !== 'string' || !SHA256.test(artifact.nativeArtifactSha256)) findings.push(`${label}: mobile provenance does not bind the custom base and native Core artifact`)
  }
  return findings
}

export function runtimeEvidenceFindings(records: unknown[], options: RuntimeEvidenceOptions): string[] {
  const findings: string[] = []
  const minimumRuns = options.minimumRuns ?? 1
  if (!positiveInteger(minimumRuns)) findings.push('minimumRuns must be a positive integer')
  if (records.length < minimumRuns) findings.push(`expected at least ${minimumRuns} runtime runs, received ${records.length}`)

  for (const [index, value] of records.entries()) {
    const label = evidenceLabel(index, value)
    if (!isRecord(value)) {
      findings.push(`${label}: evidence is not an object`)
      continue
    }
    if (value.schemaVersion !== 2 && value.schemaVersion !== 3) findings.push(`${label}: expected schemaVersion 2 or 3`)
    if (options.release === true && value.schemaVersion !== 3) findings.push(`${label}: release requires schemaVersion 3 with bound run-manifest provenance`)
    if (!nonempty(value.runId)) findings.push(`${label}: runId is missing`)
    if (!validDate(value.generatedAt)) findings.push(`${label}: generatedAt is invalid`)
    if (value.platform !== options.expectedPlatform) findings.push(`${label}: expected platform ${options.expectedPlatform}, received ${String(value.platform)}`)
    if (value.fullRun !== true) findings.push(`${label}: fullRun must be true`)

    if (value.schemaVersion === 3) {
      if (!isRecord(value.runManifest) || !isRecord(value.runManifest.provenance)) {
        findings.push(`${label}: runManifest provenance is missing`)
      } else {
        if (value.runManifest.runId !== value.runId) findings.push(`${label}: runManifest runId does not match evidence`)
        if (!immutableManifestPath(value.runManifest.path, value.platform, value.runId)) findings.push(`${label}: referenced run manifest path is not an immutable platform artifact`)
        const provenance = value.runManifest.provenance
        if (provenance.schemaVersion !== 1 || typeof provenance.sha256 !== 'string' || !SHA256.test(provenance.sha256) || !isRecord(provenance.data)) {
          findings.push(`${label}: runManifest provenance envelope is invalid`)
        } else if (releaseProvenanceDigest(provenance.data) !== provenance.sha256) {
          findings.push(`${label}: runManifest provenance digest does not match its data`)
        } else {
          if (provenance.data.runId !== value.runId || provenance.data.platform !== value.platform) findings.push(`${label}: provenance identity does not match evidence`)
          if (options.release === true) findings.push(...releaseProvenanceFindings(label, provenance.data, value))
          const sdk = isRecord(provenance.data.sdk) ? provenance.data.sdk : null
          const repositoryRevision = isRecord(value.repository) ? value.repository.revision : null
          if (options.release === true && (sdk == null || sdk.revision !== repositoryRevision)) findings.push(`${label}: provenance SDK revision does not match evidence repository`)
        }
      }
    }

    if (!isRecord(value.series)) findings.push(`${label}: series metadata is missing`)
    else {
      if (!nonempty(value.series.id)) findings.push(`${label}: series.id is missing`)
      if (!positiveInteger(value.series.sequence)) findings.push(`${label}: series.sequence is invalid`)
      if (!positiveInteger(value.series.total)) findings.push(`${label}: series.total is invalid`)
    }

    if (!isRecord(value.repository)) findings.push(`${label}: repository metadata is missing`)
    else {
      if (!nonempty(value.repository.revision) || !SHA.test(value.repository.revision)) findings.push(`${label}: repository revision is not a full Git SHA`)
      if (options.expectedRevision != null && value.repository.revision !== options.expectedRevision) findings.push(`${label}: repository revision does not match ${options.expectedRevision}`)
      if (options.release === true && value.repository.dirty !== false) findings.push(`${label}: repository is dirty`)
    }

    if (!isRecord(value.runtime)) findings.push(`${label}: runtime metadata is missing`)
    else {
      for (const field of ['target', 'deviceID', 'osVersion', 'architecture', 'buildConfiguration'] as const) if (!nonempty(value.runtime[field])) findings.push(`${label}: runtime.${field} is missing`)
      if (!nonempty(value.runtime.deviceKind) || !deviceKinds.has(value.runtime.deviceKind as RuntimeDeviceKind)) findings.push(`${label}: runtime.deviceKind is invalid`)
      const target = value.runtime.target
      const targetMatches = options.expectedPlatform === 'android' ? target === 'app-android' : options.expectedPlatform === 'ios' ? typeof target === 'string' && target.startsWith('app-ios') : target === 'app-harmony'
      if (!targetMatches) findings.push(`${label}: runtime.target does not match ${options.expectedPlatform}`)
      if (value.runtime.buildConfiguration !== 'Debug' && value.runtime.buildConfiguration !== 'Release') findings.push(`${label}: runtime.buildConfiguration must be Debug or Release`)
    }

    if (!isRecord(value.sourceReport)) findings.push(`${label}: sourceReport is missing`)
    else {
      if (!safeRepositoryRelativePath(value.sourceReport.path)) findings.push(`${label}: sourceReport.path must be repository-relative`)
      const total = value.sourceReport.total
      const passed = value.sourceReport.passed
      const failed = value.sourceReport.failed
      const skipped = value.sourceReport.skipped
      const knownIssues = value.schemaVersion === 2 && value.sourceReport.knownIssues == null ? 0 : value.sourceReport.knownIssues
      if (typeof total !== 'number' || !Number.isInteger(total) || total <= 0) findings.push(`${label}: sourceReport.total is invalid`)
      if (typeof passed !== 'number' || !Number.isInteger(passed) || passed < 0) findings.push(`${label}: sourceReport.passed is invalid`)
      if (typeof failed !== 'number' || !Number.isInteger(failed) || failed < 0) findings.push(`${label}: sourceReport.failed is invalid`)
      else if (failed !== 0) findings.push(`${label}: source report failed ${String(failed)}`)
      if (typeof skipped !== 'number' || !Number.isInteger(skipped) || skipped < 0) findings.push(`${label}: sourceReport.skipped is invalid`)
      else if (skipped !== 0) findings.push(`${label}: source report skipped ${String(skipped)}`)
      if (typeof knownIssues !== 'number' || !Number.isInteger(knownIssues) || knownIssues < 0) findings.push(`${label}: sourceReport.knownIssues is invalid`)
      else if (options.release === true && knownIssues !== 0) findings.push(`${label}: source report contains ${knownIssues} approved known issues`)
      if ([total, passed, failed, skipped, knownIssues].every((item) => typeof item === 'number' && Number.isInteger(item) && item >= 0)
        && total !== (passed as number) + (failed as number) + (skipped as number) + (knownIssues as number)) findings.push(`${label}: source report counts do not add up to ${String(total)}`)
    }

    if (!isRecord(value.contractEvidence) || value.contractEvidence.passed !== true) findings.push(`${label}: contract evidence did not pass`)
    else if (!Array.isArray(value.contractEvidence.issues) || value.contractEvidence.issues.length !== 0) findings.push(`${label}: contract evidence contains issues`)
    else if (options.release === true) {
      if (value.contractEvidence.strictPassed !== true) findings.push(`${label}: contract evidence is not a strict pass`)
      if (Array.isArray(value.contractEvidence.knownIssueWaivers) && value.contractEvidence.knownIssueWaivers.length > 0) findings.push(`${label}: contract evidence contains approved known-issue waivers`)
    }
    if (!isRecord(value.responseStructureEvidence) || value.responseStructureEvidence.passed !== true) findings.push(`${label}: response structure evidence did not pass`)
  }

  const runIds = records.flatMap((value) => isRecord(value) && nonempty(value.runId) ? [value.runId] : [])
  if (new Set(runIds).size !== runIds.length) findings.push('runtime evidence contains a duplicate runId')
  if (records.length > 1) {
    const series = records.flatMap((value) => isRecord(value) && isRecord(value.series) ? [value.series] : [])
    const ids = series.flatMap((value) => nonempty(value.id) ? [value.id] : [])
    if (series.length !== records.length || new Set(ids).size !== 1) findings.push('runtime evidence must belong to one series')
    const sequences = series.flatMap((value) => positiveInteger(value.sequence) ? [value.sequence] : []).sort((left, right) => left - right)
    const expectedSequences = Array.from({ length: records.length }, (_, index) => index + 1)
    if (sequences.length !== records.length || sequences.some((value, index) => value !== expectedSequences[index])) findings.push('runtime evidence series must have contiguous sequence numbers starting at 1')
    if (series.some((value) => value.total !== records.length)) findings.push(`runtime evidence series total must equal ${records.length}`)
    const ordered = records.flatMap((value) => !isRecord(value) || !isRecord(value.series) || !positiveInteger(value.series.sequence) || !validDate(value.generatedAt) ? [] : [{ sequence: value.series.sequence, generatedAt: Date.parse(value.generatedAt) }]).sort((left, right) => left.sequence - right.sequence)
    if (ordered.length === records.length && ordered.some((value, index) => index > 0 && value.generatedAt <= ordered[index - 1]!.generatedAt)) findings.push('runtime evidence series timestamps must increase with sequence')
  }
  if (options.requireArm64PhysicalRelease === true) {
    const hasPhysicalRelease = records.some((value) => isRecord(value) && isRecord(value.runtime) && value.runtime.deviceKind === 'physical' && typeof value.runtime.architecture === 'string' && ARM64.test(value.runtime.architecture) && value.runtime.buildConfiguration === 'Release')
    if (!hasPhysicalRelease) findings.push('runtime evidence lacks an arm64 physical-device Release pass')
  }
  return findings
}

function repositoryState(root: string): { revision: string; dirty: boolean } {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== ''
  return { revision, dirty }
}

function referencedRunManifestFindings(root: string, value: unknown, index: number, release: boolean): string[] {
  if (!isRecord(value) || value.schemaVersion !== 3 || !isRecord(value.runManifest)) return []
  const label = evidenceLabel(index, value)
  if (!immutableManifestPath(value.runManifest.path, value.platform, value.runId)) return [`${label}: referenced run manifest path is not an immutable platform artifact`]
  let manifest: unknown
  try {
    const realRoot = realpathSync(resolve(root))
    const realManifest = realpathSync(resolve(root, value.runManifest.path as string))
    if (!safeRepositoryRelativePath(relative(realRoot, realManifest))) return [`${label}: referenced run manifest path escapes the repository`]
    manifest = JSON.parse(readFileSync(realManifest, 'utf8')) as unknown
  } catch {
    return [`${label}: referenced run manifest is missing or invalid`]
  }
  if (!isRecord(manifest)) return [`${label}: referenced run manifest is not an object`]
  const findings: string[] = []
  if (manifest.runId !== value.runId || manifest.platform !== value.platform) findings.push(`${label}: referenced run manifest identity does not match evidence`)
  if (!isRecord(value.runManifest.provenance) || !isRecord(manifest.releaseProvenance) || stableJSONStringify(manifest.releaseProvenance) !== stableJSONStringify(value.runManifest.provenance)) findings.push(`${label}: referenced run manifest provenance does not match evidence`)
  if (release) {
    if (!isRecord(manifest.result) || manifest.result.status !== 'passed') findings.push(`${label}: referenced run manifest did not pass`)
    if (!isRecord(manifest.result) || manifest.result.finalizationComplete !== true) findings.push(`${label}: referenced run manifest finalization is incomplete`)
    const report = isRecord(manifest.result) && isRecord(manifest.result.report) ? manifest.result.report : null
    const sourceReport = isRecord(value.sourceReport) ? value.sourceReport : null
    if (['path', 'headline', 'total', 'passed', 'failed', 'skipped', 'knownIssues'].some((field) => report == null || sourceReport == null || report[field] !== sourceReport[field])) findings.push(`${label}: referenced run manifest report summary does not match evidence`)
    const summary = isRecord(manifest.result) && isRecord(manifest.result.evidence) ? manifest.result.evidence : null
    const contract = isRecord(value.contractEvidence) ? value.contractEvidence : null
    const response = isRecord(value.responseStructureEvidence) ? value.responseStructureEvidence : null
    const waiverCount = contract != null && Array.isArray(contract.knownIssueWaivers) ? contract.knownIssueWaivers.length : 0
    const issueCount = contract != null && Array.isArray(contract.issues) ? contract.issues.length : 0
    if (summary == null || contract == null || response == null || summary.runId !== value.runId || summary.passed !== contract.passed || summary.strictPassed !== contract.strictPassed || summary.responseStructurePassed !== response.passed || summary.knownIssueWaiverCount !== waiverCount || summary.issueCount !== issueCount) findings.push(`${label}: referenced run manifest evidence summary does not match evidence`)
  }
  return findings
}

function currentRuntimeAuthorityFindings(root: string, value: unknown, index: number): string[] {
  if (!isRecord(value) || value.schemaVersion !== 3 || !isRecord(value.runManifest) || !isRecord(value.runManifest.provenance) || !isRecord(value.runManifest.provenance.data)) return []
  const label = evidenceLabel(index, value)
  const data = value.runManifest.provenance.data
  const core = isRecord(data.core) ? data.core : null
  const artifact = isRecord(data.artifact) ? data.artifact : null
  const toolchain = isRecord(data.toolchain) ? data.toolchain : null
  const findings: string[] = []
  let lock: Record<string, unknown> | null = null
  try {
    const parsed = JSON.parse(readFileSync(resolve(root, 'toolchain.lock.json'), 'utf8')) as unknown
    lock = isRecord(parsed) ? parsed : null
    const hbuilderx = lock != null && isRecord(lock.hbuilderx) ? lock.hbuilderx : null
    if (hbuilderx == null || toolchain == null || toolchain.hbuilderxVersion !== hbuilderx.version || toolchain.hbuilderxCliSha256 !== hbuilderx.cliSha256) findings.push(`${label}: provenance HBuilderX identity does not match the current toolchain lock`)
  } catch {
    findings.push(`${label}: current HBuilderX toolchain authority is missing or invalid`)
  }
  if (value.platform === 'harmony') {
    try {
      const provenance = JSON.parse(readFileSync(resolve(root, 'contracts/enterprise/native-abi/harmony-artifact-provenance.json'), 'utf8')) as unknown
      const inventoryPath = resolve(root, 'contracts/enterprise/native-abi/harmony.json')
      const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as unknown
      if (!isRecord(provenance) || core == null || core.revision !== provenance.coreRevision) findings.push(`${label}: provenance Core revision does not match the locked Licensed Core`)
      if (!isRecord(inventory) || artifact == null || artifact.harSha256 !== inventory.artifactSha256 || artifact.lockedHarSha256 !== inventory.artifactSha256 || artifact.nativeABIContractSha256 !== sha256File(inventoryPath)) findings.push(`${label}: provenance Harmony artifacts do not match the current HAR authority`)
    } catch {
      findings.push(`${label}: current Harmony Core/HAR authority is missing or invalid`)
    }
  } else {
    const enterpriseInventoryPath = resolve(root, 'contracts/enterprise/native-abi/apple-android.json')
    if (existsSync(enterpriseInventoryPath)) {
      try {
        const inventory = JSON.parse(readFileSync(enterpriseInventoryPath, 'utf8')) as unknown
        const source = isRecord(inventory) && isRecord(inventory.source) ? inventory.source : null
        if (source == null || core == null || core.revision !== source.revision) findings.push(`${label}: provenance Core revision does not match the locked Enterprise Core`)
      } catch {
        findings.push(`${label}: current Enterprise Core authority is missing or invalid`)
      }
    } else {
      const publicNative = lock != null && isRecord(lock.publicNative) ? lock.publicNative : null
      const source = publicNative != null && isRecord(publicNative.source) ? publicNative.source : null
      const platformLock = publicNative != null && isRecord(publicNative[value.platform as string]) ? publicNative[value.platform as string] as Record<string, unknown> : null
      const expectedNativeSha = value.platform === 'ios' ? platformLock?.localOverrideInventorySha256 : platformLock?.sha256
      if (source == null || core == null || core.revision !== source.revision) findings.push(`${label}: provenance Core revision does not match the locked Public Core`)
      if (artifact == null || artifact.nativeArtifactSha256 !== expectedNativeSha) findings.push(`${label}: provenance native artifact does not match the current Public Core lock`)
    }
  }
  return findings
}

export function verifyRuntimeEvidenceSet(root: string, evidencePaths: string[], options: Omit<RuntimeEvidenceOptions, 'expectedRevision'>): { platform: RuntimePlatform; runIds: string[]; findings: string[] } {
  const repository = repositoryState(root)
  const records = evidencePaths.map((path) => JSON.parse(readFileSync(path, 'utf8')) as unknown)
  const findings = runtimeEvidenceFindings(records, { ...options, ...(options.release === true ? { expectedRevision: repository.revision } : {}) })
  for (const [index, record] of records.entries()) {
    findings.push(...referencedRunManifestFindings(root, record, index, options.release === true))
    if (options.release === true) findings.push(...currentRuntimeAuthorityFindings(root, record, index))
  }
  if (options.release === true && repository.dirty) findings.push('current release checkout is dirty')
  const runIds = records.flatMap((value) => isRecord(value) && nonempty(value.runId) ? [value.runId] : [])
  if (findings.length > 0) throw new Error(`Runtime evidence violations:\n${findings.join('\n')}`)
  return { platform: options.expectedPlatform, runIds, findings }
}
