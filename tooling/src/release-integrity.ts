import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ReleaseEdition } from './policy.js'

export interface ReleaseComponent {
  type: 'application' | 'library'
  name: string
  version: string
  'bom-ref': string
  purl?: string
  hashes?: Array<{ alg: 'SHA-256' | 'SHA-512'; content: string }>
  licenses: Array<{ license: { id: string } }>
  properties?: Array<{ name: string; value: string }>
}

export interface SecretAllowlistEntry {
  path: string
  rule: string
  matchSha256: string
  reason: string
}

export interface SecretFinding {
  path: string
  line: number
  rule: string
  matchSha256: string
}

export interface ReleaseIntegrityReport {
  schemaVersion: 1
  edition: ReleaseEdition
  repository: { revision: string; dirty: boolean }
  sbom: {
    bomFormat: 'CycloneDX'
    specVersion: '1.6'
    version: 1
    metadata: { component: ReleaseComponent }
    components: ReleaseComponent[]
  }
  licenses: {
    allowedSPDXLicenses: string[]
    findings: string[]
  }
  secrets: {
    scannedFiles: number
    skippedBinaryFiles: number
    findings: SecretFinding[]
    allowlisted: SecretAllowlistEntry[]
  }
}

interface PackageLockEntry {
  name?: string
  version?: string
  license?: string
  integrity?: string
}

interface PackageLock {
  packages: Record<string, PackageLockEntry>
}

interface NativeComponentAuthority {
  id: string
  editions: ReleaseEdition[]
  platform: 'android' | 'ios' | 'harmony'
  name: string
  version: string
  purl: string
  license: string
  hashSource: { document: string; jsonPointer: string }
}

interface NativeComponentDocument {
  schemaVersion: 1
  components: NativeComponentAuthority[]
}

interface LicensePolicy {
  schemaVersion: 1
  allowedSPDXLicenses: string[]
}

interface SecretAllowlistDocument {
  schemaVersion: 1
  entries: SecretAllowlistEntry[]
}

