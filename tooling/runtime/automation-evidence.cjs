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

function eventEvidenceObserved(item) {
  return typeof item.count === 'number' && Number.isFinite(item.count) && item.count > 0
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

function callableStructureResult(candidates, apiName, responseSchemas, acceptsEvidence = isSuccessfulEvidence) {
  const callableSchemas = isRecord(responseSchemas.callables) ? responseSchemas.callables : {}
  const response = callableSchemas[apiName]
  if (!isRecord(response) || !isRecord(response.schema)) {
    return { passed: false, issues: [schemaIssue('$', 'response-schema', apiName, 'missing schema')] }
  }
  const recorded = candidates.filter((item) => acceptsEvidence(item) && item.responseEvidence === true)
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
    const opaqueStringPayload = eventSchema.payloadProfile === 'opaque-string'
      && Array.isArray(eventSchema.arguments)
      && eventSchema.arguments.length === 1
      && eventSchema.arguments[0]?.kind === 'string'
    return item.payloadDetails.flatMap((detail) => validateEventArguments(
      responseSchemas,
      eventSchema,
      opaqueStringPayload
        ? detail
        : normalizeRecordedValue(parseRecordedValue(detail, 'any'), item.payloadEncoding),
    ))
  })
  return { passed: issues.length === 0, issues }
}

function profileAssertionPassed(candidates, axis, profile) {
  if (typeof profile !== 'string' || profile.length === 0) return false
  return candidates.some((item) => {
    if (!isSuccessfulEvidence(item) || !Array.isArray(item.assertions)) return false
    return item.assertions.some((assertion) => isRecord(assertion)
      && assertion.axis === axis
      && assertion.profile === profile
      && typeof assertion.rule === 'string'
      && assertion.rule.length > 0
      && typeof assertion.expected === 'string'
      && typeof assertion.actual === 'string'
      && assertion.ok === true)
  })
}

