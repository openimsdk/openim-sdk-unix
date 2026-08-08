import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GENERATED_SOURCE_HEADER } from './generate.js'
import { extractExportedValues, parseSource } from './source.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertIncludes(source: string, fragments: string[], label: string): void {
  for (const fragment of fragments) {
    assert(source.includes(fragment), `${label} is missing: ${fragment}`)
  }
}

function assertExcludes(source: string, fragments: string[], label: string): void {
  for (const fragment of fragments) {
    assert(!source.includes(fragment), `${label} contains forbidden fragment: ${fragment}`)
  }
}

function assertOrdered(source: string, fragments: string[], label: string): void {
  let offset = 0
  for (const fragment of fragments) {
    const index = source.indexOf(fragment, offset)
    assert(index >= 0, `${label} is missing or out of order: ${fragment}`)
    offset = index + fragment.length
  }
}

function assertEventControlInterface(path: string, label: string): void {
  const callables = new Map(extractExportedValues(parseSource(path)).map((value) => [value.name, value.signature]))
  assert(callables.get('off') === 'off(subscription:OpenIMSDKEventSubscription):void', `${label} off signature drifted`)
  assert(callables.get('offAll') === 'offAll(eventName:OpenIMSDKEventName):void', `${label} offAll signature drifted`)
}

export function generatedDriverRuntime(source: string): string {
  const normalized = source.trimEnd()
  return `${normalized.startsWith(GENERATED_SOURCE_HEADER) ? normalized : `${GENERATED_SOURCE_HEADER}\n${normalized}`}\n`
}

export function verifyDriverInvariants(root: string): void {
  const androidFacade = readFileSync(
    join(root, 'uni_modules/unix-openim-sdk/utssdk/app-android/NativeOpenIMSDK.kt'),
    'utf8',
  )
  const iosFacade = readFileSync(
    join(root, 'uni_modules/unix-openim-sdk/utssdk/app-ios/NativeOpenIMSDK.swift'),
    'utf8',
  )
  const androidRuntime = readFileSync(join(root, 'sdk-src/native/android/OpenIMDriverRuntime.kt'), 'utf8')
  const iosRuntime = readFileSync(join(root, 'sdk-src/native/ios/OpenIMDriverRuntime.swift'), 'utf8')
  const utsInterfacePath = join(root, 'uni_modules/unix-openim-sdk/utssdk/interface.uts')
  const utsInterface = readFileSync(utsInterfacePath, 'utf8')
  const androidEvents = readFileSync(join(root, 'uni_modules/unix-openim-sdk/utssdk/app-android/events.uts'), 'utf8')
  const iosEvents = readFileSync(join(root, 'uni_modules/unix-openim-sdk/utssdk/app-ios/events.uts'), 'utf8')

  assertIncludes(
    utsInterface,
    [
      'export type OpenIMSDKEventSubscription = {',
    ],
    'UTS event subscription interface',
  )
  assertExcludes(utsInterface, ['OpenIMSDKUnsubscribe', 'OpenIMSDKSubscriptionID'], 'UTS event subscription interface')
  assertEventControlInterface(utsInterfacePath, 'UTS event subscription interface')
  for (const [label, source] of [['Android UTS events', androidEvents], ['iOS UTS events', iosEvents]] as const) {
    assertIncludes(
      source,
      [
        'export function offSDKEvent(subscription : OpenIMSDKEventSubscription)',
      ],
      label,
    )
    const perEventHandle = source.includes("return { id: subscriptionID, eventName: 'onConnecting' }")
    const genericHandle = source.includes('return { id: subscriptionID, eventName: eventName }')
    assert(perEventHandle || genericHandle, `${label} does not return a stable event subscription handle`)
    assertExcludes(source, ['OpenIMSDKUnsubscribe', 'return () =>'], label)
  }

  assert(!androidFacade.includes('dispatchOpenIMMain'), 'Android façade bypasses the Driver callback seam')
  assert(!iosFacade.includes('dispatchOpenIMMain'), 'iOS façade bypasses the Driver callback seam')

  assertIncludes(
    androidRuntime,
    ['newSingleThreadExecutor', 'terminalScheduled', 'pending.remove(ticket.taskID)', 'OpenIM SDK was uninitialized'],
    'Android Driver exactly-once runtime',
  )
  assertIncludes(
    iosRuntime,
    ['DispatchQueue(label:', 'terminalScheduled', 'pending.removeValue(forKey: ticket.taskID)', 'OpenIM SDK was uninitialized'],
    'iOS Driver exactly-once runtime',
  )

  assertOrdered(
    androidFacade,
    [
      'fun unInitSDK(operationID: String): String {',
      'OpenIMDriverRuntime.shutdown()',
      'sdkInitialized = false',
      'unbindNativeEventListeners()',
      'Open_im_sdk.unInitSDK(operationID)',
    ],
    'Android teardown barrier',
  )
  assertOrdered(
    iosFacade,
    [
      'static func unInitSDK(_ operationID: String) -> String {',
      'OpenIMDriverRuntime.shared.shutdown()',
      'sdkInitialized = false',
      'unbindNativeEventListeners()',
      'Open_im_sdkUnInitSDK(operationID)',
    ],
    'iOS teardown barrier',
  )

  const androidNilSetters = [
    'setAdvancedMsgListener(null)',
    'setBatchMsgListener(null)',
    'setConversationListener(null)',
    'setCustomBusinessListener(null)',
    'setFriendListener(null)',
    'setGroupListener(null)',
    'setUserListener(null)',
  ]
  const iosNilSetters = [
    'SetAdvancedMsgListener(nil)',
    'SetBatchMsgListener(nil)',
    'SetConversationListener(nil)',
    'SetCustomBusinessListener(nil)',
    'SetFriendListener(nil)',
    'SetGroupListener(nil)',
    'SetUserListener(nil)',
  ]
  assertExcludes(androidFacade, androidNilSetters, 'Android listener teardown')
  assertExcludes(iosFacade, iosNilSetters, 'iOS listener teardown')
  assertIncludes(
    androidFacade,
    ['UTS-COMPAT-NATIVE-LISTENER-001', 'advancedMsgListener = null', 'listenersBoundEpoch = -1'],
    'Android listener retirement',
  )
  assertIncludes(
    iosFacade,
    ['UTS-COMPAT-NATIVE-LISTENER-001', 'advancedMsgListener = nil', 'listenersBoundEpoch = -1'],
    'iOS listener retirement',
  )
  assert(androidFacade.includes('listenersBoundEpoch == sessionEpoch'), 'Android listener binding is not epoch-idempotent')
  assert(iosFacade.includes('listenersBoundEpoch != sessionEpoch'), 'iOS listener binding is not epoch-idempotent')
}

