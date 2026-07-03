import Foundation
import OpenIMCore

typealias OpenIMResolveString = (String) -> Void
typealias OpenIMReject = (NSNumber, String) -> Void
typealias OpenIMNativeEvent = (String, String, NSNumber, String) -> Void
typealias OpenIMMessageEvent = (String, String) -> Void
typealias OpenIMConnEvent = (String, NSNumber, String) -> Void

class OpenIMBaseCallback: NSObject, Open_im_sdk_callbackBaseProtocol {
    private let resolve: OpenIMResolveString
    private let reject: OpenIMReject

    init(resolve: @escaping OpenIMResolveString, reject: @escaping OpenIMReject) {
        self.resolve = resolve
        self.reject = reject
    }

    func onSuccess(_ data: String?) {
        resolve(data ?? "")
    }

    func onError(_ errCode: Int32, errMsg: String?) {
        reject(NSNumber(value: errCode), errMsg ?? "")
    }
}

class OpenIMSendMessageCallback: NSObject, Open_im_sdk_callbackSendMsgCallBackProtocol {
    private let operationID: String
    private let resolve: OpenIMResolveString
    private let reject: OpenIMReject
    private let emit: OpenIMNativeEvent?

    init(operationID: String, resolve: @escaping OpenIMResolveString, reject: @escaping OpenIMReject, emit: OpenIMNativeEvent?) {
        self.operationID = operationID
        self.resolve = resolve
        self.reject = reject
        self.emit = emit
    }

    func onSuccess(_ data: String?) {
        resolve(data ?? "")
    }

    func onError(_ errCode: Int32, errMsg: String?) {
        reject(NSNumber(value: errCode), errMsg ?? "")
    }

    func onProgress(_ progress: Int) {
        let payload: [String: Any] = [
            "operationID": operationID,
            "progress": NSNumber(value: progress)
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [emit] in
            emit?("onSendMessageProgress", json, NSNumber(value: 0), "")
        }
    }
}

class OpenIMConnListener: NSObject, Open_im_sdk_callbackOnConnListenerProtocol {
    var emit: OpenIMConnEvent? = nil

    func onConnecting() {
        emit?("onConnecting", NSNumber(value: 0), "")
    }

    func onConnectSuccess() {
        emit?("onConnectSuccess", NSNumber(value: 0), "")
    }

    func onConnectFailed(_ errCode: Int32, errMsg: String?) {
        emit?("onConnectFailed", NSNumber(value: errCode), errMsg ?? "")
    }

    func onKickedOffline() {
        emit?("onKickedOffline", NSNumber(value: 0), "")
    }

    func onUserTokenExpired() {
        emit?("onUserTokenExpired", NSNumber(value: 0), "")
    }

    func onUserTokenInvalid(_ errMsg: String?) {
        emit?("onUserTokenInvalid", NSNumber(value: 0), errMsg ?? "")
    }
}

class OpenIMAdvancedMsgListenerNative: NSObject, Open_im_sdk_callbackOnAdvancedMsgListenerProtocol {
    private let emit: OpenIMMessageEvent

    init(emit: @escaping OpenIMMessageEvent) {
        self.emit = emit
    }

    func onRecvNewMessage(_ message: String?) {
        emit("onRecvNewMessage", message ?? "")
    }

    func onRecvOfflineNewMessage(_ message: String?) {
        emit("onRecvOfflineNewMessage", message ?? "")
    }

    func onRecvOnlineOnlyMessage(_ message: String?) {
        emit("onRecvOnlineOnlyMessage", message ?? "")
    }

    func onMsgDeleted(_ message: String?) {
        emit("onMsgDeleted", message ?? "")
    }

    func onNewRecvMessageRevoked(_ messageRevoked: String?) {
        emit("onNewRecvMessageRevoked", messageRevoked ?? "")
    }

    func onRecvC2CReadReceipt(_ msgReceiptList: String?) {
        emit("onRecvC2CReadReceipt", msgReceiptList ?? "")
    }
}

class OpenIMConversationListenerNative: NSObject, Open_im_sdk_callbackOnConversationListenerProtocol {
    private let emit: OpenIMMessageEvent
    init(emit: @escaping OpenIMMessageEvent) { self.emit = emit }
    func onConversationChanged(_ conversationList: String?) { emit("onConversationChanged", conversationList ?? "") }
    func onConversationUserInputStatusChanged(_ change: String?) { emit("onConversationUserInputStatusChanged", change ?? "") }
    func onNewConversation(_ conversationList: String?) { emit("onNewConversation", conversationList ?? "") }
    func onSyncServerFailed(_ reinstalled: Bool) { emit("onSyncServerFailed", reinstalled ? "true" : "false") }
    func onSyncServerFinish(_ reinstalled: Bool) { emit("onSyncServerFinish", reinstalled ? "true" : "false") }
    func onSyncServerProgress(_ progress: Int) { emit("onSyncServerProgress", String(progress)) }
    func onSyncServerStart(_ reinstalled: Bool) { emit("onSyncServerStart", reinstalled ? "true" : "false") }
    func onTotalUnreadMessageCountChanged(_ totalUnreadCount: Int32) { emit("onTotalUnreadMessageCountChanged", String(totalUnreadCount)) }
}