const SHA256 = /^[a-f0-9]{64}$/
const SECRET_RULES = [
  { id: 'private-key', expression: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g },
  { id: 'aws-access-key', expression: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'github-token', expression: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { id: 'api-secret', expression: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { id: 'jwt', expression: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g },
] as const

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function readJSON<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function packageNameFromLockPath(path: string, entry: PackageLockEntry): string {
  if (entry.name != null && entry.name !== '') return entry.name
  return path.split('node_modules/').at(-1) ?? path
}

function integrityHash(integrity: string | undefined): ReleaseComponent['hashes'] {
  if (integrity == null || integrity === '') return undefined
  const separator = integrity.indexOf('-')
  if (separator < 0) return undefined
  const algorithm = integrity.slice(0, separator)
  if (algorithm !== 'sha256' && algorithm !== 'sha512') return undefined
  const content = Buffer.from(integrity.slice(separator + 1), 'base64').toString('hex')
  return [{ alg: algorithm === 'sha256' ? 'SHA-256' : 'SHA-512', content }]
}

function npmComponents(root: string): ReleaseComponent[] {
  const lock = readJSON<PackageLock>(join(root, 'package-lock.json'))
  return Object.entries(lock.packages)
    .filter(([path]) => path !== '')
    .map(([path, entry]) => {
      const name = packageNameFromLockPath(path, entry)
      const version = entry.version ?? ''
      const license = entry.license ?? ''
      if (name === '' || version === '') throw new Error(`Locked npm component ${path} has incomplete identity`)
      const component: ReleaseComponent = {
        type: 'library' as const,
        name,
        version,
        'bom-ref': `npm:${name}@${version}:${path}`,
        purl: `pkg:npm/${encodeURIComponent(name)}@${version}`,
        licenses: license === '' ? [] : [{ license: { id: license } }],
      }
      const hashes = integrityHash(entry.integrity)
      if (hashes == null) throw new Error(`Locked npm component ${path} has no supported integrity hash`)
      component.hashes = hashes
      return component
    })
}

function jsonPointerValue(document: unknown, pointer: string): unknown {
  if (!pointer.startsWith('/')) throw new Error(`Invalid JSON pointer: ${pointer}`)
  let value = document
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (value == null || typeof value !== 'object' || !(key in value)) {
      throw new Error(`JSON pointer does not resolve: ${pointer}`)
    }
    value = (value as Record<string, unknown>)[key]
  }
  return value
}

function nativeComponents(root: string, edition: ReleaseEdition): ReleaseComponent[] {
  const authority = readJSON<NativeComponentDocument>(join(root, 'tooling/release/native-components.json'))
  if (authority.schemaVersion !== 1) throw new Error('Native component authority schema changed')
  const platforms = new Set<string>()
  const ids = new Set<string>()
  for (const component of authority.components) {
    if (ids.has(component.id)) throw new Error(`Native component ID is duplicated: ${component.id}`)
    ids.add(component.id)
    if (component.editions.length === 0 || component.editions.some((value) => value !== 'public' && value !== 'enterprise')) {
      throw new Error(`Native component ${component.id} has invalid editions`)
    }
    if (component.hashSource.document.startsWith('/') || component.hashSource.document.split('/').includes('..')) {
      throw new Error(`Native component ${component.id} hash authority must be repository-relative`)
    }
  }
  const components = authority.components
    .filter((component) => component.editions.includes(edition))
    .map((component) => {
      const document = readJSON<unknown>(join(root, component.hashSource.document))
      const hash = jsonPointerValue(document, component.hashSource.jsonPointer)
      if (typeof hash !== 'string' || !SHA256.test(hash)) {
        throw new Error(`Native component ${component.id} has invalid SHA-256 authority`)
      }
      platforms.add(component.platform)
      return {
        type: 'library' as const,
        name: component.name,
        version: component.version,
        'bom-ref': `native:${component.id}@${component.version}`,
        purl: component.purl,
        hashes: [{ alg: 'SHA-256' as const, content: hash }],
        licenses: [{ license: { id: component.license } }],
        properties: [
          { name: 'openim:edition', value: edition },
          { name: 'openim:platform', value: component.platform },
          { name: 'openim:hash-authority', value: `${component.hashSource.document}#${component.hashSource.jsonPointer}` },
        ],
      }
    })
  const required = edition === 'public' ? ['android', 'ios'] : ['android', 'ios', 'harmony']
  for (const platform of required) {
    if (!platforms.has(platform)) throw new Error(`${edition} SBOM is missing its ${platform} native component`)
  }
  return components
}

function workspaceComponent(root: string): ReleaseComponent {
  const plugin = readJSON<{ version?: string; license?: string }>(join(root, 'uni_modules/unix-openim-sdk/package.json'))
  return {
    type: 'application',
    name: 'unix-openim-sdk',
    version: plugin.version ?? '',
    'bom-ref': `workspace:unix-openim-sdk@${plugin.version ?? ''}`,
    purl: `pkg:generic/unix-openim-sdk@${plugin.version ?? ''}`,
    licenses: plugin.license == null ? [] : [{ license: { id: plugin.license } }],
  }
}

export function verifyComponentLicenses(components: ReleaseComponent[], allowed: Set<string>): string[] {
  const findings: string[] = []
  for (const component of components) {
    const licenses = component.licenses.map((item) => item.license.id).filter((value) => value !== '')
    if (licenses.length === 0) findings.push(`${component['bom-ref']} has a missing license`)
    for (const license of licenses) {
      if (!allowed.has(license)) findings.push(`${component['bom-ref']} license ${license} is not approved`)
    }
  }
  return findings
}

function lineNumber(content: string, offset: number): number {
  let line = 1
  for (let index = 0; index < offset; index += 1) if (content.charCodeAt(index) === 10) line += 1
  return line
}

export function scanReleaseSecrets(
  files: Array<{ path: string; content: string }>,
  allowlist: SecretAllowlistEntry[],
): { findings: SecretFinding[]; allowlisted: SecretAllowlistEntry[] } {
  const findings: SecretFinding[] = []
  const allowedMatches: SecretAllowlistEntry[] = []
  for (const file of files) {
    for (const rule of SECRET_RULES) {
      const expression = new RegExp(rule.expression.source, rule.expression.flags)
      for (const match of file.content.matchAll(expression)) {
        const matchSha256 = sha256(match[0])
        const finding = { path: file.path, line: lineNumber(file.content, match.index ?? 0), rule: rule.id, matchSha256 }
        const allowed = allowlist.find(
          (entry) => entry.path === finding.path && entry.rule === finding.rule && entry.matchSha256 === finding.matchSha256,
        )
        if (allowed == null) findings.push(finding)
        else allowedMatches.push(allowed)
      }
    }
  }
  return { findings, allowlisted: allowedMatches }
}

function trackedTextFiles(root: string): { files: Array<{ path: string; content: string }>; skippedBinaryFiles: number } {
  const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root })
  const paths = output.toString('utf8').split('\0').filter((path) => path !== '').sort()
  const files: Array<{ path: string; content: string }> = []
  let skippedBinaryFiles = 0
  for (const path of paths) {
    const content = readFileSync(join(root, path))
    if (content.includes(0)) {
      skippedBinaryFiles += 1
      continue
    }
    files.push({ path, content: content.toString('utf8') })
  }
  return { files, skippedBinaryFiles }
}

