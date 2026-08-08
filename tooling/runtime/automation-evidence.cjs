'use strict'

const callableAxisFlags = {
  structure: 'structureValidated',
  semantic: 'semanticValidated',
  'side-effect': 'sideEffectValidated',
  event: 'eventCorrelated',
}

const eventAxisFlags = {
  delivery: 'deliveryValidated',
  structure: 'structureValidated',
  semantic: 'semanticValidated',
  ordering: 'orderingValidated',
  epoch: 'epochValidated',
}

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isSkipped(item) {
  return item.skipped === true || item.status === 'skipped'
}

function isSuccessfulEvidence(item) {
  return !isSkipped(item) && (item.ok === true || item.status === 'passed')
}

function callableEvidenceName(item) {
  if (typeof item.apiName === 'string' && item.apiName.length > 0) {
    return item.apiName
  }
  return typeof item.name === 'string' ? item.name : ''
}

function eventEvidenceName(item) {
  if (typeof item.eventName === 'string' && item.eventName.length > 0) {
    return item.eventName
  }
  return typeof item.name === 'string' ? item.name : ''
}

function parseRecordedValue(detail, codec) {
  if (typeof detail !== 'string') {
    return detail
  }
  const trimmed = detail.trim()
  if (codec === 'void') {
    if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined') {
      return null
    }
  } else if (trimmed === '') {
    return ''
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

function actualKind(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function isUTSTypedJSONPropertyMetadata(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isRecord(item) && Object.keys(item).length === 0)
}

function normalizeRecordedValue(value, encoding) {
  if (encoding !== 'uts-typed-json-v1') return value
  if (Array.isArray(value)) return value.map((item) => normalizeRecordedValue(item, encoding))
  if (!isRecord(value)) return value
  const result = {}
  for (const [name, fieldValue] of Object.entries(value)) {
    if (name === 'propertyFields' && isUTSTypedJSONPropertyMetadata(fieldValue)) continue
    result[name] = normalizeRecordedValue(fieldValue, encoding)
  }
  return result
}

function schemaLabel(schema) {
  if (!isRecord(schema)) return 'invalid schema'
  if (schema.kind === 'reference') return String(schema.name)
  if (schema.kind === 'literal') return JSON.stringify(schema.value)
  return String(schema.kind)
}

function schemaIssue(path, rule, expected, actual, severity = 'error') {
  return { path, rule, expected, actual, severity }
}

function validateSchemaValue(document, schema, value, path = '$', referenceStack = []) {
  if (!isRecord(schema) || typeof schema.kind !== 'string') {
    return [schemaIssue(path, 'schema', 'declared schema', 'malformed schema')]
  }
  if (schema.kind === 'any') return []
  if (schema.kind === 'void') return value === undefined || value === null ? [] : [schemaIssue(path, 'type', 'void', actualKind(value))]
  if (schema.kind === 'string' || schema.kind === 'boolean') {
    return typeof value === schema.kind ? [] : [schemaIssue(path, 'type', schema.kind, actualKind(value))]
  }
  if (schema.kind === 'number') {
    return typeof value === 'number' && Number.isFinite(value) ? [] : [schemaIssue(path, 'finite-number', 'finite number', actualKind(value))]
  }
  if (schema.kind === 'null') return value === null ? [] : [schemaIssue(path, 'type', 'null', actualKind(value))]
  if (schema.kind === 'literal') {
    return value === schema.value ? [] : [schemaIssue(path, 'literal', JSON.stringify(schema.value), JSON.stringify(value))]
  }
  if (schema.kind === 'reference') {
    const schemas = isRecord(document.schemas) ? document.schemas : {}
    const target = schemas[schema.name]
    if (!isRecord(target)) return [schemaIssue(path, 'reference', String(schema.name), 'missing schema')]
    if (referenceStack.includes(schema.name)) return []
    return validateSchemaValue(document, target, value, path, [...referenceStack, schema.name])
  }
  if (schema.kind === 'union') {
    if (!Array.isArray(schema.options) || schema.options.length === 0) {
      return [schemaIssue(path, 'union', 'at least one option', 'empty union')]
    }
    const attempts = schema.options.map((option) => validateSchemaValue(document, option, value, path, referenceStack))
    const ranked = attempts
      .map((issues, index) => ({
        issues,
        index,
        errors: issues.filter((item) => item.severity === 'error').length,
        drift: issues.filter((item) => item.severity === 'contract-drift').length,
      }))
      .sort((left, right) => left.errors - right.errors || left.drift - right.drift || left.index - right.index)
    const best = ranked[0]
    return best == null
      ? [schemaIssue(path, 'union', schema.options.map(schemaLabel).join(' | '), actualKind(value))]
      : best.issues
  }
  if (schema.kind === 'array') {
    if (!Array.isArray(value)) return [schemaIssue(path, 'type', 'array', actualKind(value))]
    return value.flatMap((item, index) => validateSchemaValue(document, schema.items, item, `${path}[${index}]`, referenceStack))
  }
  if (schema.kind !== 'object') {
    return [schemaIssue(path, 'schema', 'known schema kind', schema.kind)]
  }
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return [schemaIssue(path, 'type', 'object', actualKind(value))]
  }
  const fields = isRecord(schema.fields) ? schema.fields : {}
  const issues = []
  for (const [name, field] of Object.entries(fields)) {
    if (!isRecord(field) || !isRecord(field.schema)) {
      issues.push(schemaIssue(`${path}.${name}`, 'schema', 'field schema', 'malformed schema'))
    } else if (!Object.prototype.hasOwnProperty.call(value, name)) {
      if (field.required === true) issues.push(schemaIssue(`${path}.${name}`, 'required', 'present', 'missing'))
    } else {
      issues.push(...validateSchemaValue(document, field.schema, value[name], `${path}.${name}`, referenceStack))
    }
  }
  for (const name of Object.keys(value)) {
    if (fields[name] == null) issues.push(schemaIssue(`${path}.${name}`, 'unknown-field', 'declared field', 'unknown field', 'contract-drift'))
  }
  return issues
}