class OpenIMCustomBusinessListenerNative: NSObject, Open_im_sdk_callbackOnCustomBusinessListenerProtocol {
    private let emit: OpenIMMessageEvent
    init(emit: @escaping OpenIMMessageEvent) { self.emit = emit }
    func onRecvCustomBusinessMessage(_ businessMessage: String?) { emit("onRecvCustomBusinessMessage", businessMessage ?? "") }
}

class OpenIMFriendshipListenerNative: NSObject, Open_im_sdk_callbackOnFriendshipListenerProtocol {
    private let emit: OpenIMMessageEvent
    init(emit: @escaping OpenIMMessageEvent) { self.emit = emit }
    func onBlackAdded(_ blackInfo: String?) { emit("onBlackAdded", blackInfo ?? "") }
    func onBlackDeleted(_ blackInfo: String?) { emit("onBlackDeleted", blackInfo ?? "") }
    func onFriendAdded(_ friendInfo: String?) { emit("onFriendAdded", friendInfo ?? "") }
    func onFriendApplicationAccepted(_ friendApplication: String?) { emit("onFriendApplicationAccepted", friendApplication ?? "") }
    func onFriendApplicationAdded(_ friendApplication: String?) { emit("onFriendApplicationAdded", friendApplication ?? "") }
    func onFriendApplicationDeleted(_ friendApplication: String?) { emit("onFriendApplicationDeleted", friendApplication ?? "") }
    func onFriendApplicationRejected(_ friendApplication: String?) { emit("onFriendApplicationRejected", friendApplication ?? "") }
    func onFriendDeleted(_ friendInfo: String?) { emit("onFriendDeleted", friendInfo ?? "") }
    func onFriendInfoChanged(_ friendInfo: String?) { emit("onFriendInfoChanged", friendInfo ?? "") }
}

class OpenIMGroupListenerNative: NSObject, Open_im_sdk_callbackOnGroupListenerProtocol {
    private let emit: OpenIMMessageEvent
    init(emit: @escaping OpenIMMessageEvent) { self.emit = emit }
    func onGroupApplicationAccepted(_ groupApplication: String?) { emit("onGroupApplicationAccepted", groupApplication ?? "") }
    func onGroupApplicationAdded(_ groupApplication: String?) { emit("onGroupApplicationAdded", groupApplication ?? "") }
    func onGroupApplicationDeleted(_ groupApplication: String?) { emit("onGroupApplicationDeleted", groupApplication ?? "") }
    func onGroupApplicationRejected(_ groupApplication: String?) { emit("onGroupApplicationRejected", groupApplication ?? "") }
    func onGroupDismissed(_ groupInfo: String?) { emit("onGroupDismissed", groupInfo ?? "") }
    func onGroupInfoChanged(_ groupInfo: String?) { emit("onGroupInfoChanged", groupInfo ?? "") }
    func onGroupMemberAdded(_ groupMemberInfo: String?) { emit("onGroupMemberAdded", groupMemberInfo ?? "") }
    func onGroupMemberDeleted(_ groupMemberInfo: String?) { emit("onGroupMemberDeleted", groupMemberInfo ?? "") }
    func onGroupMemberInfoChanged(_ groupMemberInfo: String?) { emit("onGroupMemberInfoChanged", groupMemberInfo ?? "") }
    func onJoinedGroupAdded(_ groupInfo: String?) { emit("onJoinedGroupAdded", groupInfo ?? "") }
    func onJoinedGroupDeleted(_ groupInfo: String?) { emit("onJoinedGroupDeleted", groupInfo ?? "") }
}

class OpenIMUserListenerNative: NSObject, Open_im_sdk_callbackOnUserListenerProtocol {
    private let emit: OpenIMMessageEvent
    init(emit: @escaping OpenIMMessageEvent) { self.emit = emit }
    func onSelfInfoUpdated(_ userInfo: String?) { emit("onSelfInfoUpdated", userInfo ?? "") }
    func onUserCommandAdd(_ userCommand: String?) { emit("onUserCommandAdd", userCommand ?? "") }
    func onUserCommandDelete(_ userCommand: String?) { emit("onUserCommandDelete", userCommand ?? "") }
    func onUserCommandUpdate(_ userCommand: String?) { emit("onUserCommandUpdate", userCommand ?? "") }
    func onUserStatusChanged(_ userOnlineStatus: String?) { emit("onUserStatusChanged", userOnlineStatus ?? "") }
}

class OpenIMUploadFileCallback: NSObject, Open_im_sdk_callbackUploadFileCallbackProtocol {
    private let operationID: String
    private let emit: OpenIMMessageEvent

