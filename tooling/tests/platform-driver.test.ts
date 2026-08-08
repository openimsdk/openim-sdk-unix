import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import type { ContractDocument } from '../src/model.js'
import {
  platformDriverBindings,
  renderNativeCoreAdapter,
  renderPlatformDriverUTS,
} from '../src/platform-driver.js'
import { generateIndex } from '../src/generate.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const contract = JSON.parse(readFileSync(resolve(root, 'contracts/base/contract.json'), 'utf8')) as ContractDocument

const IN_MEMORY_MESSAGE_CREATORS = [
  ['createImageMessageByURL', 2141],
  ['createCustomMessage', 2142],
  ['createQuoteMessage', 2143],
  ['createAdvancedQuoteMessage', 2144],
  ['createAdvancedTextMessage', 2145],
  ['createTextAtMessage', 2146],
  ['createSoundMessageByURL', 2148],
  ['createVideoMessageByURL', 2150],
  ['createFileMessageByURL', 2152],
  ['createMergerMessage', 2153],
  ['createForwardMessage', 2154],
  ['createFaceMessage', 2155],
  ['createLocationMessage', 2156],
  ['createCardMessage', 2157],
] as const

const PATH_MESSAGE_CREATORS = [
  ['createImageMessageFromFullPath', 2140, 1],
  ['createSoundMessageFromFullPath', 2147, 1],
  ['createVideoMessageFromFullPath', 2149, 2],
  ['createFileMessageFromFullPath', 2151, 1],
] as const

const CONVERSATION_STRING_OPERATIONS = [
  ['deleteConversationAndDeleteAllMsg', 2063, 'callback'],
  ['markConversationMessageAsRead', 2064, 'callback'],
  ['setConversation', 2068, 'callback'],
  ['clearConversationAndDeleteAllMsg', 2082, 'callback'],
  ['hideConversation', 2083, 'callback'],
  ['hideAllConversations', 2084, 'callback'],
  ['markAllConversationMessageAsRead', 2085, 'callback'],
  ['getConversationIDBySessionType', 2088, 'sync-return'],
  ['deleteConversation', 2090, 'callback'],
  ['setConversationDraft', 2091, 'callback'],
] as const

const CONVERSATION_TYPED_QUERIES = [
  ['getAllConversationList', 2059, 'typed:OpenIMConversationListResult|null', 'resolveConversationListNative'],
  ['getOneConversation', 2060, 'typed:OpenIMConversationItem|null', 'resolveConversationObjectNative'],
  ['searchConversation', 2086, 'typed:OpenIMConversationListResult|null', 'resolveConversationListNative'],
  ['getConversationListSplit', 2087, 'typed:OpenIMConversationListResult|null', 'resolveConversationListNative'],
  ['getMultipleConversation', 2089, 'typed:OpenIMConversationListResult|null', 'resolveConversationListNative'],
  ['searchLocalMessages', 2093, 'typed:OpenIMSearchMessageResult|null', 'parseNativeSearchMessageResult'],
] as const

const ADVANCED_HISTORY_QUERY = ['getAdvancedHistoryMessageList', 2061] as const

