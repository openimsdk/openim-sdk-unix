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

const nonWaivableValidationAxes = new Set(['negative', 'cleanup'])
const focusedOptionalCallableAxes = new Set(['side-effect', 'event', 'negative', 'cleanup'])
const focusedSuiteRequiredCallables = {
  conversation: new Set(['setConversation', 'setConversationDraft']),
  group: new Set(['setGroupInfo']),
  'event-delivery': new Set(['sendMessage', 'sendMessageNotOss', 'uploadFile', 'uploadLogs']),
}
const focusedEventDeliveryRequiredAxes = new Set(['delivery', 'structure', 'semantic', 'ordering'])
const focusedSuiteRequiredEventPolicies = {
  'event-delivery': {
    onConnectFailed: { platforms: new Set(['harmony']), axes: focusedEventDeliveryRequiredAxes },
    onConnecting: { platforms: new Set(['android', 'ios', 'harmony']), axes: focusedEventDeliveryRequiredAxes },
    onConnectSuccess: { platforms: new Set(['android', 'ios', 'harmony']), axes: focusedEventDeliveryRequiredAxes },
    onSyncServerStart: { platforms: new Set(['android', 'ios', 'harmony']), axes: focusedEventDeliveryRequiredAxes },
    onSyncServerFinish: { platforms: new Set(['android', 'ios', 'harmony']), axes: focusedEventDeliveryRequiredAxes },
    onRecvOfflineNewMessage: { platforms: new Set(['harmony']), axes: focusedEventDeliveryRequiredAxes },
    onSendMessageProgress: { platforms: new Set(['android', 'ios', 'harmony']), axes: focusedEventDeliveryRequiredAxes },
    onRecvNewMessage: { platforms: new Set(['android', 'harmony']), axes: focusedEventDeliveryRequiredAxes },
    onUploadFileProgress: { platforms: new Set(['android', 'ios', 'harmony']), axes: focusedEventDeliveryRequiredAxes },
    onUploadLogsProgress: { platforms: new Set(['android', 'ios', 'harmony']), axes: focusedEventDeliveryRequiredAxes },
  },
}
const focusedSuiteRequiredCallableAxes = {
  conversation: {
    setConversation: new Set(['side-effect', 'cleanup']),
    setConversationDraft: new Set(['side-effect', 'cleanup']),
    changeInputStates: new Set(['side-effect']),
    markConversationMessageAsRead: new Set(['side-effect']),
    markAllConversationMessageAsRead: new Set(['side-effect']),
  },
  group: {
    setGroupInfo: new Set(['side-effect', 'event', 'cleanup']),
  },
  'event-delivery': {
    sendMessage: new Set(['event']),
    sendMessageNotOss: new Set(['event']),
    uploadFile: new Set(['event']),
    uploadLogs: new Set(['event']),
  },
}
// Focused callable evidence follows the producers that the selected platform
// can actually create. The generated manifest remains the full-run contract;
// this map only filters declared correlations for a focused suite and never
// invents an event that the manifest did not declare.
const focusedSuiteCallableEventPolicies = {
  'event-delivery': {
    sendMessage: {
      android: { requiresEvent: true, allowedEvents: ['onSendMessageProgress', 'onRecvNewMessage'] },
      ios: { requiresEvent: true, allowedEvents: ['onSendMessageProgress'] },
      harmony: { requiresEvent: true, allowedEvents: ['onSendMessageProgress', 'onRecvNewMessage'] },
    },
    sendMessageNotOss: {
      android: { requiresEvent: true, allowedEvents: ['onRecvNewMessage'] },
      ios: { requiresEvent: false, allowedEvents: [] },
      harmony: { requiresEvent: true, allowedEvents: ['onRecvNewMessage'] },
    },
    uploadFile: {
      android: { requiresEvent: true, allowedEvents: ['onUploadFileProgress'] },
      ios: { requiresEvent: true, allowedEvents: ['onUploadFileProgress'] },
      harmony: { requiresEvent: true, allowedEvents: ['onUploadFileProgress'] },
    },
    uploadLogs: {
      android: { requiresEvent: true, allowedEvents: ['onUploadLogsProgress'] },
      ios: { requiresEvent: true, allowedEvents: ['onUploadLogsProgress'] },
      harmony: { requiresEvent: true, allowedEvents: ['onUploadLogsProgress'] },
    },
  },
}
const harmonyCompatibilityCanonicalNegativeProducerSuites = new Set(['app', 'events'])

function focusedRunRequiresCallable(fullRun, focusedSuite, apiName) {
  if (fullRun) return true
  const requiredCallables = focusedSuiteRequiredCallables[focusedSuite]
  return requiredCallables instanceof Set && requiredCallables.has(apiName)
}

function focusedRunRequiredEventPolicy(focusedSuite, eventName) {
  const suitePolicy = focusedSuiteRequiredEventPolicies[focusedSuite]
  return isRecord(suitePolicy) ? suitePolicy[eventName] : null
}

function focusedRunRequiresEvent(fullRun, focusedSuite, platform, eventName) {
  if (fullRun) return true
  const eventPolicy = focusedRunRequiredEventPolicy(focusedSuite, eventName)
  return isRecord(eventPolicy)
    && eventPolicy.platforms instanceof Set
    && eventPolicy.platforms.has(platform)
}

function focusedCallableEventPolicy(fullRun, focusedSuite, platform, contractCase) {
  if (fullRun) return null
  const suitePolicy = focusedSuiteCallableEventPolicies[focusedSuite]
  if (!isRecord(suitePolicy) || !Object.prototype.hasOwnProperty.call(suitePolicy, contractCase.apiName)) return null
  const callablePolicy = suitePolicy[contractCase.apiName]
  if (!isRecord(callablePolicy) || !Object.prototype.hasOwnProperty.call(callablePolicy, platform)) {
    return { requiresEvent: true, allowedEvents: [] }
  }
  const platformPolicy = callablePolicy[platform]
  if (!isRecord(platformPolicy)
    || typeof platformPolicy.requiresEvent !== 'boolean'
    || !Array.isArray(platformPolicy.allowedEvents)) {
    return { requiresEvent: true, allowedEvents: [] }
  }
  return {
    requiresEvent: platformPolicy.requiresEvent,
    allowedEvents: platformPolicy.allowedEvents.filter((eventName) => typeof eventName === 'string' && eventName.length > 0),
  }
}