    init(operationID: String, emit: @escaping OpenIMMessageEvent) {
        self.operationID = operationID
        self.emit = emit
    }

    private func emitProgress(_ stage: String, _ fields: [String: Any]) {
        var payload = fields
        payload["operationID"] = operationID
        payload["stage"] = stage
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [emit] in
            emit("onUploadFileProgress", json)
        }
    }

    func complete(_ size: Int64, url: String?, typ: Int) {
    }

    func hashPartComplete(_ partsHash: String?, fileHash: String?) {
    }

    func hashPartProgress(_ index: Int, size: Int64, partHash: String?) {
    }

    func open(_ size: Int64) {
    }

    func partSize(_ partSize: Int64, num: Int) {
    }

    func uploadComplete(_ fileSize: Int64, streamSize: Int64, storageSize: Int64) {
        emitProgress("uploadComplete", [
            "total": NSNumber(value: fileSize),
            "current": NSNumber(value: streamSize),
            "storageSize": NSNumber(value: storageSize)
        ])
    }

    func uploadID(_ uploadID: String?) {
    }

    func uploadPartComplete(_ index: Int, partSize: Int64, partHash: String?) {
    }
}

class OpenIMUploadLogProgress: NSObject, Open_im_sdk_callbackUploadLogProgressProtocol {
    private let operationID: String
    private let emit: OpenIMMessageEvent

    init(operationID: String, emit: @escaping OpenIMMessageEvent) {
        self.operationID = operationID
        self.emit = emit
    }

    func onProgress(_ current: Int64, size: Int64) {
        let percent = size > 0 ? Double(current) * 100.0 / Double(size) : 0.0
        let payload: [String: Any] = [
            "operationID": operationID,
            "current": NSNumber(value: current),
            "size": NSNumber(value: size),
            "percent": NSNumber(value: percent)
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [emit] in
            emit("onUploadLogsProgress", json)
        }
    }
}

class NativeOpenIMSDK {
    private static let connListener = OpenIMConnListener()
    private static var advancedMsgListener: OpenIMAdvancedMsgListenerNative? = nil
    private static var conversationListener: OpenIMConversationListenerNative? = nil
    private static var customBusinessListener: OpenIMCustomBusinessListenerNative? = nil
    private static var friendshipListener: OpenIMFriendshipListenerNative? = nil
    private static var groupListener: OpenIMGroupListenerNative? = nil
    private static var userListener: OpenIMUserListenerNative? = nil
    private static var nativeEventEmit: OpenIMNativeEvent? = nil
    private static var sdkInitialized: Bool = false

    static func uploadFile(_ operationID: String, _ uploadData: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        let uploadCallback = OpenIMUploadFileCallback(operationID: operationID) { eventName, payload in
            NativeOpenIMSDK.nativeEventEmit?(eventName, payload, NSNumber(value: 0), "")
        }
        Open_im_sdkUploadFile(callback, operationID, uploadData, uploadCallback)
    }

    static func initSDK(_ operationID: String, _ config: String) -> String {
        let initialized = Open_im_sdkInitSDK(connListener, operationID, config)
        sdkInitialized = initialized
        if initialized {
            applyNativeEventListeners()
        }
        return initialized ? "true" : "false"
    }

    static func getLoginStatus(_ operationID: String) -> String {
        return String(Open_im_sdkGetLoginStatus(operationID))
    }

    static func getLoginUserID() -> String {
        return Open_im_sdkGetLoginUserID()
    }

    static func getSdkVersion() -> String {
        return Open_im_sdkGetSdkVersion()
    }

    static func unInitSDK(_ operationID: String) -> String {
        Open_im_sdkUnInitSDK(operationID)
        sdkInitialized = false
        return ""
    }

    static func login(_ operationID: String, _ userID: String, _ token: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkLogin(callback, operationID, userID, token)
    }

    static func logout(_ operationID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkLogout(callback, operationID)
    }

    static func getAllConversationList(_ operationID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetAllConversationList(callback, operationID)
    }

    static func getOneConversation(_ operationID: String, _ sessionType: NSNumber, _ sourceID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetOneConversation(callback, operationID, sessionType.int32Value, sourceID)
    }

    static func getAdvancedHistoryMessageList(_ operationID: String, _ options: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetAdvancedHistoryMessageList(callback, operationID, options)
    }

    static func getSpecifiedGroupsInfo(_ operationID: String, _ groupIDList: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetSpecifiedGroupsInfo(callback, operationID, groupIDList)
    }

    static func deleteConversationAndDeleteAllMsg(_ operationID: String, _ conversationID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkDeleteConversationAndDeleteAllMsg(callback, operationID, conversationID)
    }

    static func markConversationMessageAsRead(_ operationID: String, _ conversationID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkMarkConversationMessageAsRead(callback, operationID, conversationID)
    }

    static func getGroupMemberList(_ operationID: String, _ groupID: String, _ filter: NSNumber, _ offset: NSNumber, _ count: NSNumber, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetGroupMemberList(callback, operationID, groupID, filter.int32Value, offset.int32Value, count.int32Value)
    }

