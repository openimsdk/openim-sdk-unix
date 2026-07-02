package uts.sdk.modules.unixOpenimSdk

import open_im_sdk.Open_im_sdk
import open_im_sdk_callback.Base
import open_im_sdk_callback.OnBatchMsgListener
import open_im_sdk_callback.OnAdvancedMsgListener
import open_im_sdk_callback.OnConnListener
import open_im_sdk_callback.OnConversationListener
import open_im_sdk_callback.OnCustomBusinessListener
import open_im_sdk_callback.OnFriendshipListener
import open_im_sdk_callback.OnGroupListener
import open_im_sdk_callback.OnUserListener
import open_im_sdk_callback.SendMsgCallBack
import open_im_sdk_callback.UploadFileCallback
import open_im_sdk_callback.UploadLogProgress
import org.json.JSONArray
import org.json.JSONObject

typealias OpenIMResolveString = (String) -> Unit
typealias OpenIMReject = (Number, String) -> Unit
typealias OpenIMNativeEvent = (String, String, Number, String) -> Unit
typealias OpenIMMessageEvent = (String, String) -> Unit
typealias OpenIMConnEvent = (String, Number, String) -> Unit

class OpenIMBaseCallback(
  private val resolve: OpenIMResolveString,
  private val reject: OpenIMReject
) : Base {
  override fun onSuccess(data: String?) {
    resolve(data ?: "")
  }

  override fun onError(errCode: Int, errMsg: String?) {
    reject(errCode, errMsg ?: "")
  }
}

class OpenIMSendMessageCallback(
  private val operationID: String,
  private val resolve: OpenIMResolveString,
  private val reject: OpenIMReject,
  private val emit: OpenIMNativeEvent?
) : SendMsgCallBack {
  override fun onSuccess(data: String?) {
    resolve(data ?: "")
  }

  override fun onError(errCode: Int, errMsg: String?) {
    reject(errCode, errMsg ?: "")
  }

  override fun onProgress(progress: Long) {
    val payload = JSONObject()
      .put("operationID", operationID)
      .put("progress", progress)
    emit?.invoke("onSendMessageProgress", payload.toString(), 0, "")
  }
}

class OpenIMConnListener : OnConnListener {
  var emit: OpenIMConnEvent? = null

  override fun onConnecting() {
    emit?.invoke("onConnecting", 0, "")
  }

  override fun onConnectSuccess() {
    emit?.invoke("onConnectSuccess", 0, "")
  }

  override fun onConnectFailed(errCode: Int, errMsg: String?) {
    emit?.invoke("onConnectFailed", errCode, errMsg ?: "")
  }

  override fun onKickedOffline() {
    emit?.invoke("onKickedOffline", 0, "")
  }

  override fun onUserTokenExpired() {
    emit?.invoke("onUserTokenExpired", 0, "")
  }

  override fun onUserTokenInvalid(errMsg: String?) {
    emit?.invoke("onUserTokenInvalid", 0, errMsg ?: "")
  }
}

class OpenIMAdvancedMsgListenerNative(
  private val emit: OpenIMMessageEvent
) : OnAdvancedMsgListener {
  override fun onRecvNewMessage(message: String?) {
    emit("onRecvNewMessage", message ?: "")
  }

  override fun onRecvOfflineNewMessage(message: String?) {
    emit("onRecvOfflineNewMessage", message ?: "")
  }

  override fun onRecvOnlineOnlyMessage(message: String?) {
    emit("onRecvOnlineOnlyMessage", message ?: "")
  }

  override fun onMsgDeleted(message: String?) {
    emit("onMsgDeleted", message ?: "")
  }

  override fun onNewRecvMessageRevoked(messageRevoked: String?) {
    emit("onNewRecvMessageRevoked", messageRevoked ?: "")
  }

  override fun onRecvC2CReadReceipt(msgReceiptList: String?) {
    emit("onRecvC2CReadReceipt", msgReceiptList ?: "")
  }
}

class OpenIMBatchMsgListenerNative(private val emit: OpenIMMessageEvent) : OnBatchMsgListener {
  override fun onRecvNewMessages(messageList: String?) { emit("onRecvNewMessages", messageList ?: "") }
  override fun onRecvOfflineNewMessages(messageList: String?) { emit("onRecvOfflineNewMessages", messageList ?: "") }
}

class OpenIMConversationListenerNative(private val emit: OpenIMMessageEvent) : OnConversationListener {
  override fun onConversationChanged(conversationList: String?) { emit("onConversationChanged", conversationList ?: "") }
  override fun onConversationUserInputStatusChanged(change: String?) { emit("onConversationUserInputStatusChanged", change ?: "") }
  override fun onNewConversation(conversationList: String?) { emit("onNewConversation", conversationList ?: "") }
  override fun onSyncServerFailed(reinstalled: Boolean) { emit("onSyncServerFailed", reinstalled.toString()) }
  override fun onSyncServerFinish(reinstalled: Boolean) { emit("onSyncServerFinish", reinstalled.toString()) }
  override fun onSyncServerProgress(progress: Long) { emit("onSyncServerProgress", progress.toString()) }
  override fun onSyncServerStart(reinstalled: Boolean) { emit("onSyncServerStart", reinstalled.toString()) }
  override fun onTotalUnreadMessageCountChanged(totalUnreadCount: Int) { emit("onTotalUnreadMessageCountChanged", totalUnreadCount.toString()) }
}

