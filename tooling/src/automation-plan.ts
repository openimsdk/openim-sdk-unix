import type {
  AutomationCallableTestPlan,
  AutomationEventTestPlan,
  AutomationTestPlan,
} from './model.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function indexPlanEntries<T>(
  entries: readonly T[],
  keyOf: (entry: T) => string,
  label: string,
): Map<string, T> {
  const result = new Map<string, T>()
  for (const entry of entries) {
    const key = keyOf(entry)
    assert(!result.has(key), `Duplicate automation ${label} plan target: ${key}`)
    result.set(key, entry)
  }
  return result
}

function mergePlanEntries<T>(
  base: readonly T[],
  delta: readonly T[],
  keyOf: (entry: T) => string,
  label: string,
  overlay: (baseEntry: T, deltaEntry: T) => T,
): T[] {
  const baseByTarget = indexPlanEntries(base, keyOf, label)
  const deltaByTarget = indexPlanEntries(delta, keyOf, label)
  const merged = base.map((baseEntry) => {
    const deltaEntry = deltaByTarget.get(keyOf(baseEntry))
    return deltaEntry == null ? baseEntry : overlay(baseEntry, deltaEntry)
  })
  for (const deltaEntry of delta) {
    if (!baseByTarget.has(keyOf(deltaEntry))) merged.push(deltaEntry)
  }
  return merged
}

function mergeCallablePlan(
  base: AutomationCallableTestPlan,
  delta: AutomationCallableTestPlan,
): AutomationCallableTestPlan {
  if (base.capabilityByPlatform == null && delta.capabilityByPlatform == null) return { ...base, ...delta }
  return {
    ...base,
    ...delta,
    capabilityByPlatform: {
      ...(base.capabilityByPlatform ?? {}),
      ...(delta.capabilityByPlatform ?? {}),
    },
  }
}

export function composeAutomationTestPlan(
  base: AutomationTestPlan | undefined,
  delta: AutomationTestPlan | undefined,
): AutomationTestPlan | undefined {
  if (base == null) return delta == null ? undefined : structuredClone(delta)
  if (delta == null) return structuredClone(base)
  assert(base.schemaVersion === delta.schemaVersion, 'Enterprise automation test plan schema version changed')
  return structuredClone({
    schemaVersion: base.schemaVersion,
    callables: mergePlanEntries(
      base.callables,
      delta.callables,
      (entry) => entry.apiName,
      'callable',
      mergeCallablePlan,
    ),
    events: mergePlanEntries<AutomationEventTestPlan>(
      base.events,
      delta.events,
      (entry) => entry.eventName,
      'event',
      (baseEntry, deltaEntry) => ({ ...baseEntry, ...deltaEntry }),
    ),
  })
}
