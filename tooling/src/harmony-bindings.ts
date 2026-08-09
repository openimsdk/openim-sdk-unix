import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const IMPORT_START = '// <openim-generated-harmony-imports>'
const IMPORT_END = '// </openim-generated-harmony-imports>'
const OPERATIONS_START = '  // <openim-generated-harmony-operations>'
const OPERATIONS_END = '  // </openim-generated-harmony-operations>'

export type HarmonyTypedMethod = {
  harOrdinal: number
  name: string
  requestType: string | null
  responseType: string
  declaration: string
}

export type HarmonyNativeEvent = {
  name: string
  value: number
}

export type HarmonyContractMethodBinding = {
  callableID: number
  callableName: string
  methodName: string
}

const HARMONY_METHOD_ALIASES: Record<string, string> = {
  getSdkVersion: 'version',
  getAdvancedHistoryMessageList: 'getHistoryMessageList',
  getGroupMemberList: 'getGroupMembers',
  deleteMessageFromLocalStorage: 'deleteMessageFromLocal',
  deleteAllMsgFromLocal: 'deleteAllMessageFromLocal',
  deleteAllMsgFromLocalAndSvr: 'deleteAllMsgFromLocalAndServer',
  insertSingleMessageToLocalStorage: 'insertSingleMessageToLocal',
  insertGroupMessageToLocalStorage: 'insertGroupMessageToLocal',
  getSpecifiedFriendsInfo: 'getSpecifiedFriends',
  getFriendApplicationListAsRecipient: 'getFriendApplication',
  getFriendApplicationListAsApplicant: 'getFriendApplication',
  getFriendList: 'getFriends',
  getFriendListPage: 'getFriendsPage',
  deleteConversation: 'deleteConversationAndDeleteAllMsg',
  updateFriends: 'updateFriend',
  acceptFriendApplication: 'handleFriendApplication',
  refuseFriendApplication: 'handleFriendApplication',
  removeBlack: 'deleteBlack',
  getBlackList: 'getBlacks',
  getJoinedGroupList: 'getJoinedGroups',
  getJoinedGroupListPage: 'getJoinedGroupsPage',
  getGroupApplicationListAsApplicant: 'getGroupApplication',
  getGroupApplicationListAsRecipient: 'getGroupApplication',
  acceptGroupApplication: 'handleGroupApplication',
  refuseGroupApplication: 'handleGroupApplication',
  subscribeUsersStatus: 'subscribeUsersOnlineStatus',
  unsubscribeUsersStatus: 'unsubscribeUsersOnlineStatus',
  getUserStatus: 'subscribeUsersOnlineStatus',
  getSubscribeUsersStatus: 'subscribeUsersOnlineStatus',
  createImageMessageFromFullPath: 'createImageMessage',
  createSoundMessageFromFullPath: 'createSoundMessage',
  createVideoMessageFromFullPath: 'createVideoMessage',
  createFileMessageFromFullPath: 'createFileMessage',
  sendMessageNotOss: 'sendMessage',
  uploadLogs: 'uploadSDKData',
}

const HARMONY_LOCAL_OR_UNSUPPORTED_OPERATIONS = new Set([
  'getLoginUserID',
  'getOpenIMDataPath',
  'updateFcmToken',
  'updateToken',
  'translateText',
  'getArchivedConversationList',
  'translateMessage',
])