function callableStructureResult(candidates, apiName, responseSchemas) {
  const callableSchemas = isRecord(responseSchemas.callables) ? responseSchemas.callables : {}
  const response = callableSchemas[apiName]
  if (!isRecord(response) || !isRecord(response.schema)) {
    return { passed: false, issues: [schemaIssue('$', 'response-schema', apiName, 'missing schema')] }
  }
  const recorded = candidates.filter((item) => isSuccessfulEvidence(item) && item.responseEvidence === true)
  if (recorded.length === 0) return { passed: false, issues: [] }
  const issues = recorded.flatMap((item) => validateSchemaValue(
    responseSchemas,
    response.schema,
    normalizeRecordedValue(
      parseRecordedValue(item.responseDetail, typeof response.codec === 'string' ? response.codec : 'any'),
      item.responseEncoding,
    ),
  ))
  return { passed: issues.length === 0, issues }
}

function validateEventArguments(document, eventSchema, value) {
  const argumentsSchema = Array.isArray(eventSchema.arguments) ? eventSchema.arguments : null
  if (argumentsSchema == null) {
    return [schemaIssue('$', 'event-schema', 'arguments array', 'missing arguments')]
  }
  if (argumentsSchema.length === 0) {
    return value === null || value === undefined
      ? []
      : [schemaIssue('$', 'type', 'void event payload', actualKind(value))]
  }
  if (argumentsSchema.length === 1) {
    return validateSchemaValue(document, argumentsSchema[0], value)
  }
  if (!Array.isArray(value)) {
    return [schemaIssue('$', 'type', `event argument tuple(${argumentsSchema.length})`, actualKind(value))]
  }
  if (value.length !== argumentsSchema.length) {
    return [schemaIssue('$', 'tuple-length', String(argumentsSchema.length), String(value.length))]
  }
  return argumentsSchema.flatMap((schema, index) => validateSchemaValue(document, schema, value[index], `$[${index}]`))
}

function eventStructureResult(candidates, eventName, responseSchemas) {
  const eventSchemas = isRecord(responseSchemas.events) ? responseSchemas.events : {}
  const eventSchema = eventSchemas[eventName]
  if (!isRecord(eventSchema)) {
    return { passed: false, issues: [schemaIssue('$', 'event-schema', eventName, 'missing schema')] }
  }
  const recorded = candidates.filter((item) => item.deliveryValidated === true && item.payloadEvidence === true)
  if (recorded.length === 0) return { passed: false, issues: [] }
  const issues = recorded.flatMap((item) => {
    if (!Array.isArray(item.payloadDetails)) {
      return [schemaIssue('$', 'payload-evidence', 'one recorded payload per delivery', 'missing payloadDetails')]
    }
    if (item.payloadDetails.length !== item.count) {
      return [schemaIssue('$', 'payload-count', String(item.count), String(item.payloadDetails.length))]
    }
    return item.payloadDetails.flatMap((detail) => validateEventArguments(
      responseSchemas,
      eventSchema,
      normalizeRecordedValue(parseRecordedValue(detail, 'any'), item.payloadEncoding),
    ))
  })
  return { passed: issues.length === 0, issues }
}

