import type { ContractDocument } from './model.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export interface HarmonyEventBindingInventory {
  events: Array<{ name: string; value: number }>
  nativeEventAliases: Record<string, string>
}

export function renderHarmonyPlatformDriver(
  contract: ContractDocument,
  inventory: HarmonyEventBindingInventory,
): string {
  const callables = new Map(contract.callables.map((callable) => [callable.name, callable]))
  const nativeEvents = new Set(inventory.events.map((event) => event.name))
  const events = contract.events.flatMap((event) => {
    const callable = callables.get(event.callable)
    assert(callable != null, `Harmony event callable is missing: ${event.callable}`)
    if (event.binding.harmony === 'unsupported-by-native-abi' || event.binding.harmony === 'projected') {
      return []
    }
    assert(event.name.startsWith('on'), `Harmony public event does not follow the on* naming convention: ${event.name}`)
    const nativeEventName = inventory.nativeEventAliases[event.name] ?? `EventOn${event.name.slice(2)}`
    assert(nativeEvents.has(nativeEventName), `Harmony ABI lacks native event ${nativeEventName} for ${event.name}`)
    return [{ publicEventName: event.name, nativeEventName, decoderKind: event.decoder.kind }]
  })
  const nativeEventNames = [...new Set(events.map((event) => event.nativeEventName))]
  const bindings = nativeEventNames.map((nativeEventName) => {
    const publicNames = events
      .filter((event) => event.nativeEventName === nativeEventName)
      .map((event) => event.decoderKind === 'native-error'
        ? `      activeEventSink('${event.publicEventName}', payloadJSON, readDriverEventErrorCode(payloadJSON), readDriverEventErrorMessage(payloadJSON))`
        : `      activeEventSink('${event.publicEventName}', payloadJSON, 0, '')`)
      .join('\n')
    return `  OpenIMHarmonyDriver.onEvent(harmonyEventCode('${nativeEventName}'), (payloadJSON : string) : void => {\n${publicNames}\n  })`
  }).join('\n')
  return `import { OpenIMHarmonyDriver } from './OpenIMHarmonyDriver.ets'
import { NativeJSONValue, readNativeValue } from '../common/native-call-common.uts'
import { harmonyEventCode } from './harmony-operation-codes.uts'

type OpenIMDriverEventSink = (eventName : string, payload : string, errCode : number, errMsg : string) => void

let eventSinkBound : boolean = false
let activeEventSink : OpenIMDriverEventSink = (_eventName : string, _payload : string, _errCode : number, _errMsg : string) : void => {}

function parseDriverErrorText(text : string) : UTSJSONObject | null {
  try {
    return JSON.parseObject<UTSJSONObject>(text)
  } catch (error) {
    return null
  }
}

function parseDriverErrorPayload(reason : Object | null) : UTSJSONObject | null {
  if (reason == null) { return null }
  const text : string | null = JSON.stringify(reason)
  return text != null ? parseDriverErrorText(text as string) : null
}

function readDriverPayloadErrorCode(payload : UTSJSONObject | null) : number {
  if (payload != null) {
    const raw : NativeJSONValue | null = readNativeValue(payload, 'errCode')
    if (raw != null && typeof raw == 'number') {
      const code : number = raw as number
      if (Number.isFinite(code)) { return code }
    }
  }
  return -1
}

function readDriverPayloadErrorMessage(payload : UTSJSONObject | null) : string | null {
  if (payload != null) {
    const raw : NativeJSONValue | null = readNativeValue(payload, 'errMsg')
    if (raw != null && typeof raw == 'string') { return raw as string }
  }
  return null
}

function readDriverErrorCode(reason : Object | null) : number {
  return readDriverPayloadErrorCode(parseDriverErrorPayload(reason))
}

function readDriverErrorMessage(reason : Object | null) : string {
  if (reason == null) { return 'Harmony native call failed' }
  const payloadMessage : string | null = readDriverPayloadErrorMessage(parseDriverErrorPayload(reason))
  if (payloadMessage != null) { return payloadMessage }
  if (reason instanceof Error) { return reason.message }
  const text : string | null = JSON.stringify(reason)
  return text != null ? text as string : 'Harmony native call failed'
}

function readDriverEventErrorCode(payloadJSON : string) : number {
  return readDriverPayloadErrorCode(parseDriverErrorText(payloadJSON))
}

function readDriverEventErrorMessage(payloadJSON : string) : string {
  const message : string | null = readDriverPayloadErrorMessage(parseDriverErrorText(payloadJSON))
  return message != null ? message : ''
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
  }).catch((reason : Object | null) : void => {
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