function focusedCallableExpectedEvents(fullRun, focusedSuite, platform, contractCase) {
  const policy = focusedCallableEventPolicy(fullRun, focusedSuite, platform, contractCase)
  if (policy == null) return null
  const declaredEvents = Array.isArray(contractCase.expectedEvents) ? contractCase.expectedEvents : []
  return [...new Set(declaredEvents.filter((eventName) => typeof eventName === 'string'
    && eventName.length > 0
    && policy.allowedEvents.includes(eventName)))]
}

function effectiveCallableExpectedEvents(fullRun, focusedSuite, platform, contractCase) {
  const focusedExpectedEvents = focusedCallableExpectedEvents(fullRun, focusedSuite, platform, contractCase)
  if (focusedExpectedEvents != null) return focusedExpectedEvents
  return Array.isArray(contractCase.expectedEvents) ? contractCase.expectedEvents : []
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

// The page-side UTS report deliberately calls this field `suite`; legacy
// host-side fixtures used `group`. Treat them as the same report contract so
// a selected-suite run is evaluated from the evidence it actually emitted.
function callableEvidenceSuite(item) {
  if (typeof item.group === 'string' && item.group.length > 0) {
    return item.group
  }
  return typeof item.suite === 'string' ? item.suite : ''
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
  if (schema.kind === 'string-map') {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      return [schemaIssue(path, 'type', 'string map', actualKind(value))]
    }
    return Object.entries(value).flatMap(([name, item]) => (
      typeof item === 'string' ? [] : [schemaIssue(`${path}.${name}`, 'type', 'string', actualKind(item))]
    ))
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

function itemAssertionPassed(item, axis, profile, requiredRule = null) {
  if (typeof profile !== 'string' || profile.length === 0) return false
  if (!isRecord(item) || !Array.isArray(item.assertions)) return false
  return item.assertions.some((assertion) => isRecord(assertion)
    && assertion.axis === axis
    && assertion.profile === profile
    && typeof assertion.rule === 'string'
    && assertion.rule.length > 0
    && (requiredRule == null || assertion.rule === requiredRule)
    && typeof assertion.expected === 'string'
    && typeof assertion.actual === 'string'
    && assertion.ok === true)
}

function itemDeclaresCallableAxis(item, axis) {
  if (!isRecord(item)) return false
  if (Array.isArray(item.assertions)
    && item.assertions.some((assertion) => isRecord(assertion) && assertion.axis === axis)) return true
  if (axis === 'side-effect') return item.sideEffectValidated === true
  if (axis === 'event') return item.eventCorrelated === true
    || (Array.isArray(item.eventCorrelations) && item.eventCorrelations.length > 0)
  if (axis === 'negative') return item.negativeValidated === true
    || (typeof item.negativeProfile === 'string' && item.negativeProfile.length > 0)
  if (axis === 'cleanup') return item.cleanupValidated === true
    || (typeof item.cleanupAction === 'string' && item.cleanupAction.length > 0)
  return true
}

function producerRunsInFocusedSuites(producer, focusedSuites, platform) {
  return isRecord(producer)
    && producerAppliesToPlatform(producer, platform)
    && focusedSuites instanceof Set
    && focusedSuites.has(producer.suite)
}

function harmonyCompatibilityRunsCanonicalNegativeProducer(profile, producer, focusedSuites, platform) {
  return profile === 'platform-unsupported'
    && platform === 'harmony'
    && focusedSuites instanceof Set
    && focusedSuites.size === 1
    && focusedSuites.has('harmony-compatibility')
    && producerAppliesToPlatform(producer, platform)
    && harmonyCompatibilityCanonicalNegativeProducerSuites.has(producer.suite)
}

function focusedRunIncludesPlannedCallableAxis(focusedSuites, contractCase, platform, axis) {
  if (axis === 'negative') {
    return Array.isArray(contractCase.negativeProducers)
      && contractCase.negativeProducers.some((item) => isRecord(item)
        && isRecord(item.producer)
        && (producerRunsInFocusedSuites(item.producer, focusedSuites, platform)
          || harmonyCompatibilityRunsCanonicalNegativeProducer(item.profile, item.producer, focusedSuites, platform)))
  }
  if (axis === 'cleanup') {
    return producerRunsInFocusedSuites(contractCase.cleanupProducer, focusedSuites, platform)
  }
  return false
}

function focusedRunIncludesCallableAxis(fullRun, focusedSuite, focusedSuites, contractCase, candidates, platform, axis) {
  const suitePolicy = focusedSuiteRequiredCallableAxes[focusedSuite]
  const apiPolicy = isRecord(suitePolicy) ? suitePolicy[contractCase.apiName] : null
  if (fullRun) return true
  const eventPolicy = focusedCallableEventPolicy(fullRun, focusedSuite, platform, contractCase)
  if (axis === 'event' && eventPolicy != null && eventPolicy.requiresEvent === false) {
    return false
  }
  const explicitlyOwned = (apiPolicy instanceof Set && apiPolicy.has(axis))
    || focusedRunIncludesPlannedCallableAxis(focusedSuites, contractCase, platform, axis)
  if (focusedSuite === 'event-delivery') {
    return explicitlyOwned
  }
  return !focusedOptionalCallableAxes.has(axis)
    || explicitlyOwned
    || candidates.some((item) => itemDeclaresCallableAxis(item, axis))
}

function focusedRunIncludesPlannedEventAxis(focusedSuites, contractEvent, platform, axis) {
  const includesProducer = (producer) => {
    return producerRunsInFocusedSuites(producer, focusedSuites, platform)
  }
  if (axis === 'negative') {
    return Array.isArray(contractEvent.negativeProducers)
      && contractEvent.negativeProducers.some((item) => isRecord(item)
        && isRecord(item.producer)
        && (includesProducer(item.producer)
          || harmonyCompatibilityRunsCanonicalNegativeProducer(item.profile, item.producer, focusedSuites, platform)))
  }
  if (axis === 'cleanup') return includesProducer(contractEvent.cleanupProducer)
  if (axis === 'epoch') {
    return isRecord(contractEvent.epochProducer)
      && includesProducer(contractEvent.epochProducer.producer)
  }
  return false
}

function focusedRunIncludesEventAxis(fullRun, focusedSuite, focusedSuites, contractEvent, platform, axis) {
  if (fullRun || focusedSuites == null) return true
  const eventPolicy = focusedRunRequiredEventPolicy(focusedSuite, contractEvent.eventName)
  const policyAxisOwned = focusedRunRequiresEvent(false, focusedSuite, platform, contractEvent.eventName)
    && isRecord(eventPolicy)
    && eventPolicy.axes instanceof Set
    && eventPolicy.axes.has(axis)
  return policyAxisOwned
    || focusedRunIncludesPlannedEventAxis(focusedSuites, contractEvent, platform, axis)
}

function profileAssertionPassed(candidates, axis, profile) {
  return candidates.some((item) => isSuccessfulEvidence(item) && itemAssertionPassed(item, axis, profile))
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
  return {
    code: declared.code,
    waivedAxes,
    evidenceApiName: typeof declared.evidenceApiName === 'string' ? declared.evidenceApiName : '',
  }
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
  if (nonWaivableValidationAxes.has(axis)) return false
  const declared = approvedKnownIssueForPlatform(contractCase, platform)
  if (declared == null || !declared.waivedAxes.includes(axis)) return false
  return candidates.some((item) => approvedKnownIssueMatches(item, contractCase, platform))
}

function completionPassedByApprovedKnownIssue(candidates, contractCase, platform) {
  return candidates.some((item) => approvedKnownIssueMatches(item, contractCase, platform)
    && item.invoked === true
    && item.resolved === true)
}

function approvedEventKnownIssueWaiver(reportCases, manifest, contractEvent, platform, axis) {
  if (nonWaivableValidationAxes.has(axis)) return null
  const declared = approvedKnownIssueForPlatform(contractEvent, platform)
  if (declared == null
    || !declared.waivedAxes.includes(axis)
    || declared.evidenceApiName.length === 0
    || !Array.isArray(manifest.callables)) return null
  const sourceContract = manifest.callables.find((item) => isRecord(item) && item.apiName === declared.evidenceApiName)
  const sourceDeclared = approvedKnownIssueForPlatform(sourceContract, platform)
  if (sourceDeclared == null || sourceDeclared.code !== declared.code) return null
  if (!reportCases.some((item) => approvedKnownIssueMatches(item, sourceContract, platform))) return null
  return {
    caseId: String(contractEvent.caseId),
    axis: String(axis),
    code: declared.code,
    evidenceApiName: declared.evidenceApiName,
  }
}

function callableKnownIssueWaiver(contractCase, platform, axis) {
  if (nonWaivableValidationAxes.has(axis)) return null
  const declared = approvedKnownIssueForPlatform(contractCase, platform)
  if (declared == null || !declared.waivedAxes.includes(axis)) return null
  return {
    caseId: String(contractCase.caseId),
    axis: String(axis),
    code: declared.code,
    evidenceApiName: contractCase.apiName,
  }
}

function eventCorrelationIdentityField(eventName) {
  if (eventName === 'onSendMessageProgress') return 'clientMsgID'
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

// Keep this policy aligned with buildAutomationEventCorrelations in the page
// runner.  The correlation kind is part of the evidence contract: a caller
// must not downgrade an identity-bearing event to an exclusive timing window.
const lifecycleCorrelationCallables = new Set([
  'initSDK', 'login', 'logout', 'unInitSDK', 'getLoginStatus', 'getLoginUserID',
])
const uploadCorrelationCallables = new Set(['uploadFile', 'uploadLogs'])
const crossAccountCorrelationCallables = new Set([
  'sendMessageNotOss',
  'addFriend', 'acceptFriendApplication', 'refuseFriendApplication', 'addBlack',
  'createGroup', 'joinGroup', 'acceptGroupApplication', 'refuseGroupApplication',
  'kickGroupMember', 'inviteUserToGroup', 'quitGroup', 'dismissGroup',
])
const operationCorrelationCallables = new Set([
  'updateFriends', 'deleteFriend', 'removeBlack', 'setGroupInfo',
  'setGroupMemberInfo', 'setConversation', 'changeInputStates',
  'markConversationMessageAsRead',
])

function requiredCallableEventCorrelationKind(apiName, eventName) {
  if (apiName === 'sendMessage' && eventName === 'onSendMessageProgress') {
    return 'operation-payload-identity'
  }
  if ((apiName === 'sendMessage' || apiName === 'sendMessageNotOss')
    && eventName === 'onRecvNewMessage') {
    return 'cross-account-payload-identity'
  }
  if (lifecycleCorrelationCallables.has(apiName)) return 'lifecycle-order'
  if (uploadCorrelationCallables.has(apiName)) return 'exclusive-operation-window'
  if (crossAccountCorrelationCallables.has(apiName)) return 'cross-account-payload-identity'
  if (operationCorrelationCallables.has(apiName)) return 'operation-payload-identity'
  return ''
}

function valueAtPath(value, path) {
  if (!isRecord(value) || typeof path !== 'string' || path.length === 0) return undefined
  let current = value
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return undefined
    current = current[segment]
  }
  return current
}

function validCallableEventCorrelation(value, apiName, eventName, identityPath) {
  if (!isRecord(value)) return false
  if (value.operationApiName !== apiName || value.eventName !== eventName || value.payloadMatched !== true) return false
  const requiredKind = requiredCallableEventCorrelationKind(apiName, eventName)
  if (requiredKind.length > 0 && value.correlationKind !== requiredKind) return false
  // This window kind is reserved for upload progress, whose payload has no
  // stable operation identity.  Do not let an unclassified operation bypass
  // the exact payload checks by claiming the weaker form.
  if (value.correlationKind === 'exclusive-operation-window'
    && !uploadCorrelationCallables.has(apiName)) return false
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
  if (value.correlationKind === 'operation-payload-identity') {
    if (typeof value.payloadIdentity !== 'string' || value.payloadIdentity.length === 0) return false
    if (typeof value.eventPayloadDetail !== 'string' || !Number.isFinite(value.operationTerminalSequence)) return false
    if (value.operationTerminalSequence <= value.operationSequence) return false
    const recorded = normalizeRecordedValue(parseRecordedValue(value.eventPayloadDetail, 'any'), 'uts-typed-json-v1')
    if (typeof identityPath === 'string' && identityPath.length > 0) {
      return valueAtPath(recorded, identityPath) === value.payloadIdentity
    }
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
    if (typeof identityPath === 'string' && identityPath.length > 0) {
      return valueAtPath(recorded, identityPath) === value.payloadIdentity
    }
    return eventCorrelationPayloadMatches(eventName, recorded, value.payloadIdentity)
  }
  return false
}

function callableEventCorrelationResult(candidates, contractCase, expectedEventsOverride = null) {
  const declaredExpectedEvents = expectedEventsOverride == null ? contractCase.expectedEvents : expectedEventsOverride
  const expectedEvents = Array.isArray(declaredExpectedEvents)
    ? [...new Set(declaredExpectedEvents.filter((eventName) => typeof eventName === 'string' && eventName.length > 0))]
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
    const identityPath = isRecord(contractCase.eventIdentityPaths)
      ? contractCase.eventIdentityPaths[eventName]
      : undefined
    const matching = correlations.filter((item) => isRecord(item) && item.eventName === eventName)
    if (matching.length === 0) {
      missing.push(eventName)
    } else if (!matching.some((item) => validCallableEventCorrelation(item, contractCase.apiName, eventName, identityPath))) {
      invalid.push(eventName)
    }
  }
  let coherentWindow = false
  if (missing.length === 0 && invalid.length === 0) {
    const firstEvent = expectedEvents[0]
    const firstIdentityPath = isRecord(contractCase.eventIdentityPaths)
      ? contractCase.eventIdentityPaths[firstEvent]
      : undefined
    const startingPoints = correlations.filter((item) => validCallableEventCorrelation(
      item,
      contractCase.apiName,
      firstEvent,
      firstIdentityPath,
    ))
    for (const startingPoint of startingPoints) {
      let previousSequence = startingPoint.eventSequence
      let coherent = true
      for (let index = 1; index < expectedEvents.length; index += 1) {
        const eventName = expectedEvents[index]
        const identityPath = isRecord(contractCase.eventIdentityPaths)
          ? contractCase.eventIdentityPaths[eventName]
          : undefined
        const match = correlations.find((item) => validCallableEventCorrelation(
          item,
          contractCase.apiName,
          eventName,
          identityPath,
        )
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

function producerAppliesToPlatform(producer, platform) {
  return isRecord(producer)
    && typeof producer.key === 'string'
    && producer.key.length > 0
    && typeof producer.suite === 'string'
    && producer.suite.length > 0
    && typeof producer.scenario === 'string'
    && producer.scenario.length > 0
    && Array.isArray(producer.platforms)
    && producer.platforms.length > 0
    && producer.platforms.includes(platform)
}

function validEpochProducer(producer, platform) {
  return isRecord(producer)
    && typeof producer.rule === 'string'
    && producer.rule.length > 0
    && producerAppliesToPlatform(producer.producer, platform)
}

function producerEvidenceMatches(item, producer) {
  if (producer == null) return true
  return isRecord(item)
    && typeof producer.key === 'string'
    && producer.key.length > 0
    && typeof producer.suite === 'string'
    && producer.suite.length > 0
    && typeof producer.scenario === 'string'
    && producer.scenario.length > 0
    && item.producerKey === producer.key
    && callableEvidenceSuite(item) === producer.suite
    && item.caseId === producer.scenario
}

function focusedCompatibilityCanonicalNegativeEvidenceMatches(item, contractCase, focusedSuites, platform) {
  if (!Array.isArray(contractCase.negativeProducers)) return false
  return contractCase.negativeProducers.some((declared) => isRecord(declared)
    && isRecord(declared.producer)
    && item.negativeProfile === declared.profile
    && harmonyCompatibilityRunsCanonicalNegativeProducer(declared.profile, declared.producer, focusedSuites, platform)
    && producerEvidenceMatches(item, declared.producer))
}

function callableEvidenceMatchesFocusedScope(item, name, contractCase, focusedSuites, platform) {
  if (callableEvidenceName(item) !== name) return false
  return focusedSuites == null
    || focusedSuites.has(callableEvidenceSuite(item))
    || focusedCompatibilityCanonicalNegativeEvidenceMatches(item, contractCase, focusedSuites, platform)
}

function negativeProfileEvidencePassed(candidates, profile, producer = null) {
  return candidates.some((item) => {
    if (!isSuccessfulEvidence(item)
      || item.invoked !== true
      || item.negativeValidated !== true
      || item.negativeProfile !== profile
      || !producerEvidenceMatches(item, producer)) return false
    if (item.resolved === false) return typeof item.errCode === 'number' && Number.isFinite(item.errCode)
    return item.resolved === true && itemAssertionPassed(item, 'negative', profile)
  })
}

function declaredNegativeProducers(contractCase, platform, requireProducerPlan = false) {
  if (Array.isArray(contractCase.negativeProducers) && contractCase.negativeProducers.length > 0) {
    return contractCase.negativeProducers.filter((item) => isRecord(item)
      && typeof item.profile === 'string'
      && isRecord(item.producer)
      && producerAppliesToPlatform(item.producer, platform))
  }
  if (requireProducerPlan) return []
  const profiles = Array.isArray(contractCase.negativeProfiles)
    ? contractCase.negativeProfiles.filter((profile) => typeof profile === 'string' && profile.length > 0)
    : []
  return profiles.map((profile) => ({ profile, producer: null }))
}

function negativeProducerProfileMismatch(contractCase) {
  if (!Array.isArray(contractCase.negativeProducers) || contractCase.negativeProducers.length === 0) return false
  const declared = Array.isArray(contractCase.negativeProfiles)
    ? contractCase.negativeProfiles.filter((profile) => typeof profile === 'string' && profile.length > 0)
    : []
  const producers = contractCase.negativeProducers
    .filter((item) => isRecord(item))
    .map((item) => item.profile)
    .filter((profile) => typeof profile === 'string' && profile.length > 0)
  return declared.length !== producers.length
    || new Set(declared).size !== declared.length
    || new Set(producers).size !== producers.length
    || declared.some((profile) => !producers.includes(profile))
    || producers.some((profile) => !declared.includes(profile))
}

function negativeEvidencePassed(candidates, disposition, contractCase, platform, requireProducerPlan = false) {
  const producers = declaredNegativeProducers(contractCase, platform, requireProducerPlan)
  const hasProducerPlan = Array.isArray(contractCase.negativeProducers) && contractCase.negativeProducers.length > 0
  if (requireProducerPlan && !hasProducerPlan) return false
  const declaredProfiles = Array.isArray(contractCase.negativeProfiles)
    ? contractCase.negativeProfiles.filter((profile) => typeof profile === 'string' && profile.length > 0)
    : []
  if (disposition === 'platform-unsupported') {
    const unsupportedProducers = producers.filter((item) => item.profile === 'platform-unsupported')
    return declaredProfiles.includes('platform-unsupported')
      && unsupportedProducers.length > 0
      && unsupportedProducers.every((item) => negativeProfileEvidencePassed(candidates, item.profile, item.producer))
  }
  if (!hasProducerPlan) {
    return producers.some((item) => negativeProfileEvidencePassed(candidates, item.profile, item.producer))
  }
  return producers.length > 0
    && producers.every((item) => negativeProfileEvidencePassed(candidates, item.profile, item.producer))
}

function requiredNegativeEvidenceResult(candidates, contractCase, platform, requireProducerPlan = false) {
  const producers = declaredNegativeProducers(contractCase, platform, requireProducerPlan)
  const hasProducerPlan = Array.isArray(contractCase.negativeProducers)
    && contractCase.negativeProducers.length > 0
  if ((requireProducerPlan && !hasProducerPlan) || (hasProducerPlan && producers.length === 0)) {
    return { passed: false, missing: [], undeclared: true }
  }
  const profiles = hasProducerPlan
    ? producers.map((item) => item.profile)
    : Array.isArray(contractCase.negativeProfiles)
      ? [...new Set(contractCase.negativeProfiles.filter((profile) => typeof profile === 'string' && profile.length > 0))]
      : []
  if (profiles.length === 0) return { passed: false, missing: [], undeclared: true }
  const missing = hasProducerPlan
    ? producers
      .filter((item) => !negativeProfileEvidencePassed(candidates, item.profile, item.producer))
      .map((item) => item.profile)
    : profiles.filter((profile) => !negativeProfileEvidencePassed(candidates, profile))
  return { passed: missing.length === 0, missing, undeclared: false }
}

function cleanupEvidencePassed(candidates, contractCase, platform, requireProducerPlan = false) {
  const action = typeof contractCase.cleanupAction === 'string' ? contractCase.cleanupAction : ''
  const requiredRule = typeof contractCase.cleanupRule === 'string' && contractCase.cleanupRule.length > 0
    ? contractCase.cleanupRule
    : null
  if (action.length === 0 || (requireProducerPlan && action === 'none')) return false
  const producer = isRecord(contractCase.cleanupProducer)
    && producerAppliesToPlatform(contractCase.cleanupProducer, platform)
    ? contractCase.cleanupProducer
    : null
  if ((requireProducerPlan && producer == null) || (isRecord(contractCase.cleanupProducer) && producer == null)) return false
  return candidates.some((item) => isSuccessfulEvidence(item)
    && item.invoked === true
    && item.resolved === true
    && item.cleanupValidated === true
    && item.cleanupAction === action
    && producerEvidenceMatches(item, producer)
    && itemAssertionPassed(item, 'cleanup', action, requiredRule))
}

function cleanupActionManifestIssue(contractCase, axes) {
  if (!axes.includes('cleanup')) return null
  const action = typeof contractCase.cleanupAction === 'string' ? contractCase.cleanupAction : ''
  if (action.length === 0) return 'cleanup cases must declare an action'
  if (action === 'none') return 'cleanup cases cannot use a no-op action'
  return null
}

function explicitProducerPlanIssues(contractCase, platform, kind, axes, explicit) {
  if (!explicit) return []
  const issues = []
  const identifier = kind === 'event' ? contractCase.eventName : contractCase.apiName
  const caseId = String(contractCase.caseId)
  if (axes.includes('negative') && declaredNegativeProducers(contractCase, platform, true).length === 0) {
    issues.push(issue(caseId, 'manifest', 'missing-negative-producer', `${identifier} requires a platform-scoped negative producer on ${platform}`))
  }
  if (axes.includes('negative') && negativeProducerProfileMismatch(contractCase)) {
    issues.push(issue(caseId, 'manifest', 'negative-producer-profile-mismatch', `${identifier} negative profiles must match its declared producer profiles`))
  }
  const cleanupAction = typeof contractCase.cleanupAction === 'string' ? contractCase.cleanupAction : ''
  if (axes.includes('cleanup')
    && cleanupAction.length > 0
    && cleanupAction !== 'none'
    && !isRecord(contractCase.cleanupProducer)) {
    issues.push(issue(caseId, 'manifest', 'missing-cleanup-producer', `${identifier} requires a platform-scoped cleanup producer on ${platform}`))
  } else if (axes.includes('cleanup')
    && cleanupAction.length > 0
    && cleanupAction !== 'none'
    && !producerAppliesToPlatform(contractCase.cleanupProducer, platform)) {
    issues.push(issue(caseId, 'manifest', 'invalid-cleanup-producer', `${identifier} cleanup producer is incomplete or out of scope for ${platform}`))
  }
  if (kind === 'event' && axes.includes('epoch') && !isRecord(contractCase.epochProducer)) {
    issues.push(issue(caseId, 'manifest', 'missing-epoch-producer', `${identifier} requires a platform-scoped epoch producer on ${platform}`))
  } else if (kind === 'event' && axes.includes('epoch') && !validEpochProducer(contractCase.epochProducer, platform)) {
    issues.push(issue(caseId, 'manifest', 'invalid-epoch-producer', `${identifier} epoch producer is incomplete or out of scope for ${platform}`))
  }
  return issues
}

function epochEvidencePassed(candidates, contractEvent, platform, requireProducerPlan = false) {
  const producer = isRecord(contractEvent.epochProducer) ? contractEvent.epochProducer : null
  if (producer == null) return requireProducerPlan ? false : axisPassed(candidates, 'epoch', 'event')
  if (!validEpochProducer(producer, platform)) return false
  return candidates.some((item) => !isSkipped(item)
    && item.epochValidated === true
    && item.epochProducerKey === producer.producer.key
    && item.epochRule === producer.rule
    && item.epochProducerSuite === producer.producer.suite
    && item.epochProducerScenario === producer.producer.scenario)
}

function platformValidationAxes(contractCase, platform) {
  const legacyAxes = Array.isArray(contractCase.validationAxes)
    ? contractCase.validationAxes.filter((axis) => typeof axis === 'string' && axis.length > 0)
    : []
  if (!Object.prototype.hasOwnProperty.call(contractCase, 'validationAxesByPlatform')) {
    return { axes: legacyAxes, explicit: false, valid: true }
  }
  const axesByPlatform = contractCase.validationAxesByPlatform
  if (!isRecord(axesByPlatform) || !Array.isArray(axesByPlatform[platform])) {
    return { axes: [], explicit: true, valid: false }
  }
  const axes = axesByPlatform[platform]
  if (!axes.every((axis) => typeof axis === 'string' && axis.length > 0)) {
    return { axes: [], explicit: true, valid: false }
  }
  return { axes, explicit: true, valid: true }
}

function platformAxesDispositionIssue(contractCase, disposition, axes, explicit) {
  if (!explicit) return null
  if (disposition === 'not-in-edition') {
    return axes.length === 0 ? null : 'not-in-edition cases cannot require validation axes'
  }
  if (disposition === 'capability-negative' || disposition === 'platform-unsupported') {
    return axes.length === 1 && axes[0] === 'negative'
      ? null
      : `${disposition} cases must require only the negative axis`
  }
  if (disposition === 'required') {
    return axes.length > 0 ? null : 'required cases must require at least one validation axis'
  }
  return null
}

function knownIssueDeclarationIssues(contractCase, platform, kind, requiredAxes) {
  if (!isRecord(contractCase.approvedKnownIssue)
    || !Object.prototype.hasOwnProperty.call(contractCase.approvedKnownIssue, platform)) return []
  const declared = contractCase.approvedKnownIssue[platform]
  if (!isRecord(declared)
    || typeof declared.code !== 'string'
    || declared.code.length === 0
    || !Array.isArray(declared.waivedAxes)
    || declared.waivedAxes.length === 0) {
    return [issue(String(contractCase.caseId), 'known-issue', 'malformed-known-issue-waiver', `${kind} known-issue waiver on ${platform} must declare a code and at least one waived axis`)]
  }
  const invalidAxes = declared.waivedAxes.filter((axis) => typeof axis !== 'string'
    || !requiredAxes.includes(axis)
    || nonWaivableValidationAxes.has(axis))
  if (invalidAxes.length === 0) return []
  return [issue(
    String(contractCase.caseId),
    'known-issue',
    'invalid-known-issue-waiver-axis',
    `${kind} known-issue waiver on ${platform} cannot waive undeclared, negative, or cleanup axes: ${invalidAxes.map(String).join(', ')}`,
  )]
}

function manifestEntryIssues(contractCase, disposition, platform, kind, platformAxes) {
  const issues = []
  if (!platformAxes.valid) {
    const identifier = kind === 'event' ? contractCase.eventName : contractCase.apiName
    issues.push(issue(String(contractCase.caseId), 'manifest', 'malformed-validation-axes-by-platform', `${identifier} has no valid ${platform} validation axis map`))
  }
  const dispositionAxesIssue = platformAxesDispositionIssue(contractCase, disposition, platformAxes.axes, platformAxes.explicit)
  if (dispositionAxesIssue != null) {
    const identifier = kind === 'event' ? contractCase.eventName : contractCase.apiName
    issues.push(issue(String(contractCase.caseId), 'manifest', 'invalid-platform-validation-axes', `${identifier} ${dispositionAxesIssue}`))
  }
  // schema-v2 manifests represented "no cleanup required" as an explicit
  // cleanup axis with cleanupAction: "none".  The producer-aware schema-v3
  // contract intentionally forbids that no-op declaration, but legacy report
  // verification must retain its historical semantics.
  const cleanupActionIssue = platformAxes.explicit
    ? cleanupActionManifestIssue(contractCase, platformAxes.axes)
    : null
  if (cleanupActionIssue != null) {
    const identifier = kind === 'event' ? contractCase.eventName : contractCase.apiName
    issues.push(issue(String(contractCase.caseId), 'manifest', 'invalid-cleanup-action', `${identifier} ${cleanupActionIssue}`))
  }
  issues.push(...explicitProducerPlanIssues(contractCase, platform, kind, platformAxes.axes, platformAxes.explicit))
  issues.push(...knownIssueDeclarationIssues(contractCase, platform, kind, platformAxes.axes))
  return issues
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
  const expectedSuiteFilter = !fullRun && typeof input.expectedSuiteFilter === 'string'
    ? input.expectedSuiteFilter.trim()
    : ''
  const reportCases = Array.isArray(report.cases) ? report.cases.filter(isRecord) : []
  const reportEvents = Array.isArray(report.events) ? report.events.filter(isRecord) : []
  const rawReportExecutedSuites = report.executedSuites
  const reportExecutedSuites = Array.isArray(rawReportExecutedSuites)
    ? rawReportExecutedSuites.filter((item) => typeof item === 'string' && item.length > 0)
    : []
  const reportSuiteFilter = !fullRun && typeof report.suiteFilter === 'string'
    ? report.suiteFilter.trim()
    : ''
  const focusedSuite = expectedSuiteFilter.length > 0
    ? expectedSuiteFilter
    : reportSuiteFilter
  const focusedSuiteAuthorityMatches = expectedSuiteFilter.length === 0
    || (report.suiteFilter === expectedSuiteFilter
      && Array.isArray(rawReportExecutedSuites)
      && rawReportExecutedSuites.length === 1
      && rawReportExecutedSuites[0] === expectedSuiteFilter)
  const filteredSuiteGroups = !fullRun && expectedSuiteFilter.length > 0
    ? new Set([expectedSuiteFilter])
    : !fullRun && reportSuiteFilter.length > 0 && Array.isArray(report.executedSuites)
      ? new Set(reportExecutedSuites)
      : null
  const issues = []
  if (!focusedSuiteAuthorityMatches) {
    issues.push(issue(
      'runtime-summary',
      'suite',
      'focused-suite-authority-mismatch',
      'focused report suite metadata did not match the runner authority',
    ))
  }
  const knownIssueWaivers = []
  let checkedCallables = 0
  let passedCallables = 0
  let acceptedCallables = 0
  let checkedEvents = 0
  let passedEvents = 0
  let acceptedEvents = 0

  for (const contractCase of manifest.callables) {
    if (!isRecord(contractCase) || typeof contractCase.apiName !== 'string') {
      throw new Error('Malformed callable entry in test disposition manifest')
    }
    const disposition = isRecord(contractCase.platforms) ? contractCase.platforms[platform] : undefined
    const platformAxes = platformValidationAxes(contractCase, platform)
    const manifestIssues = manifestEntryIssues(contractCase, disposition, platform, 'callable', platformAxes)
    if (disposition === 'not-in-edition') {
      issues.push(...manifestIssues)
      continue
    }
    const candidates = reportCases.filter((item) => callableEvidenceMatchesFocusedScope(
      item,
      contractCase.apiName,
      contractCase,
      filteredSuiteGroups,
      platform,
    ))
    const axes = platformAxes.axes.filter((axis) => focusedRunIncludesCallableAxis(
      fullRun,
      focusedSuite,
      filteredSuiteGroups,
      contractCase,
      candidates,
      platform,
      axis,
    ))
    if (!fullRun && axes.length === 0) {
      if (manifestIssues.length > 0) {
        checkedCallables += 1
        issues.push(...manifestIssues)
      }
      continue
    }
    const focusedProducerRequiresCallable = !fullRun
      && platformAxes.axes.some((axis) => focusedRunIncludesPlannedCallableAxis(
        filteredSuiteGroups,
        contractCase,
        platform,
        axis,
      ))
    if (!fullRun && candidates.length === 0
      && !focusedRunRequiresCallable(fullRun, focusedSuite, contractCase.apiName)
      && !focusedProducerRequiresCallable) {
      if (manifestIssues.length > 0) {
        checkedCallables += 1
        issues.push(...manifestIssues)
      }
      continue
    }
    checkedCallables += 1
    const before = issues.length
    const waiversBefore = knownIssueWaivers.length
    issues.push(...manifestIssues)
    if (disposition === 'capability-negative' || disposition === 'platform-unsupported') {
      if (!negativeEvidencePassed(candidates, disposition, contractCase, platform, platformAxes.explicit)) {
        issues.push(issue(
          String(contractCase.caseId),
          'negative',
          'missing-negative-evidence',
          `${contractCase.apiName} must execute and validate its ${disposition} error contract; skip is not evidence`,
        ))
      }
    } else if (disposition === 'required') {
      const approvedKnownIssueCandidates = candidates.filter((item) => approvedKnownIssueMatches(item, contractCase, platform))
      const evidenceCandidates = approvedKnownIssueCandidates.length > 0 ? approvedKnownIssueCandidates : candidates
      for (const axis of axes) {
        if (!focusedRunIncludesCallableAxis(fullRun, focusedSuite, filteredSuiteGroups, contractCase, candidates, platform, axis)) {
          continue
        }
        if (axis === 'negative') {
          const negative = requiredNegativeEvidenceResult(candidates, contractCase, platform, platformAxes.explicit)
          if (!negative.passed) {
            issues.push(issue(
              String(contractCase.caseId),
              'negative',
              negative.undeclared ? 'negative-profiles-undeclared' : 'missing-negative-profile-evidence',
              negative.undeclared
                ? `${contractCase.apiName} has no declared negative profiles`
                : `${contractCase.apiName} has no passing evidence for negative profiles: ${negative.missing.join(', ')}`,
            ))
          }
          continue
        }
        if (axis === 'cleanup') {
          if (!cleanupEvidencePassed(candidates, contractCase, platform, platformAxes.explicit)) {
            issues.push(issue(
              String(contractCase.caseId),
              'cleanup',
              'missing-cleanup-evidence',
              `${contractCase.apiName} has no passing cleanup evidence for generated action ${String(contractCase.cleanupAction)}`,
            ))
          }
          continue
        }
        if (axisWaivedByApprovedKnownIssue(evidenceCandidates, contractCase, platform, axis)) {
          knownIssueWaivers.push(callableKnownIssueWaiver(contractCase, platform, axis))
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
          const correlation = callableEventCorrelationResult(
            evidenceCandidates,
            contractCase,
            effectiveCallableExpectedEvents(fullRun, focusedSuite, platform, contractCase),
          )
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
      acceptedCallables += 1
    }
    if (issues.length === before && knownIssueWaivers.length === waiversBefore) {
      passedCallables += 1
    }
  }

  for (const contractEvent of manifest.events) {
    if (!isRecord(contractEvent) || typeof contractEvent.eventName !== 'string') {
      throw new Error('Malformed event entry in test disposition manifest')
    }
    const disposition = isRecord(contractEvent.platforms) ? contractEvent.platforms[platform] : undefined
    const platformAxes = platformValidationAxes(contractEvent, platform)
    const manifestIssues = manifestEntryIssues(contractEvent, disposition, platform, 'event', platformAxes)
    if (disposition === 'not-in-edition') {
      issues.push(...manifestIssues)
      continue
    }
    const requiresNegativeEvidence = disposition === 'platform-unsupported' || disposition === 'capability-negative'
    const axes = platformAxes.axes.filter((axis) => focusedRunIncludesEventAxis(
      fullRun,
      focusedSuite,
      filteredSuiteGroups,
      contractEvent,
      platform,
      axis,
    ))
    if (!fullRun && axes.length === 0) {
      if (manifestIssues.length > 0) {
        checkedEvents += 1
        issues.push(...manifestIssues)
      }
      continue
    }
    const caseCandidates = reportCases.filter((item) => callableEvidenceMatchesFocusedScope(
      item,
      contractEvent.eventName,
      contractEvent,
      filteredSuiteGroups,
      platform,
    ))
    const eventCandidates = reportEvents.filter((item) => eventEvidenceName(item) === contractEvent.eventName)
    const candidates = requiresNegativeEvidence ? caseCandidates : eventCandidates
    const allCandidates = [...eventCandidates, ...caseCandidates]
    const plannedFocusedEvent = !fullRun
      && filteredSuiteGroups != null
      && !filteredSuiteGroups.has('event-delivery')
      && axes.length > 0
    const focusedEventRequiresEvidence = !fullRun
      && focusedRunRequiresEvent(fullRun, focusedSuite, platform, contractEvent.eventName)
      && axes.length > 0
    if (!fullRun && allCandidates.length === 0 && !plannedFocusedEvent && !focusedEventRequiresEvidence) {
      if (manifestIssues.length > 0) {
        checkedEvents += 1
        issues.push(...manifestIssues)
      }
      continue
    }
    const unobservedPassiveEvent = !requiresNegativeEvidence
      && !focusedEventRequiresEvidence
      && contractEvent.deliveryDisposition === 'passive-only'
      && candidates.every((item) => !eventEvidenceObserved(item))
    const validationAxes = unobservedPassiveEvent && platformAxes.explicit
      ? axes.filter((axis) => axis === 'negative' || axis === 'cleanup' || axis === 'epoch')
      : unobservedPassiveEvent
        ? []
        : axes
    if (unobservedPassiveEvent && validationAxes.length === 0) {
      if (manifestIssues.length > 0) {
        checkedEvents += 1
        issues.push(...manifestIssues)
      }
      continue
    }
    checkedEvents += 1
    const before = issues.length
    const waiversBefore = knownIssueWaivers.length
    issues.push(...manifestIssues)
    if (disposition === 'platform-unsupported') {
      if (!negativeEvidencePassed(candidates, disposition, contractEvent, platform, platformAxes.explicit)) {
        issues.push(issue(
          String(contractEvent.caseId),
          'negative',
          'missing-negative-evidence',
          `${contractEvent.eventName} must validate its platform-unsupported event contract; skip is not evidence`,
        ))
      }
    } else if (disposition === 'required') {
      for (const axis of validationAxes) {
        if (axis === 'negative') {
          const negative = requiredNegativeEvidenceResult(caseCandidates, contractEvent, platform, platformAxes.explicit)
          if (!negative.passed) {
            issues.push(issue(
              String(contractEvent.caseId),
              'negative',
              negative.undeclared ? 'negative-profiles-undeclared' : 'missing-negative-profile-evidence',
              negative.undeclared
                ? `${contractEvent.eventName} has no declared negative profiles`
                : `${contractEvent.eventName} has no passing evidence for negative profiles: ${negative.missing.join(', ')}`,
            ))
          }
          continue
        }
        if (axis === 'cleanup') {
          if (!cleanupEvidencePassed(allCandidates, contractEvent, platform, platformAxes.explicit)) {
            issues.push(issue(
              String(contractEvent.caseId),
              'cleanup',
              'missing-cleanup-evidence',
              `${contractEvent.eventName} has no passing cleanup evidence for generated action ${String(contractEvent.cleanupAction)}`,
            ))
          }
          continue
        }
        if (axis === 'structure' && isRecord(input.responseSchemas)) {
          const structure = eventStructureResult(candidates, contractEvent.eventName, input.responseSchemas)
          if (!structure.passed) {
            const waiver = approvedEventKnownIssueWaiver(reportCases, manifest, contractEvent, platform, axis)
            if (waiver != null) {
              knownIssueWaivers.push(waiver)
            } else {
              const schemaDetail = structure.issues.slice(0, 3).map((item) => `${item.path} ${item.rule}: expected ${item.expected}, got ${item.actual}`).join('; ')
              issues.push(issue(
                String(contractEvent.caseId),
                'structure',
                structure.issues.length === 0 ? (candidates.length === 0 ? 'missing-evidence' : 'axis-not-validated') : 'event-schema-invalid',
                schemaDetail.length > 0 ? `${contractEvent.eventName} payload failed generated schema: ${schemaDetail}` : `${contractEvent.eventName} has no explicit payload evidence on ${platform}`,
              ))
            }
          }
          continue
        }
        if (axis === 'epoch' && !epochEvidencePassed(candidates, contractEvent, platform, platformAxes.explicit)) {
          const waiver = approvedEventKnownIssueWaiver(reportCases, manifest, contractEvent, platform, axis)
          if (waiver != null) {
            knownIssueWaivers.push(waiver)
          } else {
            issues.push(issue(
              String(contractEvent.caseId),
              'epoch',
              candidates.length === 0 ? 'missing-evidence' : 'epoch-producer-invalid',
              `${contractEvent.eventName} has no passing epoch evidence from its generated producer on ${platform}`,
            ))
          }
          continue
        }
        if (!axisPassed(candidates, axis, 'event')) {
          const waiver = approvedEventKnownIssueWaiver(reportCases, manifest, contractEvent, platform, axis)
          if (waiver != null) {
            knownIssueWaivers.push(waiver)
          } else {
            issues.push(issue(
              String(contractEvent.caseId),
              String(axis),
              candidates.length === 0 ? 'missing-evidence' : 'axis-not-validated',
              `${contractEvent.eventName} has no passing ${String(axis)} evidence on ${platform}`,
            ))
          }
        }
      }
    } else if (disposition === 'capability-negative') {
      if (!negativeEvidencePassed(candidates, disposition, contractEvent, platform, platformAxes.explicit)) {
        issues.push(issue(String(contractEvent.caseId), 'negative', 'missing-negative-evidence', `${contractEvent.eventName} has no executable capability-negative evidence`))
      }
    } else {
      issues.push(issue(String(contractEvent.caseId), 'disposition', 'unknown-platform-disposition', String(disposition)))
    }
    if (issues.length === before) {
      acceptedEvents += 1
    }
    if (issues.length === before && knownIssueWaivers.length === waiversBefore) {
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
    acceptedCallables,
    checkedEvents,
    passedEvents,
    acceptedEvents,
    passed: issues.length === 0,
    strictPassed: issues.length === 0 && knownIssueWaivers.length === 0,
    knownIssueWaivers,
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
