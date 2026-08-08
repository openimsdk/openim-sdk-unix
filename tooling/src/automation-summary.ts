import { readFileSync } from 'node:fs'
import type { ContractDocument, EnterpriseDeltaDocument } from './model.js'
import {
  buildEnterpriseResponseSchemas,
  buildEnterpriseTestDisposition,
  buildPublicResponseSchemas,
  buildPublicTestDisposition,
  type ResponseSchemaDocument,
  type SchemaValidationIssue,
  type TestDispositionDocument,
  validateContractValue,
} from './test-contract.js'

export interface AutomationSummaryCaseRecord {
  caseId?: string
  suite?: string
  name?: string
  apiName?: string
  ok?: boolean
  detail?: string
  responseEvidence?: boolean
  responseDetail?: string
  skipped?: boolean
  resolved?: boolean
  structureValidated?: boolean
  negativeValidated?: boolean
}

export interface AutomationSummaryDocument {
  cases?: AutomationSummaryCaseRecord[]
}

export interface AutomationSummaryStructureFailure {
  caseId: string
  apiName: string
  recordedStructureValidated: boolean
  detail: string
  issues: SchemaValidationIssue[]
}

export interface AutomationSummaryStructureVerification {
  edition: 'public' | 'enterprise'
  verifiedCases: number
  skippedCases: number
  failures: AutomationSummaryStructureFailure[]
  driftFailures: AutomationSummaryStructureFailure[]
  missingRecordedStructureValidation: string[]
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function readSummaryDocument(summaryPath: string): AutomationSummaryDocument {
  return JSON.parse(readFileSync(summaryPath, 'utf8')) as AutomationSummaryDocument
}

function parseRecordedValue(detail: string, codec: string): unknown {
  const trimmed = detail.trim()
  if (codec === 'void') {
    if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined') return null
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed
    }
  }
  if (trimmed === '') return ''
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

function verifySummaryStructureWithDocuments(
  edition: 'public' | 'enterprise',
  summary: AutomationSummaryDocument,
  schemas: ResponseSchemaDocument,
  disposition: TestDispositionDocument,
): AutomationSummaryStructureVerification {
  const failures: AutomationSummaryStructureFailure[] = []
  const driftFailures: AutomationSummaryStructureFailure[] = []
  const missingRecordedStructureValidation: string[] = []
  const dispositionByName = new Map(disposition.callables.map((item) => [item.apiName, item]))
  let verifiedCases = 0
  let skippedCases = 0
  for (const item of summary.cases ?? []) {
    const apiName = item.apiName ?? item.name ?? ''
    const callable = dispositionByName.get(apiName)
    if (callable == null || !callable.validationAxes.includes('structure')) {
      skippedCases += 1
      continue
    }
    if (item.skipped === true || item.negativeValidated === true || item.ok !== true || item.resolved !== true || item.responseEvidence !== true) {
      skippedCases += 1
      continue
    }
    const schema = schemas.callables[apiName]?.schema
    assert(schema != null, `Missing response schema for ${apiName}`)
    if (schema.kind === 'reference' && schema.name === 'OpenIMSDKEventSubscription') {
      skippedCases += 1
      continue
    }
    const value = parseRecordedValue(item.responseDetail ?? '', schemas.callables[apiName]?.codec ?? 'any')
    const issues = validateContractValue(schemas, schema, value)
    const errors = issues.filter((issue) => issue.severity === 'error')
    const drift = issues.filter((issue) => issue.severity === 'contract-drift')
    const failure = {
      caseId: item.caseId ?? `${item.suite ?? 'unknown'}/${item.name ?? apiName}`,
      apiName,
      recordedStructureValidated: item.structureValidated === true,
      detail: item.detail ?? '',
      issues,
    }
    if (errors.length > 0) failures.push({ ...failure, issues: errors })
    if (drift.length > 0) driftFailures.push({ ...failure, issues: drift })
    if (errors.length === 0 && drift.length === 0 && item.structureValidated !== true) {
      missingRecordedStructureValidation.push(apiName)
    }
    verifiedCases += 1
  }
  return {
    edition,
    verifiedCases,
    skippedCases,
    failures,
    driftFailures,
    missingRecordedStructureValidation,
  }
}

export function verifyPublicAutomationSummaryStructure(
  contract: ContractDocument,
  summaryPath: string,
): AutomationSummaryStructureVerification {
  return verifySummaryStructureWithDocuments(
    'public',
    readSummaryDocument(summaryPath),
    buildPublicResponseSchemas(contract),
    buildPublicTestDisposition(contract),
  )
}

export function verifyEnterpriseAutomationSummaryStructure(
  base: ContractDocument,
  delta: EnterpriseDeltaDocument,
  summaryPath: string,
): AutomationSummaryStructureVerification {
  return verifySummaryStructureWithDocuments(
    'enterprise',
    readSummaryDocument(summaryPath),
    buildEnterpriseResponseSchemas(base, delta),
    buildEnterpriseTestDisposition(base, delta),
  )
}