function axisPassed(candidates, axis, kind) {
  if (kind === 'callable' && axis === 'completion') {
    return candidates.some((item) => isSuccessfulEvidence(item) && item.invoked === true && item.resolved === true)
  }
  const flag = kind === 'callable' ? callableAxisFlags[axis] : eventAxisFlags[axis]
  if (flag == null) {
    return false
  }
  return candidates.some((item) => {
    if (kind === 'event' && axis === 'delivery') {
      return item[flag] === true && typeof item.count === 'number' && item.count > 0
    }
    if (kind === 'callable' && axis === 'structure') {
      return item[flag] === true && item.responseEvidence === true && isSuccessfulEvidence(item)
    }
    return item[flag] === true && (kind === 'event' || isSuccessfulEvidence(item))
  })
}

function negativeEvidencePassed(candidates, disposition, contractCase) {
  return candidates.some((item) => {
    if (!isSuccessfulEvidence(item) || item.invoked !== true || item.resolved !== false || item.negativeValidated !== true) {
      return false
    }
    const profile = typeof item.negativeProfile === 'string' ? item.negativeProfile : ''
    if (profile.length === 0) {
      return false
    }
    if (disposition === 'platform-unsupported' && profile !== 'platform-unsupported') {
      return false
    }
    if (Array.isArray(contractCase.negativeProfiles) && contractCase.negativeProfiles.length > 0 && !contractCase.negativeProfiles.includes(profile)) {
      return false
    }
    return typeof item.errCode === 'number' && Number.isFinite(item.errCode)
  })
}

function issue(caseId, axis, rule, detail) {
  return { caseId, axis, rule, detail }
}