    static func setMessageLocalEx(_ operationID: String, _ conversationID: String, _ clientMsgID: String, _ localEx: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkSetMessageLocalEx(callback, operationID, conversationID, clientMsgID, localEx)
    }

    static func revokeMessage(_ operationID: String, _ conversationID: String, _ clientMsgID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkRevokeMessage(callback, operationID, conversationID, clientMsgID)
    }

    private static func buildSetConversationPayload(_ rawParams: String) -> String {
        guard let data = rawParams.data(using: .utf8),
              let rawObject = try? JSONSerialization.jsonObject(with: data),
              let raw = rawObject as? [String: Any] else {
            return "{}"
        }

        var payload: [String: Any] = [:]
        let numberFields = ["recvMsgOpt", "burnDuration", "groupAtType"]
        for field in numberFields {
            guard let value = raw[field], !(value is NSNull) else { continue }
            if let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() {
                payload[field] = number
            }
        }

        let boolFields = ["isPinned", "isPrivateChat"]
        for field in boolFields {
            guard let value = raw[field], !(value is NSNull) else { continue }
            if let boolValue = value as? Bool {
                payload[field] = boolValue
            }
        }

        if let value = raw["ex"], !(value is NSNull), let ex = value as? String {
            payload["ex"] = ex
        }

        guard JSONSerialization.isValidJSONObject(payload),
              let payloadData = try? JSONSerialization.data(withJSONObject: payload),
              let payloadString = String(data: payloadData, encoding: .utf8) else {
            return "{}"
        }
        return payloadString
    }

    private static func buildSetSelfInfoPayload(_ rawParams: String) -> String {
        guard let data = rawParams.data(using: .utf8),
              let rawObject = try? JSONSerialization.jsonObject(with: data),
              let raw = rawObject as? [String: Any] else {
            return "{}"
        }

        var payload: [String: Any] = [:]
        let stringFields = ["nickname", "faceURL", "ex"]
        for field in stringFields {
            guard let value = raw[field], !(value is NSNull) else { continue }
            if let stringValue = value as? String {
                payload[field] = stringValue
            }
        }

        if let value = raw["globalRecvMsgOpt"], !(value is NSNull), let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() {
            payload["globalRecvMsgOpt"] = number
        }

        guard JSONSerialization.isValidJSONObject(payload),
              let payloadData = try? JSONSerialization.data(withJSONObject: payload),
              let payloadString = String(data: payloadData, encoding: .utf8) else {
            return "{}"
        }
        return payloadString
    }

    private static func buildSetGroupInfoPayload(_ rawParams: String) -> String {
        guard let data = rawParams.data(using: .utf8),
              let rawObject = try? JSONSerialization.jsonObject(with: data),
              let raw = rawObject as? [String: Any] else {
            return "{}"
        }

        var payload: [String: Any] = [:]
        let stringFields = ["groupID", "groupName", "notification", "introduction", "faceURL", "ex"]
        for field in stringFields {
            guard let value = raw[field], !(value is NSNull) else { continue }
            if let stringValue = value as? String {
                payload[field] = stringValue
            }
        }

        let numberFields = ["needVerification", "lookMemberInfo", "applyMemberFriend"]
        for field in numberFields {
            guard let value = raw[field], !(value is NSNull) else { continue }
            if let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() {
                payload[field] = number
            }
        }

        if let value = raw["displayIsRead"], !(value is NSNull), let boolValue = value as? Bool {
            payload["displayIsRead"] = boolValue
        }

        guard JSONSerialization.isValidJSONObject(payload),
              let payloadData = try? JSONSerialization.data(withJSONObject: payload),
              let payloadString = String(data: payloadData, encoding: .utf8) else {
            return "{}"
        }
        return payloadString
    }

    private static func buildSetGroupMemberInfoPayload(_ rawParams: String) -> String {
        guard let data = rawParams.data(using: .utf8),
              let rawObject = try? JSONSerialization.jsonObject(with: data),
              let raw = rawObject as? [String: Any] else {
            return "{}"
        }

        var payload: [String: Any] = [:]
        let stringFields = ["groupID", "userID", "nickname", "faceURL", "ex"]
        for field in stringFields {
            guard let value = raw[field], !(value is NSNull) else { continue }
            if let stringValue = value as? String {
                payload[field] = stringValue
            }
        }

        if let value = raw["roleLevel"], !(value is NSNull), let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() {
            payload["roleLevel"] = number
        }

        guard JSONSerialization.isValidJSONObject(payload),
              let payloadData = try? JSONSerialization.data(withJSONObject: payload),
              let payloadString = String(data: payloadData, encoding: .utf8) else {
            return "{}"
        }
        return payloadString
    }