function repositoryState(root: string): { revision: string; dirty: boolean } {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' })
  return { revision, dirty: status.trim() !== '' }
}

export function buildReleaseIntegrityReport(
  root: string,
  edition: ReleaseEdition,
  options: { repository?: { revision: string; dirty: boolean } } = {},
): ReleaseIntegrityReport {
  const licensePolicy = readJSON<LicensePolicy>(join(root, 'tooling/release/license-policy.json'))
  const allowlist = readJSON<SecretAllowlistDocument>(join(root, 'tooling/release/secret-allowlist.json'))
  if (licensePolicy.schemaVersion !== 1 || allowlist.schemaVersion !== 1) throw new Error('Release integrity policy schema changed')
  const metadata = workspaceComponent(root)
  const components = [metadata, ...npmComponents(root), ...nativeComponents(root, edition)]
    .sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref']))
  if (new Set(components.map((component) => component['bom-ref'])).size !== components.length) {
    throw new Error('Release SBOM contains duplicate bom-ref values')
  }
  const licenses = [...licensePolicy.allowedSPDXLicenses].sort()
  const tracked = trackedTextFiles(root)
  const allowlistKeys = new Set<string>()
  for (const entry of allowlist.entries) {
    const key = `${entry.path}\0${entry.rule}\0${entry.matchSha256}`
    if (allowlistKeys.has(key)) throw new Error(`Secret allowlist entry is duplicated: ${entry.path}/${entry.rule}`)
    allowlistKeys.add(key)
    if (!SHA256.test(entry.matchSha256) || entry.reason.trim() === '') {
      throw new Error(`Secret allowlist entry is incomplete: ${entry.path}/${entry.rule}`)
    }
  }
  const secrets = scanReleaseSecrets(tracked.files, allowlist.entries)
  for (const entry of allowlist.entries) {
    if (!secrets.allowlisted.includes(entry)) throw new Error(`Secret allowlist entry is unused: ${entry.path}/${entry.rule}`)
  }
  return {
    schemaVersion: 1,
    edition,
    repository: options.repository ?? repositoryState(root),
    sbom: {
      bomFormat: 'CycloneDX',
      specVersion: '1.6',
      version: 1,
      metadata: { component: metadata },
      components,
    },
    licenses: {
      allowedSPDXLicenses: licenses,
      findings: verifyComponentLicenses(components, new Set(licenses)),
    },
    secrets: {
      scannedFiles: tracked.files.length,
      skippedBinaryFiles: tracked.skippedBinaryFiles,
      findings: secrets.findings,
      allowlisted: secrets.allowlisted,
    },
  }
}

export function releaseIntegrityFindings(report: ReleaseIntegrityReport, requireClean = false): string[] {
  const findings = [
    ...report.licenses.findings,
    ...report.secrets.findings.map((finding) => `${finding.path}:${finding.line} ${finding.rule} ${finding.matchSha256}`),
  ]
  if (requireClean && report.repository.dirty) findings.push('repository is dirty')
  return findings
}

export function verifyReleaseIntegrity(
  root: string,
  edition: ReleaseEdition,
  requireClean = false,
): { report: ReleaseIntegrityReport; reportPath: string } {
  const report = buildReleaseIntegrityReport(root, edition)
  const reportPath = join(root, 'test-results/release', `${edition}-release-integrity.json`)
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  const findings = releaseIntegrityFindings(report, requireClean)
  if (findings.length > 0) throw new Error(`Release integrity violations:\n${findings.join('\n')}`)
  return { report, reportPath }
}