class OpenIMCustomBusinessListenerNative(private val emit: OpenIMMessageEvent) : OnCustomBusinessListener {
  override fun onRecvCustomBusinessMessage(businessMessage: String?) { emit("onRecvCustomBusinessMessage", businessMessage ?: "") }
}

class OpenIMFriendshipListenerNative(private val emit: OpenIMMessageEvent) : OnFriendshipListener {
  override fun onBlackAdded(blackInfo: String?) { emit("onBlackAdded", blackInfo ?: "") }
  override fun onBlackDeleted(blackInfo: String?) { emit("onBlackDeleted", blackInfo ?: "") }
  override fun onFriendAdded(friendInfo: String?) { emit("onFriendAdded", friendInfo ?: "") }
  override fun onFriendApplicationAccepted(friendApplication: String?) { emit("onFriendApplicationAccepted", friendApplication ?: "") }
  override fun onFriendApplicationAdded(friendApplication: String?) { emit("onFriendApplicationAdded", friendApplication ?: "") }
  override fun onFriendApplicationDeleted(friendApplication: String?) { emit("onFriendApplicationDeleted", friendApplication ?: "") }
  override fun onFriendApplicationRejected(friendApplication: String?) { emit("onFriendApplicationRejected", friendApplication ?: "") }
  override fun onFriendDeleted(friendInfo: String?) { emit("onFriendDeleted", friendInfo ?: "") }
  override fun onFriendInfoChanged(friendInfo: String?) { emit("onFriendInfoChanged", friendInfo ?: "") }
}

class OpenIMGroupListenerNative(private val emit: OpenIMMessageEvent) : OnGroupListener {
  override fun onGroupApplicationAccepted(groupApplication: String?) { emit("onGroupApplicationAccepted", groupApplication ?: "") }
  override fun onGroupApplicationAdded(groupApplication: String?) { emit("onGroupApplicationAdded", groupApplication ?: "") }
  override fun onGroupApplicationDeleted(groupApplication: String?) { emit("onGroupApplicationDeleted", groupApplication ?: "") }
  override fun onGroupApplicationRejected(groupApplication: String?) { emit("onGroupApplicationRejected", groupApplication ?: "") }
  override fun onGroupDismissed(groupInfo: String?) { emit("onGroupDismissed", groupInfo ?: "") }
  override fun onGroupInfoChanged(groupInfo: String?) { emit("onGroupInfoChanged", groupInfo ?: "") }
  override fun onGroupMemberAdded(groupMemberInfo: String?) { emit("onGroupMemberAdded", groupMemberInfo ?: "") }
  override fun onGroupMemberDeleted(groupMemberInfo: String?) { emit("onGroupMemberDeleted", groupMemberInfo ?: "") }
  override fun onGroupMemberInfoChanged(groupMemberInfo: String?) { emit("onGroupMemberInfoChanged", groupMemberInfo ?: "") }
  override fun onJoinedGroupAdded(groupInfo: String?) { emit("onJoinedGroupAdded", groupInfo ?: "") }
  override fun onJoinedGroupDeleted(groupInfo: String?) { emit("onJoinedGroupDeleted", groupInfo ?: "") }
}

class OpenIMUserListenerNative(private val emit: OpenIMMessageEvent) : OnUserListener {
  override fun onSelfInfoUpdated(userInfo: String?) { emit("onSelfInfoUpdated", userInfo ?: "") }
  override fun onUserCommandAdd(userCommand: String?) { emit("onUserCommandAdd", userCommand ?: "") }
  override fun onUserCommandDelete(userCommand: String?) { emit("onUserCommandDelete", userCommand ?: "") }
  override fun onUserCommandUpdate(userCommand: String?) { emit("onUserCommandUpdate", userCommand ?: "") }
  override fun onUserStatusChanged(userOnlineStatus: String?) { emit("onUserStatusChanged", userOnlineStatus ?: "") }
}

class OpenIMUploadFileCallback(
  private val operationID: String,
  private val emit: OpenIMMessageEvent
) : UploadFileCallback {
  private fun emitProgress(stage: String, payload: JSONObject) {
    payload.put("operationID", operationID)
    payload.put("stage", stage)
    emit("onUploadFileProgress", payload.toString())
  }

  override fun complete(size: Long, url: String?, typ: Long) {}

  override fun hashPartComplete(hash: String?, partHash: String?) {}

  override fun hashPartProgress(index: Long, size: Long, hash: String?) {}

  override fun open(size: Long) {}

  override fun partSize(partSize: Long, num: Long) {}

  override fun uploadComplete(size: Long, partSize: Long, num: Long) {
    emitProgress("uploadComplete", JSONObject()
      .put("total", size)
      .put("current", partSize)
      .put("storageSize", num))
  }

  override fun uploadID(uploadID: String?) {}

  override fun uploadPartComplete(partSize: Long, num: Long, etag: String?) {}
}