    private static func buildUpdateFriendsPayload(_ rawParams: String) -> String {
        guard let data = rawParams.data(using: .utf8),
              let rawObject = try? JSONSerialization.jsonObject(with: data),
              let raw = rawObject as? [String: Any] else {
            return "{}"
        }

        var payload: [String: Any] = [:]
        if let list = raw["friendUserIDs"] as? [Any] {
            let ids = list.compactMap { $0 as? String }
            payload["friendUserIDs"] = ids
        }

        if let value = raw["isPinned"], !(value is NSNull), let boolValue = value as? Bool {
            payload["isPinned"] = boolValue
        }

        let stringFields = ["remark", "ex"]
        for field in stringFields {
            guard let value = raw[field], !(value is NSNull) else { continue }
            if let stringValue = value as? String {
                payload[field] = stringValue
            }
        }

        guard JSONSerialization.isValidJSONObject(payload),
              let payloadData = try? JSONSerialization.data(withJSONObject: payload),
              let payloadString = String(data: payloadData, encoding: .utf8) else {
            return "{}"
        }
        return payloadString
    }

    static func setConversation(_ operationID: String, _ conversationID: String, _ conversation: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let payload = buildSetConversationPayload(conversation)
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkSetConversation(callback, operationID, conversationID, payload)
    }

    static func setAppBackgroundStatus(_ operationID: String, _ isBackground: Bool, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkSetAppBackgroundStatus(callback, operationID, isBackground)
    }

    static func setAppBadge(_ operationID: String, _ count: NSNumber, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkSetAppBadge(callback, operationID, count.int32Value)
    }

    static func networkStatusChanged(_ operationID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkNetworkStatusChanged(callback, operationID)
    }

    static func getSelfUserInfo(_ operationID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetSelfUserInfo(callback, operationID)
    }

    static func getUsersInfo(_ operationID: String, _ userIDList: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetUsersInfo(callback, operationID, userIDList)
    }

    static func setSelfInfo(_ operationID: String, _ userInfo: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let payload = buildSetSelfInfoPayload(userInfo)
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkSetSelfInfo(callback, operationID, payload)
    }

    static func deleteMessageFromLocalStorage(_ operationID: String, _ conversationID: String, _ clientMsgID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkDeleteMessageFromLocalStorage(callback, operationID, conversationID, clientMsgID)
    }

    static func deleteMessage(_ operationID: String, _ conversationID: String, _ clientMsgID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkDeleteMessage(callback, operationID, conversationID, clientMsgID)
    }

    static func deleteAllMsgFromLocal(_ operationID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkDeleteAllMsgFromLocal(callback, operationID)
    }

    static func deleteAllMsgFromLocalAndSvr(_ operationID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkDeleteAllMsgFromLocalAndSvr(callback, operationID)
    }

    static func insertSingleMessageToLocalStorage(_ operationID: String, _ message: String, _ recvID: String, _ sendID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkInsertSingleMessageToLocalStorage(callback, operationID, message, recvID, sendID)
    }

    static func insertGroupMessageToLocalStorage(_ operationID: String, _ message: String, _ groupID: String, _ sendID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkInsertGroupMessageToLocalStorage(callback, operationID, message, groupID, sendID)
    }

    static func changeInputStates(_ operationID: String, _ conversationID: String, _ focus: Bool, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkChangeInputStates(callback, operationID, conversationID, focus)
    }

    static func getInputStates(_ operationID: String, _ conversationID: String, _ userID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetInputStates(callback, operationID, conversationID, userID)
    }

    static func clearConversationAndDeleteAllMsg(_ operationID: String, _ conversationID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkClearConversationAndDeleteAllMsg(callback, operationID, conversationID)
    }

    static func hideConversation(_ operationID: String, _ conversationID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkHideConversation(callback, operationID, conversationID)
    }

    static func hideAllConversations(_ operationID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkHideAllConversations(callback, operationID)
    }

    static func markAllConversationMessageAsRead(_ operationID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkMarkAllConversationMessageAsRead(callback, operationID)
    }

    static func searchConversation(_ operationID: String, _ searchParam: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkSearchConversation(callback, operationID, searchParam)
    }

    static func getConversationListSplit(_ operationID: String, _ offset: NSNumber, _ count: NSNumber, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetConversationListSplit(callback, operationID, offset.intValue, count.intValue)
    }

    static func getMultipleConversation(_ operationID: String, _ conversationIDList: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetMultipleConversation(callback, operationID, conversationIDList)
    }

    static func setConversationDraft(_ operationID: String, _ conversationID: String, _ draftText: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkSetConversationDraft(callback, operationID, conversationID, draftText)
    }

    static func getTotalUnreadMsgCount(_ operationID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetTotalUnreadMsgCount(callback, operationID)
    }

    static func searchLocalMessages(_ operationID: String, _ searchParam: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkSearchLocalMessages(callback, operationID, searchParam)
    }

    static func addFriend(_ operationID: String, _ friendApplication: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkAddFriend(callback, operationID, friendApplication)
    }

    static func searchFriends(_ operationID: String, _ searchParam: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkSearchFriends(callback, operationID, searchParam)
    }