const MESSAGE_USER_FRIEND_OPERATIONS = [
  ['getSpecifiedGroupsInfo', 2062],
  ['getGroupMemberList', 2065],
  ['setMessageLocalEx', 2066],
  ['revokeMessage', 2067],
  ['setAppBackgroundStatus', 2069],
  ['setAppBadge', 2070],
  ['networkStatusChanged', 2071],
  ['getSelfUserInfo', 2072],
  ['getUsersInfo', 2073],
  ['setSelfInfo', 2074],
  ['deleteMessageFromLocalStorage', 2075],
  ['deleteMessage', 2076],
  ['deleteAllMsgFromLocal', 2077],
  ['deleteAllMsgFromLocalAndSvr', 2078],
  ['insertSingleMessageToLocalStorage', 2079],
  ['insertGroupMessageToLocalStorage', 2080],
  ['changeInputStates', 2081],
  ['getTotalUnreadMsgCount', 2092],
  ['addFriend', 2094],
  ['searchFriends', 2095],
  ['getSpecifiedFriendsInfo', 2096],
  ['getFriendApplicationListAsRecipient', 2097],
  ['getFriendApplicationListAsApplicant', 2098],
  ['getFriendApplicationUnhandledCount', 2099],
  ['getFriendList', 2100],
  ['getFriendListPage', 2101],
  ['updateFriends', 2102],
  ['checkFriend', 2103],
  ['acceptFriendApplication', 2104],
  ['refuseFriendApplication', 2105],
  ['deleteFriend', 2106],
  ['addBlack', 2107],
  ['removeBlack', 2108],
  ['getBlackList', 2109],
] as const

test('first PlatformDriver slice keeps canonical contract IDs', () => {
  const expected = [
    { id: 2051, name: 'initSDK' },
    { id: 2052, name: 'login' },
    { id: 2053, name: 'logout' },
    { id: 2054, name: 'getLoginStatus' },
    { id: 2055, name: 'getLoginUserID' },
    { id: 2056, name: 'getSdkVersion' },
    { id: 2058, name: 'unInitSDK' },
    ...[
      ...CONVERSATION_STRING_OPERATIONS.map(([name, id]) => ({ id, name })),
      ...CONVERSATION_TYPED_QUERIES.map(([name, id]) => ({ id, name })),
      { id: ADVANCED_HISTORY_QUERY[1], name: ADVANCED_HISTORY_QUERY[0] },
      ...MESSAGE_USER_FRIEND_OPERATIONS.map(([name, id]) => ({ id, name })),
    ].sort((left, right) => left.id - right.id),
    { id: 2139, name: 'createTextMessage' },
    ...[
      ...IN_MEMORY_MESSAGE_CREATORS.map(([name, id]) => ({ id, name })),
      ...PATH_MESSAGE_CREATORS.map(([name, id]) => ({ id, name })),
    ].sort((left, right) => left.id - right.id),
    { id: 2158, name: 'sendMessage' },
    { id: 2159, name: 'sendMessageNotOss' },
  ]
  assert.deepEqual(platformDriverBindings(contract), expected)
})