class OpenIMUploadLogProgress(
  private val operationID: String,
  private val emit: OpenIMMessageEvent
) : UploadLogProgress {
  override fun onProgress(current: Long, size: Long) {
    val percent = if (size > 0) current * 100 / size else 0L
    val payload = JSONObject()
      .put("operationID", operationID)
      .put("current", current)
      .put("size", size)
      .put("percent", percent)
    emit("onUploadLogsProgress", payload.toString())
  }
}

object NativeOpenIMSDK {
  private val connListener = OpenIMConnListener()
  private var advancedMsgListener: OpenIMAdvancedMsgListenerNative? = null
  private var batchMsgListener: OpenIMBatchMsgListenerNative? = null
  private var conversationListener: OpenIMConversationListenerNative? = null
  private var customBusinessListener: OpenIMCustomBusinessListenerNative? = null
  private var friendshipListener: OpenIMFriendshipListenerNative? = null
  private var groupListener: OpenIMGroupListenerNative? = null
  private var userListener: OpenIMUserListenerNative? = null
  private var nativeEventEmit: OpenIMNativeEvent? = null
  private var sdkInitialized: Boolean = false

  fun uploadFile(
    operationID: String,
    data: String,
    resolve: OpenIMResolveString,
    reject: OpenIMReject
  ) {
    Open_im_sdk.uploadFile(
      OpenIMBaseCallback(resolve, reject),
      operationID,
      data,
      OpenIMUploadFileCallback(operationID) { eventName, payload ->
        nativeEventEmit?.invoke(eventName, payload, 0, "")
      }
    )
  }

  fun initSDK(operationID: String, sdkConfig: String): String {
    val initialized = Open_im_sdk.initSDK(connListener, operationID, sdkConfig)
    sdkInitialized = initialized
    if (initialized) {
      applyNativeEventListeners()
    }
    return initialized.toString()
  }

  fun getLoginStatus(operationID: String): String {
    return Open_im_sdk.getLoginStatus(operationID).toString()
  }

  fun getLoginUserID(): String {
    return Open_im_sdk.getLoginUserID() ?: ""
  }

  fun getSdkVersion(): String {
    return Open_im_sdk.getSdkVersion() ?: ""
  }

  fun unInitSDK(operationID: String): String {
    Open_im_sdk.unInitSDK(operationID)
    sdkInitialized = false
    return ""
  }

  fun login(operationID: String, userID: String, token: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.login(OpenIMBaseCallback(resolve, reject), operationID, userID, token)
  }

  fun logout(operationID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.logout(OpenIMBaseCallback(resolve, reject), operationID)
  }

  fun getAllConversationList(operationID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getAllConversationList(OpenIMBaseCallback(resolve, reject), operationID)
  }

  fun getOneConversation(operationID: String, sessionType: Number, sourceID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getOneConversation(OpenIMBaseCallback(resolve, reject), operationID, sessionType.toInt(), sourceID)
  }

  fun getAdvancedHistoryMessageList(operationID: String, options: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getAdvancedHistoryMessageList(OpenIMBaseCallback(resolve, reject), operationID, options)
  }

  fun getAdvancedHistoryMessageListReverse(operationID: String, options: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getAdvancedHistoryMessageListReverse(OpenIMBaseCallback(resolve, reject), operationID, options)
  }

  fun getSpecifiedGroupsInfo(operationID: String, groupIDList: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getSpecifiedGroupsInfo(OpenIMBaseCallback(resolve, reject), operationID, groupIDList)
  }

  fun deleteConversationAndDeleteAllMsg(operationID: String, conversationID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.deleteConversationAndDeleteAllMsg(OpenIMBaseCallback(resolve, reject), operationID, conversationID)
  }

  fun markConversationMessageAsRead(operationID: String, conversationID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.markConversationMessageAsRead(OpenIMBaseCallback(resolve, reject), operationID, conversationID)
  }

  fun getGroupMemberList(operationID: String, groupID: String, filter: Number, offset: Number, count: Number, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getGroupMemberList(OpenIMBaseCallback(resolve, reject), operationID, groupID, filter.toInt(), offset.toInt(), count.toInt())
  }

  fun setMessageLocalEx(operationID: String, conversationID: String, clientMsgID: String, localEx: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.setMessageLocalEx(OpenIMBaseCallback(resolve, reject), operationID, conversationID, clientMsgID, localEx)
  }

  fun revokeMessage(operationID: String, conversationID: String, clientMsgID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.revokeMessage(OpenIMBaseCallback(resolve, reject), operationID, conversationID, clientMsgID)
  }