    static func getSpecifiedFriendsInfo(_ operationID: String, _ userIDList: String, _ filterBlack: Bool, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetSpecifiedFriendsInfo(callback, operationID, userIDList, filterBlack)
    }

    static func getFriendApplicationListAsRecipient(_ operationID: String, _ pagination: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetFriendApplicationListAsRecipient(callback, operationID, pagination)
    }

    static func getFriendApplicationListAsApplicant(_ operationID: String, _ pagination: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetFriendApplicationListAsApplicant(callback, operationID, pagination)
    }

    static func getFriendApplicationUnhandledCount(_ operationID: String, _ time: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetFriendApplicationUnhandledCount(callback, operationID, time)
    }

    static func getFriendList(_ operationID: String, _ filterBlack: Bool, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetFriendList(callback, operationID, filterBlack)
    }

    static func getFriendListPage(_ operationID: String, _ offset: NSNumber, _ count: NSNumber, _ filterBlack: Bool, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetFriendListPage(callback, operationID, offset.int32Value, count.int32Value, filterBlack)
    }

    static func updateFriends(_ operationID: String, _ friendInfoList: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let payload = buildUpdateFriendsPayload(friendInfoList)
        print("openim updateFriends native payload \(operationID) \(payload)")
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkUpdateFriends(callback, operationID, payload)
    }

    static func checkFriend(_ operationID: String, _ userIDList: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkCheckFriend(callback, operationID, userIDList)
    }

    static func acceptFriendApplication(_ operationID: String, _ friendApplication: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkAcceptFriendApplication(callback, operationID, friendApplication)
    }

    static func refuseFriendApplication(_ operationID: String, _ friendApplication: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkRefuseFriendApplication(callback, operationID, friendApplication)
    }

    static func deleteFriend(_ operationID: String, _ userID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkDeleteFriend(callback, operationID, userID)
    }

    static func addBlack(_ operationID: String, _ userID: String, _ ex: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkAddBlack(callback, operationID, userID, ex)
    }

    static func removeBlack(_ operationID: String, _ userID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkRemoveBlack(callback, operationID, userID)
    }

    static func getBlackList(_ operationID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetBlackList(callback, operationID)
    }

    static func inviteUserToGroup(_ operationID: String, _ groupID: String, _ reason: String, _ userIDList: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkInviteUserToGroup(callback, operationID, groupID, reason, userIDList)
    }

    static func kickGroupMember(_ operationID: String, _ groupID: String, _ reason: String, _ userIDList: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkKickGroupMember(callback, operationID, groupID, reason, userIDList)
    }

    static func isJoinGroup(_ operationID: String, _ groupID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkIsJoinGroup(callback, operationID, groupID)
    }

    static func getSpecifiedGroupMembersInfo(_ operationID: String, _ groupID: String, _ userIDList: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetSpecifiedGroupMembersInfo(callback, operationID, groupID, userIDList)
    }

    static func getUsersInGroup(_ operationID: String, _ groupID: String, _ userIDList: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetUsersInGroup(callback, operationID, groupID, userIDList)
    }

    static func searchGroupMembers(_ operationID: String, _ searchParam: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkSearchGroupMembers(callback, operationID, searchParam)
    }

    static func getJoinedGroupList(_ operationID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetJoinedGroupList(callback, operationID)
    }

    static func getJoinedGroupListPage(_ operationID: String, _ offset: NSNumber, _ count: NSNumber, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetJoinedGroupListPage(callback, operationID, offset.int32Value, count.int32Value)
    }

    static func createGroup(_ operationID: String, _ groupInfo: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkCreateGroup(callback, operationID, groupInfo)
    }

    static func setGroupInfo(_ operationID: String, _ groupInfo: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let payload = buildSetGroupInfoPayload(groupInfo)
        print("openim setGroupInfo native payload \(operationID) \(payload)")
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkSetGroupInfo(callback, operationID, payload)
    }

    static func setGroupMemberInfo(_ operationID: String, _ groupMemberInfo: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let payload = buildSetGroupMemberInfoPayload(groupMemberInfo)
        print("openim setGroupMemberInfo native payload \(operationID) \(payload)")
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkSetGroupMemberInfo(callback, operationID, payload)
    }

    static func joinGroup(_ operationID: String, _ groupID: String, _ reason: String, _ joinSource: NSNumber, _ ex: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkJoinGroup(callback, operationID, groupID, reason, joinSource.int32Value, ex)
    }

    static func searchGroups(_ operationID: String, _ searchParam: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkSearchGroups(callback, operationID, searchParam)
    }

    static func quitGroup(_ operationID: String, _ groupID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkQuitGroup(callback, operationID, groupID)
    }

    static func dismissGroup(_ operationID: String, _ groupID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkDismissGroup(callback, operationID, groupID)
    }

    static func changeGroupMute(_ operationID: String, _ groupID: String, _ isMute: Bool, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkChangeGroupMute(callback, operationID, groupID, isMute)
    }