const HARMONY_SPECIAL_METHODS = new Set([
  'initSDK',
  'login',
  'logout',
  'unInitSDK',
  'getLoginStatus',
  'version',
])

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function harDeclaration(privateRoot: string): string {
  const harPath = join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-harmony/libs/imsdk.har')
  return execFileSync('tar', ['-xOzf', harPath, 'package/src/main/ets/sdk-types.d.ets'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
}

export function harmonyTypedMethods(privateRoot: string): HarmonyTypedMethod[] {
  const declaration = harDeclaration(privateRoot)
  const sdkBody = /export interface OpenIMSDK\s*\{([\s\S]*?)\n\}/.exec(declaration)?.[1] ?? ''
  const methods: HarmonyTypedMethod[] = []
  for (const match of sdkBody.matchAll(/^\s*([A-Za-z_$][\w$]*)\((.*?)\): Promise<([^;]+)>;/gm)) {
    const name = match[1] ?? ''
    const parameters = match[2] ?? ''
    const responseType = match[3] ?? ''
    const noRequest = parameters === 'operationID?: string'
    const requestMatch = /^params: ([A-Za-z_$][\w$]*), operationID\?: string$/.exec(parameters)
    assert(noRequest || requestMatch != null, `Unsupported Harmony typed method signature: ${match[0]}`)
    methods.push({
      harOrdinal: methods.length + 1,
      name,
      requestType: noRequest ? null : requestMatch?.[1] ?? null,
      responseType,
      declaration: match[0].trim(),
    })
  }
  assert(methods.length === 142, `Expected 142 typed Harmony Promise methods, got ${methods.length}`)
  return methods
}

export function harmonyContractMethodBindings(privateRoot: string): HarmonyContractMethodBinding[] {
  const base = JSON.parse(readFileSync(join(privateRoot, 'contracts/base/contract.json'), 'utf8')) as {
    callables: Array<{ id: number; name: string; role: string }>
  }
  const delta = JSON.parse(readFileSync(join(privateRoot, 'contracts/enterprise/delta.json'), 'utf8')) as {
    callables: Array<{ id: number; name: string; role: string }>
  }
  const nativeMethods = new Set(harmonyTypedMethods(privateRoot).map((method) => method.name))
  const bindings: HarmonyContractMethodBinding[] = []
  const missing: string[] = []
  for (const callable of [...base.callables, ...delta.callables]) {
    if (callable.role !== 'operation') continue
    const methodName = HARMONY_METHOD_ALIASES[callable.name] ?? callable.name
    if (nativeMethods.has(methodName)) {
      bindings.push({ callableID: callable.id, callableName: callable.name, methodName })
    } else if (!HARMONY_LOCAL_OR_UNSUPPORTED_OPERATIONS.has(callable.name)) {
      missing.push(`${callable.id}/${callable.name}->${methodName}`)
    }
  }
  assert(missing.length === 0, `Harmony contract operations lack HAR bindings: ${missing.join(', ')}`)
  return bindings
}

export function harmonyNativeEvents(privateRoot: string): HarmonyNativeEvent[] {
  const declaration = harDeclaration(privateRoot)
  const enumBody = /export declare enum OpenIMSDKEvent\s*\{([\s\S]*?)\n\}/.exec(declaration)?.[1] ?? ''
  const events = [...enumBody.matchAll(/\b(Event[A-Za-z0-9_]+)\s*=\s*(-?\d+)/g)].map((match) => ({
    name: match[1] ?? '',
    value: Number(match[2]),
  }))
  assert(events.length === 69, `Expected 69 Harmony native events, got ${events.length}`)
  return events
}

function replaceRegion(source: string, start: string, end: string, content: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end)
  assert(startIndex >= 0 && endIndex > startIndex, `Missing generated region ${start}`)
  const contentStart = startIndex + start.length
  return `${source.slice(0, contentStart)}\n${content}${source.slice(endIndex)}`
}

function manualHarImports(source: string): Set<string> {
  const withoutGenerated = replaceRegion(source, IMPORT_START, IMPORT_END, '')
  const body = /import harmonySDK,\s*\{([\s\S]*?)\}\s*from '@openimsdk\/imsdk'/.exec(withoutGenerated)?.[1] ?? ''
  return new Set(body.split(',').map((value) => value.trim()).filter((value) => value !== ''))
}

function methodName(name: string): string {
  return `callBinding${name.slice(0, 1).toUpperCase()}${name.slice(1)}`
}

export function harmonyObjectResponseEncoder(methodName: string): string {
  if (methodName === 'signalingInvite' || methodName === 'signalingInviteInGroup' || methodName === 'signalingAccept') {
    return 'OpenIMHarmonyDriver.normalizeSignalingInvitePayload(request, response)'
  }
  if (methodName === 'signalingGetTokenByRoomID') {
    return 'OpenIMHarmonyDriver.normalizeSignalingTokenPayload(response)'
  }
  if (methodName === 'signalingGetRoomByGroupID') {
    return 'OpenIMHarmonyDriver.normalizeSignalingRoomPayload(response)'
  }
  if (methodName === 'signalingGetInvitationInfoStartApp') {
    return 'OpenIMHarmonyDriver.normalizeSignalingStartAppPayload(response)'
  }
  return 'OpenIMHarmonyDriver.encodeObjectResponse(response)'
}

function renderMethod(method: HarmonyTypedMethod): string {
  const call = method.requestType == null
    ? `harmonySDK.${method.name}(operationID)`
    : `harmonySDK.${method.name}(request, operationID)`
  const request = method.requestType == null
    ? ''
    : `    const request: ${method.requestType} = JSON.parse(requestJSON) as ${method.requestType}\n`
  const response = method.responseType === 'OpenIMSDKEmptyPayload'
    ? `    const nativePromise: Promise<string> = ${call}.then((_response: OpenIMSDKEmptyPayload): string => {\n      return ''\n    })`
    : `    const nativePromise: Promise<string> = ${call}.then((response: ${method.responseType}): string => {\n      return ${harmonyObjectResponseEncoder(method.name)}\n    })`
  return [
    `  private static ${methodName(method.name)}(requestJSON: string, operationID: string): Promise<string> {`,
    request.trimEnd(),
    response,
    `    return OpenIMHarmonyDriver.trackStringPromise(nativePromise, '${method.name}', operationID)`,
    '  }',
  ].filter((line) => line !== '').join('\n')
}

function renderOperations(
  methods: HarmonyTypedMethod[],
  bindings: HarmonyContractMethodBinding[],
  harVersion: string,
): string {
  const functions = methods.filter((method) => !HARMONY_SPECIAL_METHODS.has(method.name)).map(renderMethod).join('\n\n')
  const cases = bindings
    .filter((binding) => binding.callableName !== 'getSdkVersion')
    .map((binding) => {
      let invoke = `OpenIMHarmonyDriver.${methodName(binding.methodName)}(requestJSON, operationID)`
      if (binding.callableName === 'initSDK') invoke = 'OpenIMHarmonyDriver.callContractInitSDK(requestJSON, operationID)'
      if (binding.callableName === 'login') invoke = 'OpenIMHarmonyDriver.callContractLogin(requestJSON, operationID)'
      if (binding.callableName === 'logout') invoke = 'OpenIMHarmonyDriver.logout(operationID)'
      if (binding.callableName === 'getLoginStatus') invoke = 'OpenIMHarmonyDriver.callContractGetLoginStatus(operationID)'
      if (binding.callableName === 'unInitSDK') invoke = 'OpenIMHarmonyDriver.unInitSDK(operationID)'
      return [`      case ${binding.callableID}:`, `        return ${invoke}`].join('\n')
    })
    .join('\n')
  return `${functions}\n\n  private static callContractInitSDK(requestJSON: string, operationID: string): Promise<string> {
    const request: OpenIMDriverInitRequest = JSON.parse(requestJSON) as OpenIMDriverInitRequest
    return OpenIMHarmonyDriver.initSDK(
      request.apiAddr,
      request.wsAddr,
      request.dataDir,
      request.logFilePath,
      request.logLevel,
      request.isLogStandardOutput,
      operationID
    ).then((initialized: boolean): string => initialized ? 'true' : 'false')
  }

  private static callContractLogin(requestJSON: string, operationID: string): Promise<string> {
    const request: LoginReq = JSON.parse(requestJSON) as LoginReq
    return OpenIMHarmonyDriver.login(request.userID, request.token, operationID)
  }

  private static callContractGetLoginStatus(operationID: string): Promise<string> {
    return OpenIMHarmonyDriver.getLoginStatus(operationID).then((status: number): string => String(status))
  }

  static callAsync(callableID: number, operationID: string, requestJSON: string): Promise<string> {
    switch (callableID) {
${cases}
      default:
        return Promise.reject(new Error('Unsupported Harmony callable ID: ' + String(callableID)))
    }
  }

  static callSync(callableID: number, operationID: string, requestJSON: string): string {
    switch (callableID) {
      case 2056:
        return '${harVersion}'
      default:
        throw new Error('Unsupported Harmony synchronous callable ID: ' + String(callableID))
    }
  }
`
}

function harPackageVersion(privateRoot: string): string {
  const harPath = join(privateRoot, 'uni_modules/unix-openim-sdk/utssdk/app-harmony/libs/imsdk.har')
  const manifest = execFileSync('tar', ['-xOzf', harPath, 'package/oh-package.json5'], { encoding: 'utf8' })
  const version = (JSON.parse(manifest) as { version?: string }).version
  assert(version != null && version !== '', 'Harmony HAR package version is missing')
  return version
}

export function renderHarmonyDriverBindings(privateRoot: string): string {
  const driverPath = join(privateRoot, 'sdk-src/native/harmony/OpenIMHarmonyDriver.ets')
  const source = readFileSync(driverPath, 'utf8')
  const methods = harmonyTypedMethods(privateRoot)
  const bindings = harmonyContractMethodBindings(privateRoot)
  const manualImports = manualHarImports(source)
  const generatedImports = new Set<string>()
  for (const method of methods) {
    if (method.requestType != null && !manualImports.has(method.requestType)) generatedImports.add(method.requestType)
    if (!manualImports.has(method.responseType)) generatedImports.add(method.responseType)
  }
  const importNames = [...generatedImports].sort()
  const importBlock = importNames.length === 0
    ? ''
    : `import {\n${importNames.map((name) => `  ${name}`).join(',\n')}\n} from '@openimsdk/imsdk'\n`
  const withImports = replaceRegion(source, IMPORT_START, IMPORT_END, importBlock)
  return replaceRegion(withImports, OPERATIONS_START, OPERATIONS_END, renderOperations(methods, bindings, harPackageVersion(privateRoot)))
}

export function renderHarmonyOperationCodes(privateRoot: string): string {
  const events = harmonyNativeEvents(privateRoot)
  const eventMappings = events.map((event) => [
    `  if (eventName == '${event.name}') {`,
    `    return ${event.value}`,
    '  }',
  ].join('\n')).join('\n')
  return `// Generated from the locked Harmony HAR ABI. Do not edit.\nexport function harmonyEventCode(eventName : string) : number {\n${eventMappings}\n  return -1\n}\n`
}
