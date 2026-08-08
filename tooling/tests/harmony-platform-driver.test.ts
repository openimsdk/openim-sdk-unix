import assert from 'node:assert/strict'
import test from 'node:test'
import type { ContractDocument } from '../src/model.js'
import { renderHarmonyPlatformDriver } from '../src/harmony-platform-driver.js'

function eventContract(): ContractDocument {
  return {
    schemaVersion: 2,
    edition: 'enterprise',
    origin: {
      kind: 'imported-facade',
      repository: 'private', revision: 'test', interfacePath: 'interface.uts',
      facadePaths: { android: 'android', ios: 'ios', harmony: 'harmony' },
    },
    expected: { constants: 0, types: 0, callables: 2, events: 2 },
    constants: [],
    types: [],
    callables: [
      {
        id: 2003, name: 'onConnecting', signature: 'onConnecting(handler:Handler):Subscription',
        completion: 'sync', responseCodec: 'void', errorPolicy: 'none', rawString: false,
        role: 'event-subscription', declaration: { android: '', ios: '', harmony: "export function onConnecting(handler : Handler) : Subscription { return onVoidHarmonyEvent('onConnecting', handler) }" },
        binding: { android: { kind: 'none', symbol: '' }, ios: { kind: 'none', symbol: '' }, harmony: { kind: 'none', symbol: '' } },
        signatureHash: '',
      },
      {
        id: 2004, name: 'onMsgDeleted', signature: 'onMsgDeleted(handler:Handler):Subscription',
        completion: 'sync', responseCodec: 'void', errorPolicy: 'none', rawString: false,
        role: 'event-subscription', declaration: { android: '', ios: '', harmony: "export function onMsgDeleted(handler : Handler) : Subscription { return onVoidHarmonyEvent('onMsgDeleted', handler) }" },
        binding: { android: { kind: 'none', symbol: '' }, ios: { kind: 'none', symbol: '' }, harmony: { kind: 'none', symbol: '' } },
        signatureHash: '',
      },
    ],
    events: [
      {
        id: 3001, name: 'onConnecting', callable: 'onConnecting', handlerType: 'Handler',
        dispatchArguments: { android: '', ios: '', harmony: '' }, rawPayload: false,
        binding: { android: 'bound', ios: 'bound', harmony: 'bound' }, signatureHash: '',
      },
      {
        id: 3002, name: 'onMsgDeleted', callable: 'onMsgDeleted', handlerType: 'Handler',
        dispatchArguments: { android: '', ios: '', harmony: '' }, rawPayload: false,
        binding: { android: 'bound', ios: 'bound', harmony: 'bound' }, signatureHash: '',
      },
    ],
  }
}

test('Harmony PlatformDriver derives native events from ABI inventory rather than façade bodies', () => {
  const source = renderHarmonyPlatformDriver(eventContract(), {
    events: [
      { name: 'EventOnConnecting', value: 1001 },
      { name: 'EventOnMessageDeleted', value: 1002 },
    ],
    nativeEventAliases: { onMsgDeleted: 'EventOnMessageDeleted' },
  })
  assert.match(source, /harmonyEventCode\('EventOnConnecting'\)/)
  assert.match(source, /harmonyEventCode\('EventOnMessageDeleted'\)/)
  assert.match(source, /activeEventSink\('onConnecting'/)
  assert.match(source, /activeEventSink\('onMsgDeleted'/)
  assert.doesNotMatch(source, /onVoidHarmonyEvent/)
})