    static func changeGroupMemberMute(_ operationID: String, _ groupID: String, _ userID: String, _ mutedSeconds: NSNumber, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkChangeGroupMemberMute(callback, operationID, groupID, userID, mutedSeconds.intValue)
    }

    static func transferGroupOwner(_ operationID: String, _ groupID: String, _ newOwnerUserID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkTransferGroupOwner(callback, operationID, groupID, newOwnerUserID)
    }

    static func getGroupApplicationListAsApplicant(_ operationID: String, _ pagination: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetGroupApplicationListAsApplicant(callback, operationID, pagination)
    }

    static func getGroupApplicationListAsRecipient(_ operationID: String, _ pagination: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetGroupApplicationListAsRecipient(callback, operationID, pagination)
    }

    static func getGroupApplicationUnhandledCount(_ operationID: String, _ time: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetGroupApplicationUnhandledCount(callback, operationID, time)
    }

    static func acceptGroupApplication(_ operationID: String, _ groupID: String, _ userID: String, _ handleMsg: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkAcceptGroupApplication(callback, operationID, groupID, userID, handleMsg)
    }

    static func refuseGroupApplication(_ operationID: String, _ groupID: String, _ userID: String, _ handleMsg: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkRefuseGroupApplication(callback, operationID, groupID, userID, handleMsg)
    }

    static func getGroupMemberOwnerAndAdmin(_ operationID: String, _ groupID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetGroupMemberOwnerAndAdmin(callback, operationID, groupID)
    }

    static func findMessageList(_ operationID: String, _ searchParam: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkFindMessageList(callback, operationID, searchParam)
    }

    static func updateFcmToken(_ operationID: String, _ fcmToken: String, _ expireTime: NSNumber, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkUpdateFcmToken(callback, operationID, fcmToken, expireTime.int64Value)
    }

    static func uploadLogs(_ operationID: String, _ line: NSNumber, _ ex: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        let progress = OpenIMUploadLogProgress(operationID: operationID) { eventName, payload in
            NativeOpenIMSDK.nativeEventEmit?(eventName, payload, NSNumber(value: 0), "")
        }
        Open_im_sdkUploadLogs(callback, operationID, line.intValue, ex, progress)
    }

    static func subscribeUsersStatus(_ operationID: String, _ userIDList: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkSubscribeUsersStatus(callback, operationID, userIDList)
    }

    static func unsubscribeUsersStatus(_ operationID: String, _ userIDList: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkUnsubscribeUsersStatus(callback, operationID, userIDList)
    }

    static func getUserStatus(_ operationID: String, _ userIDList: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetUserStatus(callback, operationID, userIDList)
    }

    static func getSubscribeUsersStatus(_ operationID: String, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMBaseCallback(resolve: resolve, reject: reject)
        Open_im_sdkGetSubscribeUsersStatus(callback, operationID)
    }

    static func sendMessage(_ operationID: String, _ message: String, _ recvID: String, _ groupID: String, _ offlinePushInfo: String, _ isOnlineOnly: Bool, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMSendMessageCallback(operationID: operationID, resolve: resolve, reject: reject, emit: NativeOpenIMSDK.nativeEventEmit)
        Open_im_sdkSendMessage(callback, operationID, message, recvID, groupID, offlinePushInfo, isOnlineOnly)
    }

    static func sendMessageNotOss(_ operationID: String, _ message: String, _ recvID: String, _ groupID: String, _ offlinePushInfo: String, _ isOnlineOnly: Bool, _ resolve: @escaping OpenIMResolveString, _ reject: @escaping OpenIMReject) {
        let callback = OpenIMSendMessageCallback(operationID: operationID, resolve: resolve, reject: reject, emit: NativeOpenIMSDK.nativeEventEmit)
        Open_im_sdkSendMessageNotOss(callback, operationID, message, recvID, groupID, offlinePushInfo, isOnlineOnly)
    }

    static func createTextMessage(_ operationID: String, _ text: String) -> String {
        return Open_im_sdkCreateTextMessage(operationID, text)
    }

    static func createImageMessageFromFullPath(_ operationID: String, _ imageFullPath: String) -> String {
        return Open_im_sdkCreateImageMessageFromFullPath(operationID, imageFullPath)
    }

    static func createImageMessageByURL(_ operationID: String, _ sourcePath: String, _ sourcePicture: String, _ bigPicture: String, _ snapshotPicture: String) -> String {
        return Open_im_sdkCreateImageMessageByURL(operationID, sourcePath, sourcePicture, bigPicture, snapshotPicture)
    }

    static func createCustomMessage(_ operationID: String, _ data: String, _ extensionInfo: String, _ descriptionText: String) -> String {
        return Open_im_sdkCreateCustomMessage(operationID, data, extensionInfo, descriptionText)
    }

    static func createQuoteMessage(_ operationID: String, _ text: String, _ message: String) -> String {
        return Open_im_sdkCreateQuoteMessage(operationID, text, message)
    }