function axisPassed(candidates, axis, kind, contractCase = null) {
  if (kind === 'callable' && axis === 'completion') {
    return candidates.some((item) => isSuccessfulEvidence(item) && item.invoked === true && item.resolved === true)
  }
  if (kind === 'callable' && axis === 'semantic') {
    return candidates.some((item) => item.semanticValidated === true && isSuccessfulEvidence(item))
      && profileAssertionPassed(candidates, 'semantic', contractCase?.semanticProfile)
  }
  if (kind === 'callable' && axis === 'side-effect') {
    return candidates.some((item) => item.sideEffectValidated === true && isSuccessfulEvidence(item))
      && profileAssertionPassed(candidates, 'side-effect', contractCase?.sideEffectProbe)
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

function approvedKnownIssueForPlatform(contractCase, platform) {
  if (!isRecord(contractCase) || !isRecord(contractCase.approvedKnownIssue)) return null
  const declared = contractCase.approvedKnownIssue[platform]
  if (!isRecord(declared) || typeof declared.code !== 'string' || declared.code.length === 0 || !Array.isArray(declared.waivedAxes)) return null
  const waivedAxes = declared.waivedAxes
    .filter((axis) => typeof axis === 'string' && axis.length > 0)
  if (waivedAxes.length === 0) return null
  return { code: declared.code, waivedAxes }
}

function approvedKnownIssueMatches(item, contractCase, platform) {
  const declared = approvedKnownIssueForPlatform(contractCase, platform)
  if (declared == null || !isRecord(item)) return false
  return item.knownIssue === true
    && item.compatibilityDisposition === 'approved-known-issue'
    && item.apiName === contractCase.apiName
    && item.knownIssueCode === declared.code
}

function axisWaivedByApprovedKnownIssue(candidates, contractCase, platform, axis) {
  const declared = approvedKnownIssueForPlatform(contractCase, platform)
  if (declared == null || !declared.waivedAxes.includes(axis)) return false
  return candidates.some((item) => approvedKnownIssueMatches(item, contractCase, platform))
}

function completionPassedByApprovedKnownIssue(candidates, contractCase, platform) {
  return candidates.some((item) => approvedKnownIssueMatches(item, contractCase, platform)
    && item.invoked === true
    && item.resolved === true)
}

function eventCorrelationIdentityField(eventName) {
  if (eventName === 'onSendMessageProgress') return 'operationID'
  if (eventName === 'onRecvNewMessage') return 'clientMsgID'
  if (eventName === 'onFriendApplicationAdded' || eventName === 'onFriendApplicationRejected') return 'fromUserID'
  if (eventName === 'onFriendAdded') return 'userID'
  if (eventName === 'onJoinedGroupAdded'
    || eventName === 'onGroupApplicationAdded'
    || eventName === 'onGroupMemberAdded'
    || eventName === 'onGroupApplicationRejected') return 'groupID'
  return ''
}

function eventCorrelationPayloadMatches(eventName, recorded, payloadIdentity) {
  if (!isRecord(recorded)) return false
  if (eventName === 'onGroupMemberAdded' || eventName === 'onGroupMemberDeleted') {
    const groupID = typeof recorded.groupID === 'string' ? recorded.groupID : ''
    const userID = typeof recorded.userID === 'string' ? recorded.userID : ''
    if (groupID.length > 0 && userID.length > 0 && `${groupID}:${userID}` === payloadIdentity) return true
  }
  const identityField = eventCorrelationIdentityField(eventName)
  return identityField.length > 0 && recorded[identityField] === payloadIdentity
}

function validCallableEventCorrelation(value, apiName, eventName) {
  if (!isRecord(value)) return false
  if (value.operationApiName !== apiName || value.eventName !== eventName || value.payloadMatched !== true) return false
  if (!Number.isFinite(value.operationSequence) || !Number.isFinite(value.eventSequence)) return false
  if (!Number.isFinite(value.operationEpoch) || !Number.isFinite(value.eventEpoch)) return false
  const crossAccountCorrelation = value.correlationKind === 'cross-account-payload-identity'
  const commonWindow = value.operationSequence >= 0
    && value.eventSequence > value.operationSequence
    && value.operationEpoch > 0
    && value.eventEpoch > 0
    && (crossAccountCorrelation || value.eventEpoch === value.operationEpoch)
  if (!commonWindow) return false
  if (value.correlationKind === 'lifecycle-order') {
    return value.exclusiveOperation === false && value.payloadIdentity === ''
  }
  if (value.correlationKind === 'payload-identity') {
    if (typeof value.payloadIdentity !== 'string' || value.payloadIdentity.length === 0) return false
    if (typeof value.eventPayloadDetail !== 'string' || !Number.isFinite(value.operationTerminalSequence)) return false
    if (value.operationTerminalSequence <= value.operationSequence) return false
    const recorded = normalizeRecordedValue(parseRecordedValue(value.eventPayloadDetail, 'any'), 'uts-typed-json-v1')
    return eventCorrelationPayloadMatches(eventName, recorded, value.payloadIdentity)
  }
  if (value.correlationKind === 'exclusive-operation-window') {
    return value.exclusiveOperation === true
      && value.payloadIdentity === ''
      && typeof value.eventPayloadDetail === 'string'
      && value.eventPayloadDetail.length > 0
      && Number.isFinite(value.operationTerminalSequence)
      && value.operationTerminalSequence > value.eventSequence
  }
  if (value.correlationKind === 'cross-account-payload-identity') {
    if ((value.exclusiveOperation !== true && value.exclusiveOperation !== false)
      || typeof value.payloadIdentity !== 'string'
      || value.payloadIdentity.length === 0) return false
    if (typeof value.eventPayloadDetail !== 'string' || !Number.isFinite(value.operationTerminalSequence)) return false
    if (value.operationTerminalSequence <= value.operationSequence) return false
    let recorded = parseRecordedValue(value.eventPayloadDetail, 'any')
    if (typeof recorded === 'string') {
      recorded = parseRecordedValue(recorded, 'any')
    }
    recorded = normalizeRecordedValue(recorded, 'uts-typed-json-v1')
    if (!isRecord(recorded)) return false
    if (eventName === 'onReceiveCustomSignaling') {
      return recorded.customInfo === value.payloadIdentity
    }
    if (isRecord(recorded.invitation)) {
      return recorded.invitation.roomID === value.payloadIdentity
    }
    return eventCorrelationPayloadMatches(eventName, recorded, value.payloadIdentity)
  }
  return false
}

function callableEventCorrelationResult(candidates, contractCase) {
  const expectedEvents = Array.isArray(contractCase.expectedEvents)
    ? [...new Set(contractCase.expectedEvents.filter((eventName) => typeof eventName === 'string' && eventName.length > 0))]
    : []
  if (expectedEvents.length === 0) {
    return { passed: false, missing: [], invalid: [], undeclared: true }
  }
  const correlations = candidates.flatMap((item) => {
    if (!isSuccessfulEvidence(item) || !Array.isArray(item.eventCorrelations)) return []
    return item.eventCorrelations
  })
  const missing = []
  const invalid = []
  for (const eventName of expectedEvents) {
    const matching = correlations.filter((item) => isRecord(item) && item.eventName === eventName)
    if (matching.length === 0) {
      missing.push(eventName)
    } else if (!matching.some((item) => validCallableEventCorrelation(item, contractCase.apiName, eventName))) {
      invalid.push(eventName)
    }
  }
  let coherentWindow = false
  if (missing.length === 0 && invalid.length === 0) {
    const firstEvent = expectedEvents[0]
    const startingPoints = correlations.filter((item) => validCallableEventCorrelation(item, contractCase.apiName, firstEvent))
    for (const startingPoint of startingPoints) {
      let previousSequence = startingPoint.eventSequence
      let coherent = true
      for (let index = 1; index < expectedEvents.length; index += 1) {
        const eventName = expectedEvents[index]
        const match = correlations.find((item) => validCallableEventCorrelation(item, contractCase.apiName, eventName)
          && item.operationSequence === startingPoint.operationSequence
          && item.operationEpoch === startingPoint.operationEpoch
          && item.eventSequence > previousSequence)
        if (match == null) {
          coherent = false
          break
        }
        previousSequence = match.eventSequence
      }
      if (coherent) {
        coherentWindow = true
        break
      }
    }
    if (!coherentWindow) invalid.push(...expectedEvents)
  }
  return { passed: missing.length === 0 && invalid.length === 0 && coherentWindow, missing, invalid, undeclared: false }
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
      const approvedKnownIssueCandidates = candidates.filter((item) => approvedKnownIssueMatches(item, contractCase, platform))
      const evidenceCandidates = approvedKnownIssueCandidates.length > 0 ? approvedKnownIssueCandidates : candidates
      for (const axis of axes) {
        if (axisWaivedByApprovedKnownIssue(evidenceCandidates, contractCase, platform, axis)) {
          continue
        }
        if (axis === 'completion' && completionPassedByApprovedKnownIssue(evidenceCandidates, contractCase, platform)) {
          continue
        }
        if (axis === 'structure' && isRecord(input.responseSchemas)) {
          const structure = callableStructureResult(
            evidenceCandidates,
            contractCase.apiName,
            input.responseSchemas,
            (item) => isSuccessfulEvidence(item) || approvedKnownIssueMatches(item, contractCase, platform),
          )
          if (!structure.passed) {
            const schemaDetail = structure.issues.slice(0, 3).map((item) => `${item.path} ${item.rule}: expected ${item.expected}, got ${item.actual}`).join('; ')
            issues.push(issue(
              String(contractCase.caseId),
              'structure',
              structure.issues.length === 0 ? (evidenceCandidates.length === 0 ? 'missing-evidence' : 'axis-not-validated') : 'response-schema-invalid',
              schemaDetail.length > 0 ? `${contractCase.apiName} response failed generated schema: ${schemaDetail}` : `${contractCase.apiName} has no explicit response evidence on ${platform}`,
            ))
          }
          continue
        }
        if (axis === 'event') {
          const correlation = callableEventCorrelationResult(evidenceCandidates, contractCase)
          if (!correlation.passed) {
            const reasons = []
            if (correlation.undeclared) reasons.push('manifest expectedEvents is empty')
            if (correlation.missing.length > 0) reasons.push(`missing ${correlation.missing.join(', ')}`)
            if (correlation.invalid.length > 0) reasons.push(`invalid order, epoch, or payload match for ${correlation.invalid.join(', ')}`)
            issues.push(issue(
              String(contractCase.caseId),
              'event',
              'event-correlation-invalid',
              `${contractCase.apiName} event evidence does not satisfy generated correlations: ${reasons.join('; ')}`,
            ))
          }
          continue
        }
        if (!axisPassed(evidenceCandidates, axis, 'callable', contractCase)) {
          const expectedProfile = axis === 'semantic'
            ? contractCase.semanticProfile
            : axis === 'side-effect'
              ? contractCase.sideEffectProbe
              : ''
          issues.push(issue(
            String(contractCase.caseId),
            String(axis),
            evidenceCandidates.length === 0 ? 'missing-evidence' : expectedProfile ? 'profile-assertion-invalid' : 'axis-not-validated',
            expectedProfile
              ? `${contractCase.apiName} has no passing ${String(axis)} assertion for generated profile ${String(expectedProfile)} on ${platform}`
              : `${contractCase.apiName} has no passing ${String(axis)} evidence on ${platform}`,
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
    const requiresNegativeEvidence = disposition === 'platform-unsupported' || disposition === 'capability-negative'
    const candidates = requiresNegativeEvidence
      ? reportCases.filter((item) => callableEvidenceName(item) === contractEvent.eventName)
      : reportEvents.filter((item) => eventEvidenceName(item) === contractEvent.eventName)
    if (!fullRun && candidates.length === 0) {
      continue
    }
    if (!requiresNegativeEvidence
      && contractEvent.deliveryDisposition === 'passive-only'
      && candidates.every((item) => !eventEvidenceObserved(item))) {
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
