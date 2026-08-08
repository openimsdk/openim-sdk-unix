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
