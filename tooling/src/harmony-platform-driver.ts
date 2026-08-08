import type { ContractDocument } from './model.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function harmonyNativeEventName(declaration: string): string | null {
  return /harmonyEventCode\('([^']+)'\)/.exec(declaration)?.[1] ?? null
}

export function renderHarmonyPlatformDriver(
  contract: ContractDocument,
  projectedDeclarations: ReadonlyMap<string, string>,
): string {
  const callables = new Map(contract.callables.map((callable) => [callable.name, callable]))
  const events = contract.events.flatMap((event) => {
    const callable = callables.get(event.callable)
    assert(callable != null, `Harmony event callable is missing: ${event.callable}`)
    const declaration = projectedDeclarations.get(callable.name) ?? callable.declaration.harmony ?? ''
    const nativeEventName = harmonyNativeEventName(declaration)
    if (nativeEventName == null) {
      assert(event.binding.harmony === 'unsupported-by-native-abi', `Harmony event lacks native binding: ${event.name}`)
      return []
    }
    return [{ publicEventName: event.name, nativeEventName }]
  })
  const nativeEventNames = [...new Set(events.map((event) => event.nativeEventName))]
  const bindings = nativeEventNames.map((nativeEventName) => {
    const publicNames = events
      .filter((event) => event.nativeEventName === nativeEventName)
      .map((event) => `      activeEventSink('${event.publicEventName}', payloadJSON, 0, '')`)
      .join('\n')
    return `  OpenIMHarmonyDriver.onEvent(harmonyEventCode('${nativeEventName}'), (payloadJSON : string) : void => {\n${publicNames}\n  })`
  }).join('\n')
  return `import { OpenIMHarmonyDriver } from './OpenIMHarmonyDriver.ets'
import { harmonyEventCode } from './harmony-operation-codes.uts'

type OpenIMDriverEventSink = (eventName : string, payload : string, errCode : number, errMsg : string) => void

let eventSinkBound : boolean = false
let activeEventSink : OpenIMDriverEventSink = (_eventName : string, _payload : string, _errCode : number, _errMsg : string) : void => {}

function readDriverErrorCode(reason : ESObject | null) : number {
  if (reason != null && reason.errCode != null) { return reason.errCode as number }
  return -1
}

function readDriverErrorMessage(reason : ESObject | null) : string {
  if (reason == null) { return 'Harmony native call failed' }
  if (reason.errMsg != null) { return reason.errMsg as string }
  if (reason instanceof Error) { return reason.message }
  const text = JSON.stringify(reason)
  return text != null ? text as string : 'Harmony native call failed'
}

export function driverCallAsync(
  callableID : number,
  operationID : string,
  requestJSON : string,
  resolve : (data : string) => void,
  reject : (errCode : number, errMsg : string) => void
) : void {
  OpenIMHarmonyDriver.callAsync(callableID, operationID, requestJSON).then((data : string) : void => {
    resolve(data)
  }).catch((reason : ESObject | null) : void => {
    reject(readDriverErrorCode(reason), readDriverErrorMessage(reason))
  })
}

export function driverCallSync(callableID : number, operationID : string, requestJSON : string) : string {
  return OpenIMHarmonyDriver.callSync(callableID, operationID, requestJSON)
}

export function driverBindEventSink(sink : OpenIMDriverEventSink) : void {
  activeEventSink = sink
  if (eventSinkBound) { return }
  eventSinkBound = true
${bindings}
}
`
}