function validateAutomationEvidence(input) {
  if (!isRecord(input)) {
    throw new Error('Automation evidence input must be an object')
  }
  const manifest = input.manifest
  const report = input.report
  const platform = input.platform
  if (!isRecord(manifest) || manifest.schemaVersion !== 2 || !Array.isArray(manifest.callables) || !Array.isArray(manifest.events)) {
    throw new Error('Automation evidence requires a schemaVersion 2 test disposition manifest')
  }
  if (!isRecord(report)) {
    throw new Error('Automation evidence report must be an object')
  }
  if (platform !== 'android' && platform !== 'ios' && platform !== 'harmony') {
    throw new Error(`Unsupported automation evidence platform: ${String(platform)}`)
  }

  const fullRun = input.fullRun !== false
  const reportCases = Array.isArray(report.cases) ? report.cases.filter(isRecord) : []
  const reportEvents = Array.isArray(report.events) ? report.events.filter(isRecord) : []
  const issues = []
  let checkedCallables = 0
  let passedCallables = 0
  let checkedEvents = 0
  let passedEvents = 0

  for (const contractCase of manifest.callables) {
    if (!isRecord(contractCase) || typeof contractCase.apiName !== 'string') {
      throw new Error('Malformed callable entry in test disposition manifest')
    }
    const disposition = isRecord(contractCase.platforms) ? contractCase.platforms[platform] : undefined
    if (disposition === 'not-in-edition') {
      continue
    }
    const candidates = reportCases.filter((item) => callableEvidenceName(item) === contractCase.apiName)
    if (!fullRun && candidates.length === 0) {
      continue
    }
    checkedCallables += 1
    const before = issues.length
    if (disposition === 'capability-negative' || disposition === 'platform-unsupported') {
      if (!negativeEvidencePassed(candidates, disposition, contractCase)) {
        issues.push(issue(
          String(contractCase.caseId),
          'negative',
          'missing-negative-evidence',
          `${contractCase.apiName} must execute and validate its ${disposition} error contract; skip is not evidence`,
        ))
      }
    } else if (disposition === 'required') {
      const axes = Array.isArray(contractCase.validationAxes) ? contractCase.validationAxes : []
      for (const axis of axes) {
        if (axis === 'structure' && isRecord(input.responseSchemas)) {
          const structure = callableStructureResult(candidates, contractCase.apiName, input.responseSchemas)
          if (!structure.passed) {
            const schemaDetail = structure.issues.slice(0, 3).map((item) => `${item.path} ${item.rule}: expected ${item.expected}, got ${item.actual}`).join('; ')
            issues.push(issue(
              String(contractCase.caseId),
              'structure',
              structure.issues.length === 0 ? (candidates.length === 0 ? 'missing-evidence' : 'axis-not-validated') : 'response-schema-invalid',
              schemaDetail.length > 0 ? `${contractCase.apiName} response failed generated schema: ${schemaDetail}` : `${contractCase.apiName} has no explicit response evidence on ${platform}`,
            ))
          }
          continue
        }
        if (!axisPassed(candidates, axis, 'callable')) {
          issues.push(issue(
            String(contractCase.caseId),
            String(axis),
            candidates.length === 0 ? 'missing-evidence' : 'axis-not-validated',
            `${contractCase.apiName} has no passing ${String(axis)} evidence on ${platform}`,
          ))
        }
      }
    } else {
      issues.push(issue(String(contractCase.caseId), 'disposition', 'unknown-platform-disposition', String(disposition)))
    }
    if (issues.length === before) {
      passedCallables += 1
    }
  }

  for (const contractEvent of manifest.events) {
    if (!isRecord(contractEvent) || typeof contractEvent.eventName !== 'string') {
      throw new Error('Malformed event entry in test disposition manifest')
    }
    const disposition = isRecord(contractEvent.platforms) ? contractEvent.platforms[platform] : undefined
    if (disposition === 'not-in-edition') {
      continue
    }
    const candidates = reportEvents.filter((item) => eventEvidenceName(item) === contractEvent.eventName)
    if (!fullRun && candidates.length === 0) {
      continue
    }
    if (contractEvent.deliveryDisposition === 'passive-only' && candidates.length === 0) {
      continue
    }
    checkedEvents += 1
    const before = issues.length
    if (disposition === 'platform-unsupported') {
      if (!negativeEvidencePassed(candidates, disposition, contractEvent)) {
        issues.push(issue(
          String(contractEvent.caseId),
          'negative',
          'missing-negative-evidence',
          `${contractEvent.eventName} must validate its platform-unsupported event contract; skip is not evidence`,
        ))
      }
    } else if (disposition === 'required') {
      const axes = Array.isArray(contractEvent.validationAxes) ? contractEvent.validationAxes : []
      for (const axis of axes) {
        if (axis === 'structure' && isRecord(input.responseSchemas)) {
          const structure = eventStructureResult(candidates, contractEvent.eventName, input.responseSchemas)
          if (!structure.passed) {
            const schemaDetail = structure.issues.slice(0, 3).map((item) => `${item.path} ${item.rule}: expected ${item.expected}, got ${item.actual}`).join('; ')
            issues.push(issue(
              String(contractEvent.caseId),
              'structure',
              structure.issues.length === 0 ? (candidates.length === 0 ? 'missing-evidence' : 'axis-not-validated') : 'event-schema-invalid',
              schemaDetail.length > 0 ? `${contractEvent.eventName} payload failed generated schema: ${schemaDetail}` : `${contractEvent.eventName} has no explicit payload evidence on ${platform}`,
            ))
          }
          continue
        }
        if (!axisPassed(candidates, axis, 'event')) {
          issues.push(issue(
            String(contractEvent.caseId),
            String(axis),
            candidates.length === 0 ? 'missing-evidence' : 'axis-not-validated',
            `${contractEvent.eventName} has no passing ${String(axis)} evidence on ${platform}`,
          ))
        }
      }
    } else if (disposition === 'capability-negative') {
      if (!negativeEvidencePassed(candidates, disposition, contractEvent)) {
        issues.push(issue(String(contractEvent.caseId), 'negative', 'missing-negative-evidence', `${contractEvent.eventName} has no executable capability-negative evidence`))
      }
    } else {
      issues.push(issue(String(contractEvent.caseId), 'disposition', 'unknown-platform-disposition', String(disposition)))
    }
    if (issues.length === before) {
      passedEvents += 1
    }
  }

  return {
    schemaVersion: 1,
    edition: manifest.edition,
    platform,
    fullRun,
    checkedCallables,
    passedCallables,
    checkedEvents,
    passedEvents,
    passed: issues.length === 0,
    issues,
  }
}

function formatAutomationEvidenceIssues(result, limit = 20) {
  if (result == null || !Array.isArray(result.issues) || result.issues.length === 0) {
    return 'none'
  }
  const shown = result.issues.slice(0, limit).map((item) => `${item.caseId}[${item.axis}]: ${item.detail}`)
  if (result.issues.length > shown.length) {
    shown.push(`... ${result.issues.length - shown.length} more`)
  }
  return shown.join('; ')
}

module.exports = {
  formatAutomationEvidenceIssues,
  validateAutomationEvidence,
}