export function verifyEnterpriseDriverInvariants(publicRoot: string, privateRoot: string): void {
  const androidFacade = readFileSync(
    join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-android/NativeOpenIMSDK.kt'),
    'utf8',
  )
  const iosFacade = readFileSync(
    join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-ios/NativeOpenIMSDK.swift'),
    'utf8',
  )
  const sharedAndroid = generatedDriverRuntime(
    readFileSync(join(publicRoot, 'sdk-src/native/android/OpenIMDriverRuntime.kt'), 'utf8'),
  )
  const sharedIOS = generatedDriverRuntime(
    readFileSync(join(publicRoot, 'sdk-src/native/ios/OpenIMDriverRuntime.swift'), 'utf8'),
  )
  const enterpriseAndroid = readFileSync(
    join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-android/OpenIMDriverRuntime.kt'),
    'utf8',
  )
  const enterpriseIOS = readFileSync(
    join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-ios/OpenIMDriverRuntime.swift'),
    'utf8',
  )
  const harmonySource = readFileSync(
    join(privateRoot, 'sdk-src/native/harmony/OpenIMHarmonyDriver.ets'),
    'utf8',
  )
  const enterpriseHarmony = readFileSync(
    join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-harmony/OpenIMHarmonyDriver.ets'),
    'utf8',
  )
  const enterpriseInterfacePath = join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/interface.uts')
  const enterpriseInterface = readFileSync(enterpriseInterfacePath, 'utf8')
  const enterpriseHarmonyIndex = readFileSync(
    join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-harmony/index.uts'),
    'utf8',
  )
  assertIncludes(
    enterpriseInterface,
    [
      'export type OpenIMSDKEventSubscription = {',
    ],
    'Enterprise UTS event subscription interface',
  )
  assertExcludes(enterpriseInterface, ['OpenIMSDKUnsubscribe', 'OpenIMSDKSubscriptionID'], 'Enterprise UTS event subscription interface')
  assertEventControlInterface(enterpriseInterfacePath, 'Enterprise UTS event subscription interface')
  assertIncludes(
    enterpriseHarmonyIndex,
    [
      'function registerHarmonyUTSSubscription(',
      'export function off(subscription : OpenIMSDKEventSubscription)',
    ],
    'Enterprise Harmony UTS subscription registry',
  )
  assertExcludes(enterpriseHarmonyIndex, ['OpenIMSDKUnsubscribe'], 'Enterprise Harmony UTS subscription registry')
  assert(sharedAndroid === enterpriseAndroid, 'Enterprise Android Driver Runtime is not the public shared source')
  assert(sharedIOS === enterpriseIOS, 'Enterprise iOS Driver Runtime is not the public shared source')
  assert(harmonySource === enterpriseHarmony, 'Enterprise Harmony Driver is not generated from its authoritative source')
  assert(harmonySource.includes("from '@openimsdk/imsdk'"), 'Enterprise Harmony Driver does not bind the HAR')
  assertIncludes(
    harmonySource,
    [
      'static onEvent(',
      'JSON.stringify(payload)',
      'handlers.slice()',
      'bindingEpoch !== OpenIMHarmonyDriver.epoch',
      'private static trackStringPromise(',
      'private static trackNumberPromise(',
      'private static trackBooleanPromise(',
      'static callAsync(',
      'case 400059:',
      'case 400063:',
      'terminalScheduled',
      "task.reject(new Error('OpenIM SDK was uninitialized'))",
      'static offAll(',
      'static initSDK(',
      'OpenIMHarmonyDriver.teardownBarrier.then(',
      'initEpoch !== OpenIMHarmonyDriver.epoch',
      'OpenIMHarmonyDriver.bindAllNativeEvents()',
      'AppFramework.Native',
      'Platform.HarmonyOS',
      'static unInitSDK(',
      'OpenIMHarmonyDriver.invalidateEventEpoch()',
    ],
    'Enterprise Harmony raw JSON event seam',
  )
  assert(!androidFacade.includes('dispatchOpenIMMain'), 'Enterprise Android façade bypasses the Driver callback seam')
  assert(!iosFacade.includes('dispatchOpenIMMain'), 'Enterprise iOS façade bypasses the Driver callback seam')

  assertOrdered(
    androidFacade,
    [
      'fun unInitSDK(operationID: String): String {',
      'OpenIMDriverRuntime.shutdown()',
      'sdkInitialized = false',
      'unbindNativeEventListeners()',
      'Open_im_sdk.unInitSDK(operationID)',
    ],
    'Enterprise Android teardown barrier',
  )
  assertOrdered(
    iosFacade,
    [
      'static func unInitSDK(_ operationID: String) -> String {',
      'OpenIMDriverRuntime.shared.shutdown()',
      'sdkInitialized = false',
      'unbindNativeEventListeners()',
      'Open_im_sdkUnInitSDK(operationID)',
    ],
    'Enterprise iOS teardown barrier',
  )

  const listenerNames = [
    'AdvancedMsg',
    'Conversation',
    'ConversationGroup',
    'CustomBusiness',
    'Friend',
    'Group',
    'MessageKvInfo',
    'Signaling',
    'DataMigration',
    'User',
  ]
  assertExcludes(
    androidFacade,
    listenerNames.map((name) => `set${name}Listener(null)`),
    'Enterprise Android listener teardown',
  )
  assertExcludes(
    iosFacade,
    listenerNames.map((name) => `Set${name}Listener(nil)`),
    'Enterprise iOS listener teardown',
  )
  assert(androidFacade.includes('UTS-COMPAT-NATIVE-LISTENER-001'), 'Enterprise Android listener workaround is not documented')
  assert(iosFacade.includes('UTS-COMPAT-NATIVE-LISTENER-001'), 'Enterprise iOS listener workaround is not documented')
  assert(androidFacade.includes('listenersBoundEpoch == sessionEpoch'), 'Enterprise Android listener binding is not epoch-idempotent')
  assert(iosFacade.includes('listenersBoundEpoch != sessionEpoch'), 'Enterprise iOS listener binding is not epoch-idempotent')
}
