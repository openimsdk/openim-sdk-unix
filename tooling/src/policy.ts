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