  private fun buildSetConversationPayload(rawParams: String): String {
    val raw = try {
      JSONObject(rawParams)
    } catch (_: Exception) {
      return "{}"
    }
    val payload = JSONObject()

    val numberFields = arrayOf("recvMsgOpt", "burnDuration", "groupAtType")
    for (field in numberFields) {
      if (raw.has(field) && !raw.isNull(field)) {
        val value = raw.opt(field)
        if (value is Number) {
          payload.put(field, value)
        }
      }
    }

    val boolFields = arrayOf("isPinned", "isPrivateChat")
    for (field in boolFields) {
      if (raw.has(field) && !raw.isNull(field)) {
        val value = raw.opt(field)
        if (value is Boolean) {
          payload.put(field, value)
        }
      }
    }

    if (raw.has("ex") && !raw.isNull("ex")) {
      val value = raw.opt("ex")
      if (value is String) {
        payload.put("ex", value)
      }
    }

    return payload.toString()
  }

  private fun buildSetSelfInfoPayload(rawParams: String): String {
    val raw = try {
      JSONObject(rawParams)
    } catch (_: Exception) {
      return "{}"
    }
    val payload = JSONObject()

    val stringFields = arrayOf("nickname", "faceURL", "ex")
    for (field in stringFields) {
      if (raw.has(field) && !raw.isNull(field)) {
        val value = raw.opt(field)
        if (value is String) {
          payload.put(field, value)
        }
      }
    }

    if (raw.has("globalRecvMsgOpt") && !raw.isNull("globalRecvMsgOpt")) {
      val value = raw.opt("globalRecvMsgOpt")
      if (value is Number) {
        payload.put("globalRecvMsgOpt", value)
      }
    }

    return payload.toString()
  }

  private fun buildSetGroupInfoPayload(rawParams: String): String {
    val raw = try {
      JSONObject(rawParams)
    } catch (_: Exception) {
      return "{}"
    }
    val payload = JSONObject()

    val stringFields = arrayOf("groupID", "groupName", "notification", "introduction", "faceURL", "ex")
    for (field in stringFields) {
      if (raw.has(field) && !raw.isNull(field)) {
        val value = raw.opt(field)
        if (value is String) {
          payload.put(field, value)
        }
      }
    }

    val numberFields = arrayOf("needVerification", "lookMemberInfo", "applyMemberFriend")
    for (field in numberFields) {
      if (raw.has(field) && !raw.isNull(field)) {
        val value = raw.opt(field)
        if (value is Number) {
          payload.put(field, value)
        }
      }
    }

    if (raw.has("displayIsRead") && !raw.isNull("displayIsRead")) {
      val value = raw.opt("displayIsRead")
      if (value is Boolean) {
        payload.put("displayIsRead", value)
      }
    }

    return payload.toString()
  }

  private fun buildSetGroupMemberInfoPayload(rawParams: String): String {
    val raw = try {
      JSONObject(rawParams)
    } catch (_: Exception) {
      return "{}"
    }
    val payload = JSONObject()

    val stringFields = arrayOf("groupID", "userID", "nickname", "faceURL", "ex")
    for (field in stringFields) {
      if (raw.has(field) && !raw.isNull(field)) {
        val value = raw.opt(field)
        if (value is String) {
          payload.put(field, value)
        }
      }
    }

    if (raw.has("roleLevel") && !raw.isNull("roleLevel")) {
      val value = raw.opt("roleLevel")
      if (value is Number) {
        payload.put("roleLevel", value)
      }
    }

    return payload.toString()
  }

  private fun buildUpdateFriendsPayload(rawParams: String): String {
    val raw = try {
      JSONObject(rawParams)
    } catch (_: Exception) {
      return "{}"
    }
    val payload = JSONObject()

    val rawIDs = raw.optJSONArray("friendUserIDs")
    if (rawIDs != null) {
      val ids = JSONArray()
      var index = 0
      while (index < rawIDs.length()) {
        val value = rawIDs.opt(index)
        if (value is String) {
          ids.put(value)
        }
        index += 1
      }
      payload.put("friendUserIDs", ids)
    }

    if (raw.has("isPinned") && !raw.isNull("isPinned")) {
      val value = raw.opt("isPinned")
      if (value is Boolean) {
        payload.put("isPinned", value)
      }
    }

    val stringFields = arrayOf("remark", "ex")
    for (field in stringFields) {
      if (raw.has(field) && !raw.isNull(field)) {
        val value = raw.opt(field)
        if (value is String) {
          payload.put(field, value)
        }
      }
    }

    return payload.toString()
  }

  fun setConversation(operationID: String, conversationID: String, conversation: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    val payload = buildSetConversationPayload(conversation)
    Open_im_sdk.setConversation(OpenIMBaseCallback(resolve, reject), operationID, conversationID, payload)
  }

  fun setAppBackgroundStatus(operationID: String, isBackground: Boolean, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.setAppBackgroundStatus(OpenIMBaseCallback(resolve, reject), operationID, isBackground)
  }

  fun setAppBadge(operationID: String, count: Number, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.setAppBadge(OpenIMBaseCallback(resolve, reject), operationID, count.toInt())
  }

  fun networkStatusChanged(operationID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.networkStatusChanged(OpenIMBaseCallback(resolve, reject), operationID)
  }

