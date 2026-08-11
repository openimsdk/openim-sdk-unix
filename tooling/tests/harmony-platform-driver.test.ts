import assert from 'node:assert/strict'
import test from 'node:test'
import ts from 'typescript'
import type { ContractDocument } from '../src/model.js'
import { renderHarmonyPlatformDriver } from '../src/harmony-platform-driver.js'

function evaluateErrorReaders(source: string, reason: object, eventPayloadJSON: string): {
  callCode: number
  callMessage: string
  eventCode: number
  eventMessage: string
} {
  const executableSource = source
    .replace(/^import .*$/gm, '')
    .replaceAll('export function', 'function')
  const javascript = ts.transpile(executableSource, {
    module: ts.ModuleKind.None,
    target: ts.ScriptTarget.ES2020,
  })
  const run = new Function(
    'reason',
    'eventPayloadJSON',
    'OpenIMHarmonyDriver',
    'readNativeValue',
    'harmonyEventCode',
    'JSON',
    `${javascript}\nreturn {\n  callCode: readDriverErrorCode(reason),\n  callMessage: readDriverErrorMessage(reason),\n  eventCode: readDriverEventErrorCode(eventPayloadJSON),\n  eventMessage: readDriverEventErrorMessage(eventPayloadJSON)\n}`,
  ) as (...args: unknown[]) => { callCode: number; callMessage: string; eventCode: number; eventMessage: string }
  const jsonRuntime = {
    stringify: (value: unknown): string | null => JSON.stringify(value) ?? null,
    parseObject: (text: string): object | null => {
      const value = JSON.parse(text) as unknown
      return value != null && typeof value === 'object' && !Array.isArray(value) ? value : null
    },
  }
  return run(
    reason,
    eventPayloadJSON,
    {},
    (value: Record<string, unknown>, key: string): unknown => value[key] ?? null,
    (): number => -1,
    jsonRuntime,
  )
}

function eventContract(): ContractDocument {
  return {
    schemaVersion: 2,
    edition: 'enterprise',
    origin: {
      kind: 'imported-facade',
      repository: 'private', revision: 'test', interfacePath: 'interface.uts',
      facadePaths: { android: 'android', ios: 'ios', harmony: 'harmony' },
    },
    expected: { constants: 0, types: 0, callables: 4, events: 4 },
    constants: [],
    types: [],
    callables: [
      {
        id: 2003, name: 'onConnecting', signature: 'onConnecting(handler:Handler):Subscription',
        completion: 'sync', responseCodec: 'void', errorPolicy: 'none', rawString: false,
        role: 'event-subscription', testProfile: { semanticProfile: 'subscription-lifecycle', sideEffectProbe: 'registry-observation' }, declaration: { android: '', ios: '', harmony: "export function onConnecting(handler : Handler) : Subscription { return onVoidHarmonyEvent('onConnecting', handler) }" },
        binding: { android: { kind: 'none', symbol: '' }, ios: { kind: 'none', symbol: '' }, harmony: { kind: 'none', symbol: '' } },
        signatureHash: '',
      },
      {
        id: 2004, name: 'onMsgDeleted', signature: 'onMsgDeleted(handler:Handler):Subscription',
        completion: 'sync', responseCodec: 'void', errorPolicy: 'none', rawString: false,
        role: 'event-subscription', testProfile: { semanticProfile: 'subscription-lifecycle', sideEffectProbe: 'registry-observation' }, declaration: { android: '', ios: '', harmony: "export function onMsgDeleted(handler : Handler) : Subscription { return onVoidHarmonyEvent('onMsgDeleted', handler) }" },
        binding: { android: { kind: 'none', symbol: '' }, ios: { kind: 'none', symbol: '' }, harmony: { kind: 'none', symbol: '' } },
        signatureHash: '',
      },
      {
        id: 2005, name: 'onConnectFailed', signature: 'onConnectFailed(handler:Handler):Subscription',
        completion: 'sync', responseCodec: 'void', errorPolicy: 'none', rawString: false,
        role: 'event-subscription', testProfile: { semanticProfile: 'subscription-lifecycle', sideEffectProbe: 'registry-observation' }, declaration: { android: '', ios: '', harmony: "export function onConnectFailed(handler : Handler) : Subscription { return onErrorHarmonyEvent('onConnectFailed', handler) }" },
        binding: { android: { kind: 'none', symbol: '' }, ios: { kind: 'none', symbol: '' }, harmony: { kind: 'none', symbol: '' } },
        signatureHash: '',
      },
      {
        id: 2006, name: 'onEditionStateChanged', signature: 'onEditionStateChanged(handler:Handler):Subscription',
        completion: 'sync', responseCodec: 'void', errorPolicy: 'none', rawString: false,
        role: 'event-subscription', testProfile: { semanticProfile: 'subscription-lifecycle', sideEffectProbe: 'registry-observation' }, declaration: { android: '', ios: '', harmony: '' },
        binding: { android: { kind: 'facade-alias', symbol: 'registerEditionState' }, ios: { kind: 'facade-alias', symbol: 'registerEditionState' }, harmony: { kind: 'facade-alias', symbol: 'registerEditionState' } },
        signatureHash: '',
      },
    ],
    events: [
      {
        id: 3001, name: 'onConnecting', callable: 'onConnecting', handlerType: 'Handler',
        decoder: { kind: 'void' }, rawPayload: false,
        binding: { android: 'bound', ios: 'bound', harmony: 'bound' }, signatureHash: '',
      },
      {
        id: 3002, name: 'onMsgDeleted', callable: 'onMsgDeleted', handlerType: 'Handler',
        decoder: { kind: 'void' }, rawPayload: false,
        binding: { android: 'bound', ios: 'bound', harmony: 'bound' }, signatureHash: '',
      },
      {
        id: 3003, name: 'onConnectFailed', callable: 'onConnectFailed', handlerType: 'Handler',
        decoder: { kind: 'native-error' }, rawPayload: false,
        binding: { android: 'bound', ios: 'bound', harmony: 'bound' }, signatureHash: '',
      },
      {
        id: 3004, name: 'onEditionStateChanged', callable: 'onEditionStateChanged', handlerType: 'Handler',
        decoder: { kind: 'parser', symbol: 'parseEditionState' }, rawPayload: false,
        binding: { android: 'projected', ios: 'projected', harmony: 'projected' }, signatureHash: '',
      },
    ],
  }
}

