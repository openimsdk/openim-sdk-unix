import type { ContractDocument } from './model.js'

export const PLATFORM_DRIVER_SLICE_NAMES = [
  'initSDK',
  'login',
  'logout',
  'getLoginStatus',
  'getLoginUserID',
  'getSdkVersion',
  'unInitSDK',
  'createTextMessage',
  'sendMessage',
  'sendMessageNotOss',
] as const

export interface PlatformDriverBinding {
  id: number
  name: typeof PLATFORM_DRIVER_SLICE_NAMES[number]
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function platformDriverBindings(contract: ContractDocument): PlatformDriverBinding[] {
  return PLATFORM_DRIVER_SLICE_NAMES.map((name) => {
    const callable = contract.callables.find((candidate) => candidate.name === name)
    assert(callable != null, `Missing PlatformDriver callable: ${name}`)
    return { id: callable.id, name }
  })
}

export function renderPlatformDriverUTS(platform: 'android' | 'ios'): string {
  const nativeImport = platform === 'android'
    ? "import { OpenIMCoreAdapter } from 'uts.sdk.modules.unixOpenimSdk'\n\n"
    : ''
  return `${nativeImport}export function driverCallAsync(
  callableID : number,
  operationID : string,
  requestJSON : string,
  resolve : (data : string) => void,
  reject : (errCode : number, errMsg : string) => void
) : void {
  OpenIMCoreAdapter.callAsync(callableID, operationID, requestJSON, resolve, reject)
}

export function driverCallSync(callableID : number, operationID : string, requestJSON : string) : string {
  return OpenIMCoreAdapter.callSync(callableID, operationID, requestJSON)
}

export function driverBindEventSink(
  sink : (eventName : string, payload : string, errCode : number, errMsg : string) => void
) : void {
  OpenIMCoreAdapter.bindEventSink(sink)
}
`
}

function bindingIDs(contract: ContractDocument): Record<PlatformDriverBinding['name'], number> {
  return Object.fromEntries(platformDriverBindings(contract).map((binding) => [binding.name, binding.id])) as Record<PlatformDriverBinding['name'], number>
}

function androidCoreAdapter(contract: ContractDocument): string {
  const ids = bindingIDs(contract)
  const loginUser = contract.callables.find((callable) => callable.name === 'getLoginUserID')
  assert(loginUser != null, 'Missing getLoginUserID PlatformDriver callable')
  const loginUserCall = loginUser.signature.includes('operationID?')
    ? 'NativeOpenIMSDK.getLoginUserID(operationID)'
    : 'NativeOpenIMSDK.getLoginUserID()'
  return `package uts.sdk.modules.unixOpenimSdk

import org.json.JSONObject

/** Generated contract-ID adapter. Lifecycle state and callback arbitration stay in DriverRuntime. */
object OpenIMCoreAdapter {
  private const val LOCAL_ERROR_CODE = -1

  private fun localFailure(reject: OpenIMReject, error: Throwable) {
    reject(LOCAL_ERROR_CODE, error.message ?: "OpenIM platform driver failure")
  }

  private fun sendMessage(
    requestJSON: String,
    operationID: String,
    withoutOss: Boolean,
    resolve: OpenIMResolveString,
    reject: OpenIMReject
  ) {
    val request = JSONObject(requestJSON)
    val message = request.getString("message")
    val recvID = request.getString("recvID")
    val groupID = request.getString("groupID")
    val offlinePushInfo = request.getString("offlinePushInfo")
    val isOnlineOnly = request.getBoolean("isOnlineOnly")
    if (withoutOss) {
      NativeOpenIMSDK.sendMessageNotOss(operationID, message, recvID, groupID, offlinePushInfo, isOnlineOnly, resolve, reject)
    } else {
      NativeOpenIMSDK.sendMessage(operationID, message, recvID, groupID, offlinePushInfo, isOnlineOnly, resolve, reject)
    }
  }

  fun callAsync(
    callableID: Number,
    operationID: String,
    requestJSON: String,
    resolve: OpenIMResolveString,
    reject: OpenIMReject
  ) {
    try {
      when (callableID.toInt()) {
        ${ids.initSDK} -> resolve(NativeOpenIMSDK.initSDK(operationID, requestJSON))
        ${ids.login} -> {
          val request = JSONObject(requestJSON)
          NativeOpenIMSDK.login(operationID, request.getString("userID"), request.getString("token"), resolve, reject)
        }
        ${ids.logout} -> NativeOpenIMSDK.logout(operationID, resolve, reject)
        ${ids.getLoginStatus} -> resolve(NativeOpenIMSDK.getLoginStatus(operationID))
        ${ids.getLoginUserID} -> resolve(${loginUserCall})
        ${ids.unInitSDK} -> resolve(NativeOpenIMSDK.unInitSDK(operationID))
        ${ids.createTextMessage} -> resolve(NativeOpenIMSDK.createTextMessage(operationID, JSONObject(requestJSON).getString("text")))
        ${ids.sendMessage} -> sendMessage(requestJSON, operationID, false, resolve, reject)
        ${ids.sendMessageNotOss} -> sendMessage(requestJSON, operationID, true, resolve, reject)
        else -> reject(LOCAL_ERROR_CODE, "Unsupported OpenIM callable ID: " + callableID.toString())
      }
    } catch (error: Throwable) {
      localFailure(reject, error)
    }
  }

  fun callSync(callableID: Number, operationID: String, requestJSON: String): String {
    return when (callableID.toInt()) {
      ${ids.getSdkVersion} -> NativeOpenIMSDK.getSdkVersion()
      else -> throw IllegalArgumentException("Unsupported OpenIM callable ID: " + callableID.toString())
    }
  }

  fun bindEventSink(sink: OpenIMNativeEvent) {
    NativeOpenIMSDK.bindNativeEvents(sink)
  }
}
`
}

function iosCoreAdapter(contract: ContractDocument): string {
  const ids = bindingIDs(contract)
  const loginUser = contract.callables.find((callable) => callable.name === 'getLoginUserID')
  assert(loginUser != null, 'Missing getLoginUserID PlatformDriver callable')
  const loginUserCall = loginUser.signature.includes('operationID?')
    ? 'NativeOpenIMSDK.getLoginUserID(operationID)'
    : 'NativeOpenIMSDK.getLoginUserID()'
  return `import Foundation

/// Generated contract-ID adapter. Lifecycle state and callback arbitration stay in DriverRuntime.
class OpenIMCoreAdapter {
    private static let localErrorCode = NSNumber(value: -1)

    private static func localFailure(_ reject: @escaping OpenIMReject, _ error: Error) {
        reject(localErrorCode, error.localizedDescription)
    }

    private static func requestObject(_ requestJSON: String) throws -> [String: Any] {
        let data = Data(requestJSON.utf8)
        guard let request = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NSError(domain: "OpenIMPlatformDriver", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid request JSON object"])
        }
        return request
    }

    private static func requiredString(_ request: [String: Any], _ name: String) throws -> String {
        guard let value = request[name] as? String else {
            throw NSError(domain: "OpenIMPlatformDriver", code: -1, userInfo: [NSLocalizedDescriptionKey: "Missing request string: \\(name)"])
        }
        return value
    }

    private static func loginRequest(_ requestJSON: String) throws -> (String, String) {
        let request = try requestObject(requestJSON)
        return (try requiredString(request, "userID"), try requiredString(request, "token"))
    }

    private static func sendMessage(
        _ requestJSON: String,
        _ operationID: String,
        _ withoutOss: Bool,
        _ resolve: @escaping OpenIMResolveString,
        _ reject: @escaping OpenIMReject
    ) throws {
        let request = try requestObject(requestJSON)
        let message = try requiredString(request, "message")
        let recvID = try requiredString(request, "recvID")
        let groupID = try requiredString(request, "groupID")
        let offlinePushInfo = try requiredString(request, "offlinePushInfo")
        guard let isOnlineOnly = request["isOnlineOnly"] as? Bool else {
            throw NSError(domain: "OpenIMPlatformDriver", code: -1, userInfo: [NSLocalizedDescriptionKey: "Missing request boolean: isOnlineOnly"])
        }
        if withoutOss {
            NativeOpenIMSDK.sendMessageNotOss(operationID, message, recvID, groupID, offlinePushInfo, isOnlineOnly, resolve, reject)
        } else {
            NativeOpenIMSDK.sendMessage(operationID, message, recvID, groupID, offlinePushInfo, isOnlineOnly, resolve, reject)
        }
    }

    static func callAsync(
        _ callableID: NSNumber,
        _ operationID: String,
        _ requestJSON: String,
        _ resolve: @escaping OpenIMResolveString,
        _ reject: @escaping OpenIMReject
    ) {
        do {
            switch callableID.intValue {
            case ${ids.initSDK}:
                resolve(NativeOpenIMSDK.initSDK(operationID, requestJSON))
            case ${ids.login}:
                let request = try loginRequest(requestJSON)
                NativeOpenIMSDK.login(operationID, request.0, request.1, resolve, reject)
            case ${ids.logout}:
                NativeOpenIMSDK.logout(operationID, resolve, reject)
            case ${ids.getLoginStatus}:
                resolve(NativeOpenIMSDK.getLoginStatus(operationID))
            case ${ids.getLoginUserID}:
                resolve(${loginUserCall})
            case ${ids.unInitSDK}:
                resolve(NativeOpenIMSDK.unInitSDK(operationID))
            case ${ids.createTextMessage}:
                let request = try requestObject(requestJSON)
                resolve(NativeOpenIMSDK.createTextMessage(operationID, try requiredString(request, "text")))
            case ${ids.sendMessage}:
                try sendMessage(requestJSON, operationID, false, resolve, reject)
            case ${ids.sendMessageNotOss}:
                try sendMessage(requestJSON, operationID, true, resolve, reject)
            default:
                reject(localErrorCode, "Unsupported OpenIM callable ID: \\(callableID)")
            }
        } catch {
            localFailure(reject, error)
        }
    }

    static func callSync(_ callableID: NSNumber, _ operationID: String, _ requestJSON: String) -> String {
        switch callableID.intValue {
        case ${ids.getSdkVersion}:
            return NativeOpenIMSDK.getSdkVersion()
        default:
            preconditionFailure("Unsupported OpenIM callable ID: \\(callableID)")
        }
    }

    static func bindEventSink(_ sink: @escaping OpenIMNativeEvent) {
        NativeOpenIMSDK.bindNativeEvents(sink)
    }
}
`
}

export function renderNativeCoreAdapter(contract: ContractDocument, platform: 'android' | 'ios'): string {
  return platform === 'android' ? androidCoreAdapter(contract) : iosCoreAdapter(contract)
}