    static func createAdvancedQuoteMessage(_ operationID: String, _ text: String, _ message: String, _ messageEntityList: String) -> String {
        return Open_im_sdkCreateAdvancedQuoteMessage(operationID, text, message, messageEntityList)
    }

    static func createAdvancedTextMessage(_ operationID: String, _ text: String, _ messageEntityList: String) -> String {
        return Open_im_sdkCreateAdvancedTextMessage(operationID, text, messageEntityList)
    }

    static func createTextAtMessage(_ operationID: String, _ text: String, _ atUserIDList: String, _ atUsersInfo: String, _ message: String) -> String {
        return Open_im_sdkCreateTextAtMessage(operationID, text, atUserIDList, atUsersInfo, message)
    }

    static func createSoundMessageByURL(_ operationID: String, _ soundInfo: String) -> String {
        return Open_im_sdkCreateSoundMessageByURL(operationID, soundInfo)
    }

    static func createSoundMessageFromFullPath(_ operationID: String, _ soundPath: String, _ duration: NSNumber) -> String {
        return Open_im_sdkCreateSoundMessageFromFullPath(operationID, soundPath, duration.int64Value)
    }

    static func createVideoMessageByURL(_ operationID: String, _ videoInfo: String) -> String {
        return Open_im_sdkCreateVideoMessageByURL(operationID, videoInfo)
    }

    static func createVideoMessageFromFullPath(_ operationID: String, _ videoFullPath: String, _ videoType: String, _ duration: NSNumber, _ snapshotFullPath: String) -> String {
        return Open_im_sdkCreateVideoMessageFromFullPath(operationID, videoFullPath, videoType, duration.int64Value, snapshotFullPath)
    }

    static func createFileMessageByURL(_ operationID: String, _ fileInfo: String) -> String {
        return Open_im_sdkCreateFileMessageByURL(operationID, fileInfo)
    }

    static func createFileMessageFromFullPath(_ operationID: String, _ fileFullPath: String, _ fileName: String) -> String {
        return Open_im_sdkCreateFileMessageFromFullPath(operationID, fileFullPath, fileName)
    }

    static func createMergerMessage(_ operationID: String, _ messageList: String, _ title: String, _ abstractList: String) -> String {
        return Open_im_sdkCreateMergerMessage(operationID, messageList, title, abstractList)
    }

    static func createForwardMessage(_ operationID: String, _ message: String) -> String {
        return Open_im_sdkCreateForwardMessage(operationID, message)
    }

    static func createFaceMessage(_ operationID: String, _ index: NSNumber, _ data: String) -> String {
        return Open_im_sdkCreateFaceMessage(operationID, index.intValue, data)
    }

    static func createLocationMessage(_ operationID: String, _ descriptionText: String, _ longitude: NSNumber, _ latitude: NSNumber) -> String {
        return Open_im_sdkCreateLocationMessage(operationID, descriptionText, longitude.doubleValue, latitude.doubleValue)
    }

    static func createCardMessage(_ operationID: String, _ cardInfo: String) -> String {
        return Open_im_sdkCreateCardMessage(operationID, cardInfo)
    }

    static func getConversationIDBySessionType(_ operationID: String, _ sourceID: String, _ sessionType: NSNumber) -> String {
        return Open_im_sdkGetConversationIDBySessionType(operationID, sourceID, sessionType.intValue)
    }

    private static func applyNativeEventListeners() {
        guard let emit = nativeEventEmit else { return }
        let connEmit: OpenIMConnEvent = { eventName, errCode, errMsg in
            emit(eventName, "", errCode, errMsg)
        }
        let messageEmit: OpenIMMessageEvent = { eventName, payload in
            emit(eventName, payload, NSNumber(value: 0), "")
        }
        connListener.emit = connEmit
        advancedMsgListener = OpenIMAdvancedMsgListenerNative(emit: messageEmit)
        conversationListener = OpenIMConversationListenerNative(emit: messageEmit)
        customBusinessListener = OpenIMCustomBusinessListenerNative(emit: messageEmit)
        friendshipListener = OpenIMFriendshipListenerNative(emit: messageEmit)
        groupListener = OpenIMGroupListenerNative(emit: messageEmit)
        userListener = OpenIMUserListenerNative(emit: messageEmit)
        Open_im_sdkSetAdvancedMsgListener(advancedMsgListener)
        Open_im_sdkSetConversationListener(conversationListener)
        Open_im_sdkSetCustomBusinessListener(customBusinessListener)
        Open_im_sdkSetFriendListener(friendshipListener)
        Open_im_sdkSetGroupListener(groupListener)
        Open_im_sdkSetUserListener(userListener)
    }

    static func bindNativeEvents(_ emit: @escaping OpenIMNativeEvent) {
        nativeEventEmit = emit
        connListener.emit = { eventName, errCode, errMsg in
            emit(eventName, "", errCode, errMsg)
        }
        if sdkInitialized {
            applyNativeEventListeners()
        }
    }
}