test('Harmony PlatformDriver derives native events from ABI inventory rather than façade bodies', () => {
  const source = renderHarmonyPlatformDriver(eventContract(), {
    events: [
      { name: 'EventOnConnecting', value: 1001 },
      { name: 'EventOnMessageDeleted', value: 1002 },
      { name: 'EventOnConnectFailed', value: 1003 },
    ],
    nativeEventAliases: { onMsgDeleted: 'EventOnMessageDeleted' },
  })
  assert.match(source, /harmonyEventCode\('EventOnConnecting'\)/)
  assert.match(source, /harmonyEventCode\('EventOnMessageDeleted'\)/)
  assert.match(source, /activeEventSink\('onConnecting'/)
  assert.match(source, /activeEventSink\('onMsgDeleted'/)
  assert.match(source, /activeEventSink\('onConnecting', payloadJSON, 0, ''\)/)
  assert.match(source, /activeEventSink\('onConnectFailed', payloadJSON, readDriverEventErrorCode\(payloadJSON\), readDriverEventErrorMessage\(payloadJSON\)\)/)
  assert.doesNotMatch(source, /EventOnEditionStateChanged/)
  assert.doesNotMatch(source, /onVoidHarmonyEvent/)
})

test('Harmony PlatformDriver preserves typed native failures across calls and event envelopes', () => {
  const source = renderHarmonyPlatformDriver(eventContract(), {
    events: [
      { name: 'EventOnConnecting', value: 1001 },
      { name: 'EventOnMessageDeleted', value: 1002 },
      { name: 'EventOnConnectFailed', value: 1003 },
    ],
    nativeEventAliases: { onMsgDeleted: 'EventOnMessageDeleted' },
  })
  assert.match(source, /function parseDriverErrorPayload\(reason : Object \| null\)/)
  assert.doesNotMatch(source, /reason instanceof Error\) \{ return null \}/)
  assert.match(source, /typeof raw == 'number'/)
  assert.match(source, /typeof raw == 'string'/)
  assert.match(source, /if \(reason instanceof Error\) \{ return reason\.message \}/)
  assert.match(source, /function readDriverEventErrorCode\(payloadJSON : string\)/)
  assert.match(source, /function readDriverEventErrorMessage\(payloadJSON : string\)/)
  assert.match(source, /const text : string \| null = JSON\.stringify\(reason\)/)
})

test('Harmony PlatformDriver reads custom Error fields and validates serialized event fields', () => {
  class NativeError extends Error {
    errCode: number
    errMsg: string

    constructor(errCode: number, errMsg: string) {
      super(errMsg)
      this.errCode = errCode
      this.errMsg = errMsg
    }
  }
  const source = renderHarmonyPlatformDriver(eventContract(), {
    events: [
      { name: 'EventOnConnecting', value: 1001 },
      { name: 'EventOnMessageDeleted', value: 1002 },
      { name: 'EventOnConnectFailed', value: 1003 },
    ],
    nativeEventAliases: { onMsgDeleted: 'EventOnMessageDeleted' },
  })
  assert.deepEqual(
    evaluateErrorReaders(source, new NativeError(1080, 'speech unavailable'), '{"errCode":10007,"errMsg":"function not found"}'),
    { callCode: 1080, callMessage: 'speech unavailable', eventCode: 10007, eventMessage: 'function not found' },
  )
  assert.deepEqual(
    evaluateErrorReaders(source, { errCode: '1080', errMsg: 7 }, '{"errCode":"10007","errMsg":7}'),
    { callCode: -1, callMessage: '{"errCode":"1080","errMsg":7}', eventCode: -1, eventMessage: '' },
  )
})