  fun getSelfUserInfo(operationID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getSelfUserInfo(OpenIMBaseCallback(resolve, reject), operationID)
  }

  fun getUsersInfo(operationID: String, userIDList: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getUsersInfo(OpenIMBaseCallback(resolve, reject), operationID, userIDList)
  }

  fun setSelfInfo(operationID: String, userInfo: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    val payload = buildSetSelfInfoPayload(userInfo)
    Open_im_sdk.setSelfInfo(OpenIMBaseCallback(resolve, reject), operationID, payload)
  }

  fun deleteMessageFromLocalStorage(operationID: String, conversationID: String, clientMsgID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.deleteMessageFromLocalStorage(OpenIMBaseCallback(resolve, reject), operationID, conversationID, clientMsgID)
  }

  fun deleteMessage(operationID: String, conversationID: String, clientMsgID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.deleteMessage(OpenIMBaseCallback(resolve, reject), operationID, conversationID, clientMsgID)
  }

  fun deleteAllMsgFromLocal(operationID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.deleteAllMsgFromLocal(OpenIMBaseCallback(resolve, reject), operationID)
  }

  fun deleteAllMsgFromLocalAndSvr(operationID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.deleteAllMsgFromLocalAndSvr(OpenIMBaseCallback(resolve, reject), operationID)
  }

  fun insertSingleMessageToLocalStorage(operationID: String, message: String, recvID: String, sendID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.insertSingleMessageToLocalStorage(OpenIMBaseCallback(resolve, reject), operationID, message, recvID, sendID)
  }

  fun insertGroupMessageToLocalStorage(operationID: String, message: String, groupID: String, sendID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.insertGroupMessageToLocalStorage(OpenIMBaseCallback(resolve, reject), operationID, message, groupID, sendID)
  }

  fun changeInputStates(operationID: String, conversationID: String, isTyping: Boolean, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.changeInputStates(OpenIMBaseCallback(resolve, reject), operationID, conversationID, isTyping)
  }

  fun getInputStates(operationID: String, conversationID: String, userID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getInputStates(OpenIMBaseCallback(resolve, reject), operationID, conversationID, userID)
  }

  fun clearConversationAndDeleteAllMsg(operationID: String, conversationID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.clearConversationAndDeleteAllMsg(OpenIMBaseCallback(resolve, reject), operationID, conversationID)
  }

  fun hideConversation(operationID: String, conversationID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.hideConversation(OpenIMBaseCallback(resolve, reject), operationID, conversationID)
  }

  fun hideAllConversations(operationID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.hideAllConversations(OpenIMBaseCallback(resolve, reject), operationID)
  }

  fun markAllConversationMessageAsRead(operationID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.markAllConversationMessageAsRead(OpenIMBaseCallback(resolve, reject), operationID)
  }

  fun markMessagesAsReadByMsgID(operationID: String, conversationID: String, clientMsgIDList: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.markMessagesAsReadByMsgID(OpenIMBaseCallback(resolve, reject), operationID, conversationID, clientMsgIDList)
  }

  fun searchConversation(operationID: String, options: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.searchConversation(OpenIMBaseCallback(resolve, reject), operationID, options)
  }

  fun getConversationListSplit(operationID: String, offset: Number, count: Number, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getConversationListSplit(OpenIMBaseCallback(resolve, reject), operationID, offset.toLong(), count.toLong())
  }

  fun getMultipleConversation(operationID: String, conversationIDList: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getMultipleConversation(OpenIMBaseCallback(resolve, reject), operationID, conversationIDList)
  }

  fun setConversationDraft(operationID: String, conversationID: String, draftText: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.setConversationDraft(OpenIMBaseCallback(resolve, reject), operationID, conversationID, draftText)
  }

  fun getTotalUnreadMsgCount(operationID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getTotalUnreadMsgCount(OpenIMBaseCallback(resolve, reject), operationID)
  }

  fun searchLocalMessages(operationID: String, options: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.searchLocalMessages(OpenIMBaseCallback(resolve, reject), operationID, options)
  }

  fun addFriend(operationID: String, friendApplication: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.addFriend(OpenIMBaseCallback(resolve, reject), operationID, friendApplication)
  }

  fun searchFriends(operationID: String, options: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.searchFriends(OpenIMBaseCallback(resolve, reject), operationID, options)
  }

  fun getSpecifiedFriendsInfo(operationID: String, userIDList: String, filterBlack: Boolean, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getSpecifiedFriendsInfo(OpenIMBaseCallback(resolve, reject), operationID, userIDList, filterBlack)
  }

  fun getFriendApplicationListAsRecipient(operationID: String, options: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getFriendApplicationListAsRecipient(OpenIMBaseCallback(resolve, reject), operationID, options)
  }

  fun getFriendApplicationListAsApplicant(operationID: String, options: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getFriendApplicationListAsApplicant(OpenIMBaseCallback(resolve, reject), operationID, options)
  }

  fun getFriendApplicationUnhandledCount(operationID: String, options: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getFriendApplicationUnhandledCount(OpenIMBaseCallback(resolve, reject), operationID, options)
  }

