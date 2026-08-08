import { readFileSync } from 'node:fs'
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function verifyCompatibilityLedger(
  root: string,
  release = false,
  today = new Date().toISOString().slice(0, 10),
): void {
  const ledger = JSON.parse(
    readFileSync(join(root, 'tooling/compatibility/ledger.json'), 'utf8'),
  ) as CompatibilityLedger
  const findings: string[] = []
  if (ledger.version !== 1) findings.push('compatibility ledger version changed')
  const ids = new Set<string>()
  for (const entry of ledger.entries) {
    if (ids.has(entry.id)) findings.push(`${entry.id} is duplicated`)
    ids.add(entry.id)
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
    if (release && entry.status === 'active' && entry.releaseStatus !== 'certified') {
      findings.push(`${entry.id} is release-blocked`)
    }
  }
  if (findings.length > 0) throw new Error(`Compatibility ledger violations:\n${findings.join('\n')}`)
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
