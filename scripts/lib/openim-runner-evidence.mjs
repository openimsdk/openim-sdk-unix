import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, relative, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { formatAutomationEvidenceIssues, validateAutomationEvidence } = require('../../tooling/runtime/automation-evidence.cjs')

const artifactFilePattern = /^openim-automation-.*\.json$/
const sensitiveKeyPattern = /(token|authorization|credential|secret|password|sign|signature|policy|session|identity|userID|sendID|recvID|clientMsgID|groupID|conversationID|ownerUserID|creatorUserID|nickname|account|faceURL|attachedInfo)/i

function stableRedaction(value) {
  const digest = createHash('sha256').update(String(value)).digest('hex').slice(0, 10)
  return `<redacted:${digest}>`
}

function redactURL(value) {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.hash = ''
    url.search = ''
    const segments = url.pathname.split('/').map((segment) => {
      if (segment.length === 0) {
        return segment
      }
      if (/^eyJ/.test(segment) || /^unixagent/i.test(segment) || /^[A-Za-z0-9_-]{24,}$/.test(segment)) {
        return stableRedaction(segment)
      }
      return segment
    })
    url.pathname = segments.join('/')
    return url.toString()
  } catch {
    return value
  }
}

function redactString(key, value) {
  if (key === 'responseDetail' || key === 'payloadDetail' || key === 'payloadDetails' || key === 'eventPayloadDetail' || key === 'lastPayload') {
    try {
      return JSON.stringify(redactAutomationValue(JSON.parse(value)))
    } catch {
      // Opaque/raw response strings still pass through the token and URL rules below.
    }
  }
  if (sensitiveKeyPattern.test(key)) {
    return stableRedaction(value)
  }
  if (/^eyJ[A-Za-z0-9_-]+\./.test(value) || /^unixagent/i.test(value)) {
    return stableRedaction(value)
  }
  if (/^https?:\/\//i.test(value)) {
    return redactURL(value)
  }
  return value
}

export function redactAutomationValue(value, key = '') {
  if (Array.isArray(value)) {
    return value.map((item) => redactAutomationValue(item, key))
  }
  if (value != null && typeof value === 'object') {
    const redacted = Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactAutomationValue(entryValue, entryKey)]))
    if ((value.eventName === 'onGroupMemberAdded' || value.eventName === 'onGroupMemberDeleted')
      && typeof value.payloadIdentity === 'string') {
      const separator = value.payloadIdentity.indexOf(':')
      if (separator > 0 && separator < value.payloadIdentity.length - 1) {
        redacted.payloadIdentity = `${stableRedaction(value.payloadIdentity.slice(0, separator))}:${stableRedaction(value.payloadIdentity.slice(separator + 1))}`
      }
    }
    return redacted
  }
  if (typeof value === 'string') {
    return redactString(key, value)
  }
  return value
}

export function artifactDirectory(projectRoot) {
  return resolve(projectRoot, 'test-results/openim-automation')
}

function contractEditionDirectory(projectRoot) {
  const enterprise = resolve(projectRoot, 'contracts/enterprise')
  return existsSync(resolve(enterprise, 'test-disposition.json'))
    ? enterprise
    : resolve(projectRoot, 'contracts/base')
}

function testDispositionPath(projectRoot) {
  return resolve(contractEditionDirectory(projectRoot), 'test-disposition.json')
}

function responseSchemasPath(projectRoot) {
  return resolve(contractEditionDirectory(projectRoot), 'response-schemas.json')
}

export function findLatestAutomationReport(projectRoot, startedAtMs = 0) {
  const directory = artifactDirectory(projectRoot)
  if (!existsSync(directory)) {
    return null
  }
  const candidates = readdirSync(directory)
    .filter((name) => artifactFilePattern.test(name))
    .map((name) => {
      const path = resolve(directory, name)
      const stat = statSync(path)
      return { path, stat, name }
    })
    .filter((entry) => entry.stat.isFile() && entry.stat.mtimeMs >= startedAtMs)
    .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)
  return candidates[0] ?? null
}

function readDispositionManifest(projectRoot) {
  return JSON.parse(readFileSync(testDispositionPath(projectRoot), 'utf8'))
}

function readResponseSchemas(projectRoot) {
  return JSON.parse(readFileSync(responseSchemasPath(projectRoot), 'utf8'))
}

function summarizeVerificationFailure(error) {
  const stderr = error?.stderr == null ? '' : String(error.stderr)
  const stdout = error?.stdout == null ? '' : String(error.stdout)
  const output = `${stderr}\n${stdout}\n${error?.message ?? ''}`.trim()
  return output.length > 2000 ? output.slice(output.length - 2000) : output
}