  fun getFriendList(operationID: String, filterBlack: Boolean, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getFriendList(OpenIMBaseCallback(resolve, reject), operationID, filterBlack)
  }

  fun getFriendListPage(operationID: String, offset: Number, count: Number, filterBlack: Boolean, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getFriendListPage(OpenIMBaseCallback(resolve, reject), operationID, offset.toInt(), count.toInt(), filterBlack)
  }

  fun updateFriends(operationID: String, friendsInfo: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    val payload = buildUpdateFriendsPayload(friendsInfo)
    println("openim updateFriends native payload $operationID $payload")
    Open_im_sdk.updateFriends(OpenIMBaseCallback(resolve, reject), operationID, payload)
  }

  fun checkFriend(operationID: String, userIDList: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.checkFriend(OpenIMBaseCallback(resolve, reject), operationID, userIDList)
  }

  fun acceptFriendApplication(operationID: String, userID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.acceptFriendApplication(OpenIMBaseCallback(resolve, reject), operationID, userID)
  }

  fun refuseFriendApplication(operationID: String, userID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.refuseFriendApplication(OpenIMBaseCallback(resolve, reject), operationID, userID)
  }

  fun deleteFriend(operationID: String, userID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.deleteFriend(OpenIMBaseCallback(resolve, reject), operationID, userID)
  }

  fun addBlack(operationID: String, userID: String, ex: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.addBlack(OpenIMBaseCallback(resolve, reject), operationID, userID, ex)
  }

  fun removeBlack(operationID: String, userID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.removeBlack(OpenIMBaseCallback(resolve, reject), operationID, userID)
  }

  fun getBlackList(operationID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getBlackList(OpenIMBaseCallback(resolve, reject), operationID)
  }

  fun inviteUserToGroup(operationID: String, groupID: String, reason: String, userIDList: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.inviteUserToGroup(OpenIMBaseCallback(resolve, reject), operationID, groupID, reason, userIDList)
  }

  fun kickGroupMember(operationID: String, groupID: String, reason: String, userIDList: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.kickGroupMember(OpenIMBaseCallback(resolve, reject), operationID, groupID, reason, userIDList)
  }

  fun isJoinGroup(operationID: String, groupID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.isJoinGroup(OpenIMBaseCallback(resolve, reject), operationID, groupID)
  }

  fun getSpecifiedGroupMembersInfo(operationID: String, groupID: String, userIDList: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getSpecifiedGroupMembersInfo(OpenIMBaseCallback(resolve, reject), operationID, groupID, userIDList)
  }

  fun getUsersInGroup(operationID: String, groupID: String, userIDList: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getUsersInGroup(OpenIMBaseCallback(resolve, reject), operationID, groupID, userIDList)
  }

  fun getGroupMemberListByJoinTimeFilter(operationID: String, groupID: String, offset: Number, count: Number, joinTimeBegin: Number, joinTimeEnd: Number, userIDList: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getGroupMemberListByJoinTimeFilter(OpenIMBaseCallback(resolve, reject), operationID, groupID, offset.toInt(), count.toInt(), joinTimeBegin.toLong(), joinTimeEnd.toLong(), userIDList)
  }

  fun searchGroupMembers(operationID: String, options: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.searchGroupMembers(OpenIMBaseCallback(resolve, reject), operationID, options)
  }

  fun getJoinedGroupList(operationID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getJoinedGroupList(OpenIMBaseCallback(resolve, reject), operationID)
  }

  fun getJoinedGroupListPage(operationID: String, offset: Number, count: Number, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getJoinedGroupListPage(OpenIMBaseCallback(resolve, reject), operationID, offset.toInt(), count.toInt())
  }

  fun createGroup(operationID: String, groupInfo: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.createGroup(OpenIMBaseCallback(resolve, reject), operationID, groupInfo)
  }

  fun setGroupInfo(operationID: String, groupInfo: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    val payload = buildSetGroupInfoPayload(groupInfo)
    println("openim setGroupInfo native payload $operationID $payload")
    Open_im_sdk.setGroupInfo(OpenIMBaseCallback(resolve, reject), operationID, payload)
  }

  fun setGroupMemberInfo(operationID: String, groupMemberInfo: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    val payload = buildSetGroupMemberInfoPayload(groupMemberInfo)
    println("openim setGroupMemberInfo native payload $operationID $payload")
    Open_im_sdk.setGroupMemberInfo(OpenIMBaseCallback(resolve, reject), operationID, payload)
  }

  fun joinGroup(operationID: String, groupID: String, reqMsg: String, joinSource: Number, ex: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.joinGroup(OpenIMBaseCallback(resolve, reject), operationID, groupID, reqMsg, joinSource.toInt(), ex)
  }

  fun searchGroups(operationID: String, options: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.searchGroups(OpenIMBaseCallback(resolve, reject), operationID, options)
  }

  fun quitGroup(operationID: String, groupID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.quitGroup(OpenIMBaseCallback(resolve, reject), operationID, groupID)
  }

