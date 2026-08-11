import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

interface PolicyRule {
  id: string
  pattern: string
  flags?: string
  description: string
}

interface PolicyDocument {
  version: number
  files: string[]
  boundaryFiles: string[]
  rules: PolicyRule[]
  boundaryOnlyRules: PolicyRule[]
}

interface CompatibilityEntry {
  id: string
  editions?: ReleaseEdition[]
  classification: string
  owner?: string
  status?: 'active' | 'retired'
  releaseStatus?: 'certified' | 'blocked'
  lastVerified?: string
  nextCheck?: string
  expiry?: string
}

interface CompatibilityLedger {
  version: number
  entries: CompatibilityEntry[]
}

export type ReleaseEdition = 'public' | 'enterprise'

interface PublicNativeArtifactPolicy {
  android?: {
    sha256?: string
    externalCoordinate?: string
    externalAbiStatus?: string
    externalArtifactSha256?: string
  }
  ios?: {
    extractedInventorySha256?: string
    externalPod?: string
    externalVersion?: string
    externalAbiStatus?: string
    externalInventorySha256?: string
  }
}

interface ReleaseToolchainLock {
  publicNative?: PublicNativeArtifactPolicy
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const SHA256 = /^[a-f0-9]{64}$/
const RELEASE_EDITIONS = new Set<ReleaseEdition>(['public', 'enterprise'])

export function verifyCompatibilityLedger(
  root: string,
  release = false,
  today = new Date().toISOString().slice(0, 10),
  edition?: ReleaseEdition,
): void {
  const paths = [join(root, 'tooling/compatibility/ledger.json')]
  const enterprisePath = join(root, 'contracts/enterprise/compatibility-ledger.json')
  if (existsSync(enterprisePath)) paths.push(enterprisePath)
  const ledgers = paths.map((path) => JSON.parse(readFileSync(path, 'utf8')) as CompatibilityLedger)
  const findings: string[] = []
  if (ledgers.some((ledger) => ledger.version !== 1)) findings.push('compatibility ledger version changed')
  const ids = new Set<string>()
  const entries = [
    ...ledgers[0]!.entries.filter((entry) => entry.editions?.includes('public') === true),
    ...ledgers.slice(1).flatMap((ledger) => ledger.entries),
  ]
  for (const entry of entries) {
    if (ids.has(entry.id)) findings.push(`${entry.id} is duplicated`)
    ids.add(entry.id)
    if (entry.editions == null || entry.editions.length === 0 || entry.editions.some((value) => !RELEASE_EDITIONS.has(value))) {
      findings.push(`${entry.id} has no valid editions`)
    }
    if (entry.owner?.trim() === '') findings.push(`${entry.id} has no owner`)
    if (entry.owner == null) findings.push(`${entry.id} has no owner`)
    if (entry.status !== 'active' && entry.status !== 'retired') findings.push(`${entry.id} has no valid status`)
    if (entry.releaseStatus !== 'certified' && entry.releaseStatus !== 'blocked') {
      findings.push(`${entry.id} has no valid releaseStatus`)
    }
    if (entry.lastVerified == null || !ISO_DATE.test(entry.lastVerified) || entry.lastVerified > today) {
      findings.push(`${entry.id} has no valid lastVerified date`)
    }
    if (entry.nextCheck == null || !ISO_DATE.test(entry.nextCheck)) {
      findings.push(`${entry.id} has no valid nextCheck date`)
    } else if (entry.status === 'active' && entry.nextCheck < today) {
      findings.push(`${entry.id} review is overdue (${entry.nextCheck})`)
    }
    if (entry.classification === 'experimental') {
      if (entry.expiry == null || !ISO_DATE.test(entry.expiry)) findings.push(`${entry.id} experimental entry has no expiry`)
      else if (entry.expiry < today) findings.push(`${entry.id} experimental entry expired (${entry.expiry})`)
    }
    const appliesToRelease = edition == null || entry.editions?.includes(edition) === true
    if (release && appliesToRelease && entry.status === 'active' && entry.releaseStatus !== 'certified') {
      findings.push(`${entry.id} is release-blocked`)
    }
  }
  if (findings.length > 0) throw new Error(`Compatibility ledger violations:\n${findings.join('\n')}`)
}

export function verifyReleaseNativeArtifacts(root: string, edition: ReleaseEdition): void {
  if (edition === 'enterprise') return
  const toolchain = JSON.parse(readFileSync(join(root, 'toolchain.lock.json'), 'utf8')) as ReleaseToolchainLock
  const findings: string[] = []
  const android = toolchain.publicNative?.android
  if (android?.externalAbiStatus !== 'proven-identical') {
    findings.push(`Android remote artifact ${android?.externalCoordinate ?? '(missing coordinate)'} is not proven identical`)
  } else if (!SHA256.test(android.sha256 ?? '') || !SHA256.test(android.externalArtifactSha256 ?? '')) {
    findings.push('Android remote artifact has incomplete SHA-256 evidence')
  } else if (android.externalArtifactSha256 !== android.sha256) {
    findings.push('Android remote artifact hash does not match the locked source artifact')
  }

  const ios = toolchain.publicNative?.ios
  const podIdentity = `${ios?.externalPod ?? '(missing pod)'}@${ios?.externalVersion ?? '(missing version)'}`
  if (ios?.externalAbiStatus !== 'proven-identical') {
    findings.push(`iOS remote artifact ${podIdentity} is not proven identical`)
  } else if (!SHA256.test(ios.extractedInventorySha256 ?? '') || !SHA256.test(ios.externalInventorySha256 ?? '')) {
    findings.push('iOS remote artifact has incomplete inventory SHA-256 evidence')
  } else if (ios.externalInventorySha256 !== ios.extractedInventorySha256) {
    findings.push('iOS remote artifact inventory hash does not match the locked source artifact')
  }

  if (findings.length > 0) throw new Error(`Release native artifact violations:\n${findings.join('\n')}`)
}

function matchesPath(path: string, pattern: string): boolean {
  if (pattern.endsWith('/**')) return path.startsWith(pattern.slice(0, -3))
  if (pattern.startsWith('**/')) return path.endsWith(pattern.slice(3))
  return path === pattern
}

export function verifyUTSPolicy(root: string): void {
  const policy = JSON.parse(readFileSync(join(root, 'tooling/policy/uts-stable-policy.json'), 'utf8')) as PolicyDocument
  const findings: string[] = []
  for (const relativePath of policy.files) {
    const content = readFileSync(join(root, relativePath), 'utf8')
    const boundary = policy.boundaryFiles.some((pattern) => matchesPath(relativePath, pattern))
    const rules = boundary ? policy.rules : [...policy.rules, ...policy.boundaryOnlyRules]
    const lines = content.split(/\r?\n/)
    for (const rule of rules) {
      const expression = new RegExp(rule.pattern, rule.flags ?? '')
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? ''
        if (!expression.test(line)) continue
        if (line.includes(`UTS-COMPAT-ALLOW:${rule.id}`)) continue
        findings.push(`${relativePath}:${index + 1} ${rule.id} ${rule.description}`)
      }
    }
  }
  if (findings.length > 0) throw new Error(`UTS stable policy violations:\n${findings.join('\n')}`)
}
