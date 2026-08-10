import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export type RuntimePlatform = 'android' | 'ios' | 'harmony'
export type RuntimeDeviceKind = 'emulator' | 'simulator' | 'physical'

export type RuntimeEvidence = {
  schemaVersion: 2
  runId: string
  generatedAt: string
  platform: RuntimePlatform
  fullRun: boolean
  series: { id: string; sequence: number; total: number }
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

function evidenceLabel(index: number, evidence: unknown): string {
  if (isRecord(evidence) && nonempty(evidence.runId)) return `evidence ${index + 1} (${evidence.runId})`
  return `evidence ${index + 1}`
}

export function runtimeEvidenceFindings(
  records: unknown[],
  options: RuntimeEvidenceOptions,
): string[] {
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
    if (value.schemaVersion !== 2) findings.push(`${label}: expected schemaVersion 2`)
    if (!nonempty(value.runId)) findings.push(`${label}: runId is missing`)
    if (!validDate(value.generatedAt)) findings.push(`${label}: generatedAt is invalid`)
    if (value.platform !== options.expectedPlatform) {
      findings.push(`${label}: expected platform ${options.expectedPlatform}, received ${String(value.platform)}`)
    }
    if (value.fullRun !== true) findings.push(`${label}: fullRun must be true`)

    if (!isRecord(value.series)) {
      findings.push(`${label}: series metadata is missing`)
    } else {
      if (!nonempty(value.series.id)) findings.push(`${label}: series.id is missing`)
      if (!positiveInteger(value.series.sequence)) findings.push(`${label}: series.sequence is invalid`)
      if (!positiveInteger(value.series.total)) findings.push(`${label}: series.total is invalid`)
    }

    if (!isRecord(value.repository)) {
      findings.push(`${label}: repository metadata is missing`)
    } else {
      if (!nonempty(value.repository.revision) || !SHA.test(value.repository.revision)) {
        findings.push(`${label}: repository revision is not a full Git SHA`)
      }
      if (options.expectedRevision != null && value.repository.revision !== options.expectedRevision) {
        findings.push(`${label}: repository revision does not match ${options.expectedRevision}`)
      }
      if (options.release === true && value.repository.dirty !== false) findings.push(`${label}: repository is dirty`)
    }

    if (!isRecord(value.runtime)) {
      findings.push(`${label}: runtime metadata is missing`)
    } else {
      for (const field of ['target', 'deviceID', 'osVersion', 'architecture', 'buildConfiguration'] as const) {
        if (!nonempty(value.runtime[field])) findings.push(`${label}: runtime.${field} is missing`)
      }
      if (!nonempty(value.runtime.deviceKind) || !deviceKinds.has(value.runtime.deviceKind as RuntimeDeviceKind)) {
        findings.push(`${label}: runtime.deviceKind is invalid`)
      }
      const target = value.runtime.target
      const targetMatches = options.expectedPlatform === 'android'
        ? target === 'app-android'
        : options.expectedPlatform === 'ios'
          ? typeof target === 'string' && target.startsWith('app-ios')
          : target === 'app-harmony'
      if (!targetMatches) findings.push(`${label}: runtime.target does not match ${options.expectedPlatform}`)
      if (value.runtime.buildConfiguration !== 'Debug' && value.runtime.buildConfiguration !== 'Release') {
        findings.push(`${label}: runtime.buildConfiguration must be Debug or Release`)
      }
    }

    if (!isRecord(value.sourceReport)) {
      findings.push(`${label}: sourceReport is missing`)
    } else {
      const total = value.sourceReport.total
      const passed = value.sourceReport.passed
      const failed = value.sourceReport.failed
      const skipped = value.sourceReport.skipped
      if (typeof total !== 'number' || !Number.isInteger(total) || total <= 0) findings.push(`${label}: sourceReport.total is invalid`)
      if (typeof passed !== 'number' || !Number.isInteger(passed) || passed < 0) findings.push(`${label}: sourceReport.passed is invalid`)
      if (failed !== 0) findings.push(`${label}: source report failed ${String(failed)}`)
      if (skipped !== 0) findings.push(`${label}: source report skipped ${String(skipped)}`)
      if (typeof total === 'number' && typeof passed === 'number' && total !== passed) {
        findings.push(`${label}: source report passed ${passed} of ${total}`)
      }
    }

    if (!isRecord(value.contractEvidence) || value.contractEvidence.passed !== true) {
      findings.push(`${label}: contract evidence did not pass`)
    } else if (!Array.isArray(value.contractEvidence.issues) || value.contractEvidence.issues.length !== 0) {
      findings.push(`${label}: contract evidence contains issues`)
    } else if (options.release === true) {
      if (value.contractEvidence.strictPassed !== true) {
        findings.push(`${label}: contract evidence is not a strict pass`)
      }
      if (Array.isArray(value.contractEvidence.knownIssueWaivers)
        && value.contractEvidence.knownIssueWaivers.length > 0) {
        findings.push(`${label}: contract evidence contains approved known-issue waivers`)
      }
    }
    if (!isRecord(value.responseStructureEvidence) || value.responseStructureEvidence.passed !== true) {
      findings.push(`${label}: response structure evidence did not pass`)
    }
  }

  const runIds = records.flatMap((value) => isRecord(value) && nonempty(value.runId) ? [value.runId] : [])
  if (new Set(runIds).size !== runIds.length) findings.push('runtime evidence contains a duplicate runId')

  if (records.length > 1) {
    const series = records.flatMap((value) => isRecord(value) && isRecord(value.series) ? [value.series] : [])
    const ids = series.flatMap((value) => nonempty(value.id) ? [value.id] : [])
    if (series.length !== records.length || new Set(ids).size !== 1) findings.push('runtime evidence must belong to one series')
    const sequences = series.flatMap((value) => positiveInteger(value.sequence) ? [value.sequence] : []).sort((left, right) => left - right)
    const expectedSequences = Array.from({ length: records.length }, (_, index) => index + 1)
    if (sequences.length !== records.length || sequences.some((value, index) => value !== expectedSequences[index])) {
      findings.push('runtime evidence series must have contiguous sequence numbers starting at 1')
    }
    if (series.some((value) => value.total !== records.length)) {
      findings.push(`runtime evidence series total must equal ${records.length}`)
    }
    const ordered = records.flatMap((value) => {
      if (!isRecord(value) || !isRecord(value.series) || !positiveInteger(value.series.sequence) || !validDate(value.generatedAt)) return []
      return [{ sequence: value.series.sequence, generatedAt: Date.parse(value.generatedAt) }]
    }).sort((left, right) => left.sequence - right.sequence)
    if (ordered.length === records.length && ordered.some((value, index) => index > 0 && value.generatedAt <= ordered[index - 1]!.generatedAt)) {
      findings.push('runtime evidence series timestamps must increase with sequence')
    }
  }

  if (options.requireArm64PhysicalRelease === true) {
    const hasPhysicalRelease = records.some((value) => {
      if (!isRecord(value) || !isRecord(value.runtime)) return false
      return value.runtime.deviceKind === 'physical'
        && typeof value.runtime.architecture === 'string'
        && ARM64.test(value.runtime.architecture)
        && value.runtime.buildConfiguration === 'Release'
    })
    if (!hasPhysicalRelease) findings.push('runtime evidence lacks an arm64 physical-device Release pass')
  }
  return findings
}

function repositoryState(root: string): { revision: string; dirty: boolean } {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== ''
  return { revision, dirty }
}

export function verifyRuntimeEvidenceSet(
  root: string,
  evidencePaths: string[],
  options: Omit<RuntimeEvidenceOptions, 'expectedRevision'>,
): { platform: RuntimePlatform; runIds: string[]; findings: string[] } {
  const repository = repositoryState(root)
  const records = evidencePaths.map((path) => JSON.parse(readFileSync(path, 'utf8')) as unknown)
  const findings = runtimeEvidenceFindings(records, {
    ...options,
    ...(options.release === true ? { expectedRevision: repository.revision } : {}),
  })
  if (options.release === true && repository.dirty) findings.push('current release checkout is dirty')
  const runIds = records.flatMap((value) => isRecord(value) && nonempty(value.runId) ? [value.runId] : [])
  if (findings.length > 0) throw new Error(`Runtime evidence violations:\n${findings.join('\n')}`)
  return { platform: options.expectedPlatform, runIds, findings }
}