  fun dismissGroup(operationID: String, groupID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.dismissGroup(OpenIMBaseCallback(resolve, reject), operationID, groupID)
  }

  fun changeGroupMute(operationID: String, groupID: String, isMute: Boolean, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.changeGroupMute(OpenIMBaseCallback(resolve, reject), operationID, groupID, isMute)
  }

  fun changeGroupMemberMute(operationID: String, groupID: String, userID: String, mutedSeconds: Number, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.changeGroupMemberMute(OpenIMBaseCallback(resolve, reject), operationID, groupID, userID, mutedSeconds.toLong())
  }

  fun transferGroupOwner(operationID: String, groupID: String, newOwnerUserID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.transferGroupOwner(OpenIMBaseCallback(resolve, reject), operationID, groupID, newOwnerUserID)
  }

  fun getGroupApplicationListAsApplicant(operationID: String, options: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getGroupApplicationListAsApplicant(OpenIMBaseCallback(resolve, reject), operationID, options)
  }

  fun getGroupApplicationListAsRecipient(operationID: String, options: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getGroupApplicationListAsRecipient(OpenIMBaseCallback(resolve, reject), operationID, options)
  }

  fun getGroupApplicationUnhandledCount(operationID: String, options: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getGroupApplicationUnhandledCount(OpenIMBaseCallback(resolve, reject), operationID, options)
  }

  fun acceptGroupApplication(operationID: String, groupID: String, fromUserID: String, handleMsg: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.acceptGroupApplication(OpenIMBaseCallback(resolve, reject), operationID, groupID, fromUserID, handleMsg)
  }

  fun refuseGroupApplication(operationID: String, groupID: String, fromUserID: String, handleMsg: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.refuseGroupApplication(OpenIMBaseCallback(resolve, reject), operationID, groupID, fromUserID, handleMsg)
  }

  fun getGroupMemberOwnerAndAdmin(operationID: String, groupID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getGroupMemberOwnerAndAdmin(OpenIMBaseCallback(resolve, reject), operationID, groupID)
  }

  fun findMessageList(operationID: String, findOptions: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.findMessageList(OpenIMBaseCallback(resolve, reject), operationID, findOptions)
  }

  fun updateFcmToken(operationID: String, fcmToken: String, expireTime: Number, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.updateFcmToken(OpenIMBaseCallback(resolve, reject), operationID, fcmToken, expireTime.toLong())
  }

  fun uploadLogs(operationID: String, line: Number, ex: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.uploadLogs(OpenIMBaseCallback(resolve, reject), operationID, line.toLong(), ex, OpenIMUploadLogProgress(operationID) { eventName, payload ->
      nativeEventEmit?.invoke(eventName, payload, 0, "")
    })
  }

  fun subscribeUsersStatus(operationID: String, userIDList: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.subscribeUsersStatus(OpenIMBaseCallback(resolve, reject), operationID, userIDList)
  }

  fun unsubscribeUsersStatus(operationID: String, userIDList: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.unsubscribeUsersStatus(OpenIMBaseCallback(resolve, reject), operationID, userIDList)
  }

  fun getUserStatus(operationID: String, userIDList: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getUserStatus(OpenIMBaseCallback(resolve, reject), operationID, userIDList)
  }

  fun getSubscribeUsersStatus(operationID: String, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.getSubscribeUsersStatus(OpenIMBaseCallback(resolve, reject), operationID)
  }

  fun sendMessage(operationID: String, message: String, recvID: String, groupID: String, offlinePushInfo: String, isOnlineOnly: Boolean, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.sendMessage(OpenIMSendMessageCallback(operationID, resolve, reject, nativeEventEmit), operationID, message, recvID, groupID, offlinePushInfo, isOnlineOnly)
  }

  fun sendMessageNotOss(operationID: String, message: String, recvID: String, groupID: String, offlinePushInfo: String, isOnlineOnly: Boolean, resolve: OpenIMResolveString, reject: OpenIMReject) {
    Open_im_sdk.sendMessageNotOss(OpenIMSendMessageCallback(operationID, resolve, reject, nativeEventEmit), operationID, message, recvID, groupID, offlinePushInfo, isOnlineOnly)
  }

  fun createTextMessage(operationID: String, text: String): String {
    return Open_im_sdk.createTextMessage(operationID, text) ?: ""
  }

  fun createImageMessageFromFullPath(operationID: String, imageFullPath: String): String {
    return Open_im_sdk.createImageMessageFromFullPath(operationID, imageFullPath) ?: ""
  }

  fun createImageMessageByURL(operationID: String, sourcePath: String, sourceUrl: String, sourceName: String, snapshotUrl: String): String {
    return Open_im_sdk.createImageMessageByURL(operationID, sourcePath, sourceUrl, sourceName, snapshotUrl) ?: ""
  }

  fun createCustomMessage(operationID: String, data: String, extension: String, descriptionText: String): String {
    return Open_im_sdk.createCustomMessage(operationID, data, extension, descriptionText) ?: ""
  }