test('UTS PlatformDriver exposes exactly the three free-function entries', () => {
  for (const platform of ['android', 'ios'] as const) {
    const source = renderPlatformDriverUTS(platform)
    assert.match(source, /export function driverCallAsync\(/)
    assert.match(source, /export function driverCallSync\(/)
    assert.match(source, /export function driverBindEventSink\(/)
    assert.doesNotMatch(source, /\b(?:class|interface)\b/)
    assert.doesNotMatch(source, /400\d{3}/)
  }
})

test('native CoreAdapters dispatch the first slice by canonical callable ID', () => {
  for (const platform of ['android', 'ios'] as const) {
    const source = renderNativeCoreAdapter(contract, platform)
    for (const id of [2051, 2052, 2053, 2054, 2055, 2056, 2058, 2139, 2158, 2159]) assert.match(source, new RegExp(`(?:case |${platform === 'android' ? '' : 'case '})${id}`))
    assert.doesNotMatch(source, /400\d{3}/)
    assert.match(source, /Unsupported OpenIM callable ID/)
    assert.match(source, /NativeOpenIMSDK\.createTextMessage/)
    assert.match(source, /NativeOpenIMSDK\.sendMessage\(/)
    assert.match(source, /NativeOpenIMSDK\.sendMessageNotOss\(/)
    if (platform === 'ios') assert.match(source, /\\\(callableID\)/)
  }
})

test('first compiler slice stores lowering data instead of platform implementation bodies', () => {
  const driverNames = platformDriverBindings(contract).map(({ name }) => name)
  for (const name of [...driverNames, 'off', 'offAll']) {
    const callable = contract.callables.find((candidate) => candidate.name === name)
    assert.notEqual(callable, undefined)
    assert.equal('declaration' in callable!, false)
    assert.notEqual(callable!.lowering, undefined)
  }

  const serialized = JSON.stringify(contract.callables.filter((callable) => (
    driverNames.includes(callable.name)
    || callable.name === 'off'
    || callable.name === 'offAll'
  )))
  assert.doesNotMatch(serialized, /driverCall(?:Async|Sync)|off(?:All)?SDKEvent/)

  for (const name of ['createTextMessage', 'sendMessage', 'sendMessageNotOss']) {
    const callable = contract.callables.find((candidate) => candidate.name === name)
    assert.equal(callable?.lowering?.kind, 'platform-driver')
    if (callable?.lowering?.kind !== 'platform-driver') continue
    const request = callable.lowering.request
    assert.equal(typeof request, 'object')
    assert.ok(callable.lowering.nativeInvocation)
    if (typeof request === 'string') continue
    assert.ok(request.kind === 'fields')
    assert.ok(request.fields.length > 0)
  }
})

test('first compiler slice is rendered from lowering data for both Public platforms', () => {
  for (const platform of ['android', 'ios'] as const) {
    const source = generateIndex(root, contract, platform)
    assert.match(source, /export function off\(subscription : OpenIMSDKEventSubscription\)/)
    assert.match(source, /export function offAll\(eventName : OpenIMSDKEventName\)/)
    assert.match(source, /driverCallAsync\(2051, normalizeOperationID\(operationID\), normalizeInitConfig\(config\)/)
    assert.match(source, /driverCallAsync\(2052, normalizeOperationID\(operationID\), requestJSON/)
    assert.match(source, /driverCallSync\(2056, '', '\{\}'\)/)
    assert.match(source, /driverCallAsync\(2139, op, requestJSON/)
    assert.match(source, /driverCallAsync\(2158, readOperationID\(options\), requestJSON/)
    assert.match(source, /driverCallAsync\(2159, readOperationID\(options\), requestJSON/)
    assert.match(source, /resolveSendMessageData\(data, 'sendMessage'/)
    assert.match(source, /resolveSendMessageData\(data, 'sendMessageNotOss'/)
    for (const { name } of platformDriverBindings(contract)) {
      const declaration = source.split('\n').find((line) => line.startsWith(`export const ${name} =`))
      assert.notEqual(declaration, undefined)
      assert.doesNotMatch(declaration!, /NativeOpenIMSDK/)
    }
  }
})

test('in-memory message creators cross the same structured PlatformDriver seam', () => {
  for (const [name, id] of IN_MEMORY_MESSAGE_CREATORS) {
    const callable = contract.callables.find((candidate) => candidate.name === name)
    assert.equal(callable?.id, id)
    assert.equal(callable?.lowering?.kind, 'platform-driver')
    if (callable?.lowering?.kind !== 'platform-driver') continue
    assert.equal(callable.lowering.transport, 'async')
    assert.equal(callable.lowering.precondition, 'logged-in-create')
    assert.deepEqual(callable.lowering.nativeInvocation, { completion: 'sync-return' })
    assert.equal(typeof callable.lowering.request, 'object')
    if (typeof callable.lowering.request === 'string') continue
    assert.equal(callable.lowering.request.kind, 'fields')
    assert.ok(callable.lowering.request.fields.length > 0)
  }

  for (const platform of ['android', 'ios'] as const) {
    const adapter = renderNativeCoreAdapter(contract, platform)
    const facade = generateIndex(root, contract, platform)
    for (const [name, id] of IN_MEMORY_MESSAGE_CREATORS) {
      assert.match(adapter, new RegExp(`(?:case )?${id}`), `${platform} adapter is missing ${name}`)
      const declaration = facade.split('\n').find((line) => line.startsWith(`export const ${name} =`))
      assert.notEqual(declaration, undefined)
      assert.match(declaration!, new RegExp(`driverCallAsync\\(${id},`))
      assert.doesNotMatch(declaration!, /NativeOpenIMSDK/)
    }
    if (platform === 'android') {
      assert.match(facade, /stringifyJSON\(params\.sourcePicture\)/)
      assert.match(facade, /stringifyOpenIMMessagePayload\(params\.messageList\)/)
    } else {
      assert.match(facade, /stringifyOpenIMPicture\(params\.sourcePicture\)/)
      assert.match(facade, /stringifyOpenIMSoundElem\(params\)/)
      assert.match(facade, /stringifyOpenIMVideoElem\(params\)/)
      assert.match(facade, /stringifyOpenIMFileElem\(params\)/)
      assert.match(facade, /stringifyOpenIMMessageList\(params\.messageList\)/)
      assert.match(adapter, /CFGetTypeID\(value\) != CFBooleanGetTypeID\(\)/)
    }
  }
})

test('full-path message creators keep iOS compatibility behind generated path codecs', () => {
  for (const [name, id, pathCount] of PATH_MESSAGE_CREATORS) {
    const callable = contract.callables.find((candidate) => candidate.name === name)
    assert.equal(callable?.id, id)
    assert.equal(callable?.lowering?.kind, 'platform-driver')
    if (callable?.lowering?.kind !== 'platform-driver') continue
    assert.deepEqual(callable.lowering.nativeInvocation, { completion: 'sync-return' })
    assert.equal(typeof callable.lowering.request, 'object')
    if (typeof callable.lowering.request === 'string') continue
    const pathFields = callable.lowering.request.fields.filter((field) => field.codec === 'local-media-path')
    assert.equal(pathFields.length, pathCount)
  }

  const androidFacade = generateIndex(root, contract, 'android')
  const iosFacade = generateIndex(root, contract, 'ios')
  const androidAdapter = renderNativeCoreAdapter(contract, 'android')
  const iosAdapter = renderNativeCoreAdapter(contract, 'ios')
  for (const [name, id, pathCount] of PATH_MESSAGE_CREATORS) {
    assert.match(androidAdapter, new RegExp(`(?:case )?${id}`))
    assert.match(iosAdapter, new RegExp(`case ${id}`))
    const iosPreflight = new RegExp(`rejectUnsupportedIOSLocalMediaPath\\('${name}'`, 'g')
    assert.equal([...iosFacade.matchAll(iosPreflight)].length, pathCount)
    assert.match(iosFacade, new RegExp(`driverCallAsync\\(${id},`))
    assert.match(androidFacade, new RegExp(`driverCallAsync\\(${id},`))
  }
  assert.doesNotMatch(androidFacade, /normalizeIOSLocalMediaPath/)
  assert.match(iosFacade, /normalizeIOSLocalMediaPath/)
})

test('conversation string operations are generated from structured invocation data', () => {
  for (const [name, id, completion] of CONVERSATION_STRING_OPERATIONS) {
    const callable = contract.callables.find((candidate) => candidate.name === name)
    assert.equal(callable?.id, id)
    assert.equal(callable?.responseCodec, 'raw-string')
    assert.equal(callable?.lowering?.kind, 'platform-driver')
    if (callable?.lowering?.kind !== 'platform-driver') continue
    assert.deepEqual(callable.lowering.nativeInvocation, { completion })
  }

  const setConversation = contract.callables.find((candidate) => candidate.name === 'setConversation')
  assert.equal(setConversation?.lowering?.kind, 'platform-driver')
  if (setConversation?.lowering?.kind === 'platform-driver' && typeof setConversation.lowering.request === 'object') {
    assert.deepEqual(setConversation.lowering.request.fields.map(({ name, parameter, member, codec }) => ({ name, parameter, member, codec })), [
      { name: 'conversationID', parameter: 'params', member: 'conversationID', codec: 'identity' },
      { name: 'conversationInfo', parameter: 'params', member: undefined, codec: 'json' },
    ])
  }

  for (const name of ['hideAllConversations', 'markAllConversationMessageAsRead']) {
    const callable = contract.callables.find((candidate) => candidate.name === name)
    assert.equal(callable?.lowering?.kind, 'platform-driver')
    if (callable?.lowering?.kind === 'platform-driver') assert.equal(callable.lowering.request, 'empty-object')
  }

  for (const platform of ['android', 'ios'] as const) {
    const adapter = renderNativeCoreAdapter(contract, platform)
    const facade = generateIndex(root, contract, platform)
    for (const [name, id] of CONVERSATION_STRING_OPERATIONS) {
      assert.match(adapter, new RegExp(`(?:case )?${id}`), `${platform} adapter is missing ${name}`)
      const declaration = facade.split('\n').find((line) => line.startsWith(`export const ${name} =`))
      assert.notEqual(declaration, undefined)
      assert.match(declaration!, new RegExp(`driverCallAsync\\(${id},`))
      assert.doesNotMatch(declaration!, /NativeOpenIMSDK/)
    }
    assert.match(adapter, /NativeOpenIMSDK\.deleteConversationAndDeleteAllMsg/)
    assert.match(adapter, /NativeOpenIMSDK\.getConversationIDBySessionType/)
    const emptyCase = platform === 'android'
      ? /2084 -> \{\n\s+NativeOpenIMSDK\.hideAllConversations/
      : /case 2084:\n\s+NativeOpenIMSDK\.hideAllConversations/
    assert.match(adapter, emptyCase)
  }
})

test('typed conversation queries select strict response parsers by contract codec', () => {
  for (const [name, id, responseCodec] of CONVERSATION_TYPED_QUERIES) {
    const callable = contract.callables.find((candidate) => candidate.name === name)
    assert.equal(callable?.id, id)
    assert.equal(callable?.responseCodec, responseCodec)
    assert.equal(callable?.lowering?.kind, 'platform-driver')
    if (callable?.lowering?.kind === 'platform-driver') {
      assert.deepEqual(callable.lowering.nativeInvocation, { completion: 'callback' })
    }
  }

  const getAll = contract.callables.find((candidate) => candidate.name === 'getAllConversationList')
  assert.equal(getAll?.lowering?.kind, 'platform-driver')
  if (getAll?.lowering?.kind === 'platform-driver') assert.equal(getAll.lowering.request, 'empty-object')

  for (const platform of ['android', 'ios'] as const) {
    const adapter = renderNativeCoreAdapter(contract, platform)
    const facade = generateIndex(root, contract, platform)
    for (const [name, id, , responseAdapter] of CONVERSATION_TYPED_QUERIES) {
      assert.match(adapter, new RegExp(`(?:case )?${id}`), `${platform} adapter is missing ${name}`)
      const declaration = facade.split('\n').find((line) => line.startsWith(`export const ${name} =`))
      assert.notEqual(declaration, undefined)
      assert.match(declaration!, new RegExp(`driverCallAsync\\(${id},`))
      if (responseAdapter.startsWith('resolve')) {
        assert.match(declaration!, new RegExp(`${responseAdapter}\\(\\(resolve, reject\\) =>`))
      } else {
        assert.match(declaration!, new RegExp(`resolve\\(${responseAdapter}\\(data\\)\\)`))
      }
      assert.doesNotMatch(declaration!, /NativeOpenIMSDK/)
    }
    const emptyCase = platform === 'android'
      ? /2059 -> \{\n\s+NativeOpenIMSDK\.getAllConversationList/
      : /case 2059:\n\s+NativeOpenIMSDK\.getAllConversationList/
    assert.match(adapter, emptyCase)
  }
})

test('advanced history keeps platform compatibility behind one generated response adapter', () => {
  const [name, id] = ADVANCED_HISTORY_QUERY
  const callable = contract.callables.find((candidate) => candidate.name === name)
  assert.equal(callable?.id, id)
  assert.equal(callable?.responseCodec, 'typed:OpenIMAdvancedHistoryMessageListResult|null')
  assert.equal(callable?.lowering?.kind, 'platform-driver')
  if (callable?.lowering?.kind === 'platform-driver') {
    assert.deepEqual(callable.lowering.nativeInvocation, { completion: 'callback' })
    assert.equal(typeof callable.lowering.request, 'object')
  }

  for (const platform of ['android', 'ios'] as const) {
    const adapter = renderNativeCoreAdapter(contract, platform)
    const facade = generateIndex(root, contract, platform)
    assert.match(adapter, new RegExp(`(?:case )?${id}`))
    const declaration = facade.split('\n').find((line) => line.startsWith(`export const ${name} =`))
    assert.notEqual(declaration, undefined)
    assert.match(declaration!, new RegExp(`driverCallAsync\\(${id},`))
    assert.match(declaration!, /resolveAdvancedHistoryNative\(\(resolve, reject\) =>/)
    assert.doesNotMatch(declaration!, /NativeOpenIMSDK/)
    assert.match(facade, /function resolveAdvancedHistoryNative\(invoke :/)
  }
})

test('message, user, and friend operations retain structured wire semantics behind Driver', () => {
  for (const [name, id] of MESSAGE_USER_FRIEND_OPERATIONS) {
    const callable = contract.callables.find((candidate) => candidate.name === name)
    assert.equal(callable?.id, id)
    assert.equal(callable?.lowering?.kind, 'platform-driver')
    if (callable?.lowering?.kind === 'platform-driver') {
      assert.deepEqual(callable.lowering.nativeInvocation, { completion: 'callback' })
    }
  }

  const fieldCodecs = (name: string) => {
    const callable = contract.callables.find((candidate) => candidate.name === name)
    assert.equal(callable?.lowering?.kind, 'platform-driver')
    if (callable?.lowering?.kind !== 'platform-driver' || typeof callable.lowering.request !== 'object') return []
    return callable.lowering.request.fields.map((field) => field.codec)
  }
  assert.deepEqual(fieldCodecs('insertSingleMessageToLocalStorage'), ['stored-message-json', 'identity', 'identity'])
  assert.deepEqual(fieldCodecs('changeInputStates'), ['identity', 'optional-boolean'])
  assert.deepEqual(fieldCodecs('getFriendListPage'), ['identity', 'identity', 'literal'])
  assert.deepEqual(fieldCodecs('updateFriends'), ['update-friends-json'])

  for (const platform of ['android', 'ios'] as const) {
    const adapter = renderNativeCoreAdapter(contract, platform)
    const facade = generateIndex(root, contract, platform)
    for (const [name, id] of MESSAGE_USER_FRIEND_OPERATIONS) {
      assert.match(adapter, new RegExp(`(?:case )?${id}`), `${platform} adapter is missing ${name}`)
      const declaration = facade.split('\n').find((line) => line.startsWith(`export const ${name} =`))
      assert.notEqual(declaration, undefined)
      assert.match(declaration!, new RegExp(`driverCallAsync\\(${id},`))
      assert.doesNotMatch(declaration!, /NativeOpenIMSDK/)
    }
    assert.match(facade, /resolveNumberNative\(\(resolve, reject\) =>/)
    assert.match(facade, /resolveCheckFriendNative\(\(resolve, reject\) =>/)
  }
})

test('Android wire validators use Java wrapper classes instead of unsupported typeof any', () => {
  const source = readFileSync(
    resolve(root, 'uni_modules/unix-openim-sdk/utssdk/app-android/native-call.uts'),
    'utf8',
  )
  assert.match(source, /UTSAndroid\.getJavaClass\(value\)\.name/)
  assert.match(source, /isNativeNumberValue\(raw\)/)
  assert.doesNotMatch(source, /typeof raw/)
})