function verifyRuntimeSummaryStructure(projectRoot, reportPath) {
  if (!existsSync(resolve(projectRoot, 'package.json'))) {
    return { passed: true, detail: 'skipped without package.json fixture' }
  }
  const enterprise = existsSync(resolve(projectRoot, 'contracts/enterprise/test-disposition.json'))
  const args = enterprise
    ? ['run', 'enterprise:verify-automation-summary', '--', '--private-root', projectRoot, '--summary', reportPath]
    : ['run', 'verify:automation-summary', '--', '--summary', reportPath]
  try {
    execFileSync('npm', args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { passed: true, detail: 'runtime summary structure verified' }
  } catch (error) {
    return {
      passed: false,
      detail: summarizeVerificationFailure(error),
    }
  }
}

function repositoryState(projectRoot) {
  try {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain'], {
      cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() !== ''
    return { revision, dirty }
  } catch {
    return { revision: 'unknown', dirty: true }
  }
}

function runtimeMetadata(platform, runtime = {}) {
  return {
    target: runtime.target ?? (platform === 'android' ? 'app-android' : platform === 'ios' ? 'app-ios-simulator' : 'app-harmony'),
    deviceID: runtime.deviceID ?? 'unknown',
    deviceKind: runtime.deviceKind ?? 'unknown',
    osVersion: runtime.osVersion ?? 'unknown',
    architecture: runtime.architecture ?? 'unknown',
    buildConfiguration: runtime.buildConfiguration ?? 'Debug',
  }
}

export function createAutomationEvidenceRecord({
  projectRoot,
  platform,
  report,
  reportPath,
  fullRun = true,
  manifestOverride,
  repositoryOverride,
  runtime,
  series,
  runId = randomUUID(),
}) {
  const manifest = manifestOverride ?? readDispositionManifest(projectRoot)
  const responseSchemas = manifestOverride == null ? readResponseSchemas(projectRoot) : undefined
  const contractEvidence = validateAutomationEvidence({ manifest, responseSchemas, report, platform, fullRun })
  const responseStructureEvidence = manifestOverride == null
    ? verifyRuntimeSummaryStructure(projectRoot, reportPath)
    : { passed: true, detail: 'skipped for manifestOverride fixture' }
  if (!responseStructureEvidence.passed) {
    contractEvidence.passed = false
    contractEvidence.issues.push({
      caseId: 'runtime-summary',
      axis: 'structure',
      rule: 'schema-verification-failed',
      detail: responseStructureEvidence.detail,
    })
  }
  return {
    schemaVersion: 2,
    runId,
    generatedAt: new Date().toISOString(),
    platform,
    fullRun,
    series: series ?? { id: runId, sequence: 1, total: 1 },
    repository: repositoryOverride ?? repositoryState(projectRoot),
    runtime: runtimeMetadata(platform, runtime),
    sourceReport: {
      path: reportPath == null ? '' : relative(projectRoot, reportPath),
      headline: typeof report?.headline === 'string' ? report.headline : '',
      total: typeof report?.total === 'number' ? report.total : 0,
      passed: typeof report?.passed === 'number' ? report.passed : 0,
      failed: typeof report?.failed === 'number' ? report.failed : 0,
      skipped: typeof report?.skipped === 'number' ? report.skipped : 0,
    },
    contractEvidence,
    responseStructureEvidence,
    redactedReport: redactAutomationValue(report),
  }
}

export function writeLatestAutomationEvidence({
  projectRoot,
  platform,
  startedAtMs = 0,
  fullRun = true,
  manifestOverride,
  repositoryOverride,
  runtime,
  series,
  runId,
}) {
  const latest = findLatestAutomationReport(projectRoot, startedAtMs)
  if (latest == null) {
    throw new Error('no automation JSON artifact was produced for this run')
  }
  const report = JSON.parse(readFileSync(latest.path, 'utf8'))
  const evidence = createAutomationEvidenceRecord({
    projectRoot,
    platform,
    report,
    reportPath: latest.path,
    fullRun,
    manifestOverride,
    repositoryOverride,
    runtime,
    series,
    runId,
  })
  const safeRunId = evidence.runId.replace(/[^A-Za-z0-9._-]/g, '-')
  const evidencePath = resolve(artifactDirectory(projectRoot), `${platform}-${safeRunId}-evidence.json`)
  const latestEvidencePath = resolve(artifactDirectory(projectRoot), `${platform}-latest-evidence.json`)
  mkdirSync(resolve(evidencePath, '..'), { recursive: true })
  const encoded = `${JSON.stringify(evidence, null, 2)}\n`
  writeFileSync(evidencePath, encoded)
  writeFileSync(latestEvidencePath, encoded)
  return { evidence, evidencePath, latestEvidencePath, reportPath: latest.path }
}

export function evidenceManifestSummary(projectRoot, evidencePath, evidence) {
  return {
    path: relative(projectRoot, evidencePath),
    passed: evidence.contractEvidence.passed === true,
    strictPassed: evidence.contractEvidence.strictPassed === true,
    responseStructurePassed: evidence.responseStructureEvidence?.passed === true,
    checkedCallables: evidence.contractEvidence.checkedCallables,
    passedCallables: evidence.contractEvidence.passedCallables,
    acceptedCallables: evidence.contractEvidence.acceptedCallables,
    checkedEvents: evidence.contractEvidence.checkedEvents,
    passedEvents: evidence.contractEvidence.passedEvents,
    acceptedEvents: evidence.contractEvidence.acceptedEvents,
    knownIssueWaiverCount: Array.isArray(evidence.contractEvidence.knownIssueWaivers) ? evidence.contractEvidence.knownIssueWaivers.length : 0,
    issueCount: Array.isArray(evidence.contractEvidence.issues) ? evidence.contractEvidence.issues.length : 0,
    issueSummary: formatAutomationEvidenceIssues(evidence.contractEvidence),
  }
}

export function reportManifestSummary(projectRoot, reportPath, report) {
  return {
    path: relative(projectRoot, reportPath),
    headline: typeof report?.headline === 'string' ? report.headline : '',
    total: typeof report?.total === 'number' ? report.total : 0,
    passed: typeof report?.passed === 'number' ? report.passed : 0,
    failed: typeof report?.failed === 'number' ? report.failed : 0,
    skipped: typeof report?.skipped === 'number' ? report.skipped : 0,
  }
}

export function latestEvidenceBasename(projectRoot, path) {
  return relative(projectRoot, path)
}

export function evidenceFailureMessage(evidence) {
  return `automation evidence failed: ${formatAutomationEvidenceIssues(evidence.contractEvidence)}`
}

export function latestArtifactName(path) {
  return basename(path)
}