  fun createQuoteMessage(operationID: String, text: String, quoteMessage: String): String {
    return Open_im_sdk.createQuoteMessage(operationID, text, quoteMessage) ?: ""
  }

  fun createAdvancedQuoteMessage(operationID: String, text: String, quoteMessage: String, messageEntityList: String): String {
    return Open_im_sdk.createAdvancedQuoteMessage(operationID, text, messageEntityList, quoteMessage) ?: ""
  }

  fun createAdvancedTextMessage(operationID: String, text: String, messageEntityList: String): String {
    return Open_im_sdk.createAdvancedTextMessage(operationID, text, messageEntityList) ?: ""
  }

  fun createTextAtMessage(operationID: String, text: String, atUserIDList: String, atUsersInfo: String, quoteMessage: String): String {
    return Open_im_sdk.createTextAtMessage(operationID, text, atUserIDList, atUsersInfo, quoteMessage) ?: ""
  }

  fun createSoundMessageByURL(operationID: String, soundInfo: String): String {
    return Open_im_sdk.createSoundMessageByURL(operationID, soundInfo) ?: ""
  }

  fun createSoundMessageFromFullPath(operationID: String, soundPath: String, duration: Number): String {
    return Open_im_sdk.createSoundMessageFromFullPath(operationID, soundPath, duration.toLong()) ?: ""
  }

  fun createVideoMessageByURL(operationID: String, videoInfo: String): String {
    return Open_im_sdk.createVideoMessageByURL(operationID, videoInfo) ?: ""
  }

  fun createVideoMessageFromFullPath(operationID: String, videoFullPath: String, videoType: String, duration: Number, snapshotFullPath: String): String {
    return Open_im_sdk.createVideoMessageFromFullPath(operationID, videoFullPath, videoType, duration.toLong(), snapshotFullPath) ?: ""
  }

  fun createFileMessageByURL(operationID: String, fileInfo: String): String {
    return Open_im_sdk.createFileMessageByURL(operationID, fileInfo) ?: ""
  }

  fun createFileMessageFromFullPath(operationID: String, fileFullPath: String, fileName: String): String {
    return Open_im_sdk.createFileMessageFromFullPath(operationID, fileFullPath, fileName) ?: ""
  }

  fun createMergerMessage(operationID: String, messageList: String, title: String, abstractList: String): String {
    return Open_im_sdk.createMergerMessage(operationID, messageList, title, abstractList) ?: ""
  }

  fun createForwardMessage(operationID: String, message: String): String {
    return Open_im_sdk.createForwardMessage(operationID, message) ?: ""
  }

  fun createFaceMessage(operationID: String, index: Number, data: String): String {
    return Open_im_sdk.createFaceMessage(operationID, index.toLong(), data) ?: ""
  }

  fun createLocationMessage(operationID: String, descriptionText: String, longitude: Number, latitude: Number): String {
    return Open_im_sdk.createLocationMessage(operationID, descriptionText, longitude.toDouble(), latitude.toDouble()) ?: ""
  }

  fun createCardMessage(operationID: String, cardInfo: String): String {
    return Open_im_sdk.createCardMessage(operationID, cardInfo) ?: ""
  }

  fun getConversationIDBySessionType(sourceID: String, groupID: String, sessionType: Number): String {
    return Open_im_sdk.getConversationIDBySessionType(sourceID, groupID, sessionType.toLong()) ?: ""
  }

  private fun applyNativeEventListeners() {
    val emit = nativeEventEmit ?: return
    val connEmit: OpenIMConnEvent = { eventName, errCode, errMsg ->
      emit(eventName, "", errCode, errMsg)
    }
    val messageEmit: OpenIMMessageEvent = { eventName, payload ->
      emit(eventName, payload, 0, "")
    }
    connListener.emit = connEmit
    advancedMsgListener = OpenIMAdvancedMsgListenerNative(messageEmit)
    batchMsgListener = OpenIMBatchMsgListenerNative(messageEmit)
    conversationListener = OpenIMConversationListenerNative(messageEmit)
    customBusinessListener = OpenIMCustomBusinessListenerNative(messageEmit)
    friendshipListener = OpenIMFriendshipListenerNative(messageEmit)
    groupListener = OpenIMGroupListenerNative(messageEmit)
    userListener = OpenIMUserListenerNative(messageEmit)
    Open_im_sdk.setAdvancedMsgListener(advancedMsgListener)
    Open_im_sdk.setBatchMsgListener(batchMsgListener)
    Open_im_sdk.setConversationListener(conversationListener)
    Open_im_sdk.setCustomBusinessListener(customBusinessListener)
    Open_im_sdk.setFriendListener(friendshipListener)
    Open_im_sdk.setGroupListener(groupListener)
    Open_im_sdk.setUserListener(userListener)
  }

  fun bindNativeEvents(emit: OpenIMNativeEvent) {
    nativeEventEmit = emit
    connListener.emit = { eventName, errCode, errMsg ->
      emit(eventName, "", errCode, errMsg)
    }
    if (sdkInitialized) {
      applyNativeEventListeners()
    }
  }
}
