# Unix OpenIM SDK 使用说明

Unix OpenIM SDK 是面向 uni-app x 的 OpenIM 原生 SDK UTS 插件，提供 Promise 风格 API、类型声明和事件订阅接口。

## 平台支持

- App Android：支持
- App iOS：支持
- Web：不支持
- 小程序：不支持

## 主要功能

| 分类 | 功能 |
| --- | --- |
| SDK 基础能力 | 初始化 SDK、登录、登出、获取登录状态、获取当前登录用户、获取 SDK 版本 |
| 连接监听 | 连接中、连接成功、连接失败、被踢下线、Token 过期、Token 无效 |

| 消息类型 | 功能 |
| --- | --- |
| 基础消息 | 文本消息、@文本消息、高级文本消息 |
| 媒体消息 | 图片消息、语音消息、视频消息、文件消息 |
| 组合消息 | 引用消息、高级引用消息、合并消息 |
| 扩展消息 | 自定义消息、表情消息、位置消息 |

| 消息功能 | 功能 |
| --- | --- |
| 消息发送 | 发送消息、发送不走 OSS 的消息、发送进度监听 |
| 消息查询 | 历史消息、指定消息查询、本地消息搜索 |
| 消息管理 | 撤回消息、删除消息、清空消息、设置消息本地扩展字段 |
| 已读回执 | 标记会话已读、按消息 ID 标记已读、C2C 已读回执监听 |
| 消息监听 | 新消息、离线新消息、在线消息、消息撤回、消息删除 |

| 会话 | 功能 |
| --- | --- |
| 会话查询 | 获取会话列表、分页获取会话、获取指定会话、获取会话 ID |
| 会话管理 | 设置会话、删除会话、隐藏会话、设置草稿、置顶、免打扰 |
| 未读数 | 获取总未读数、未读数变更监听、清空会话未读数 |
| 会话同步 | 同步开始、同步进度、同步完成、同步失败监听 |
| 输入状态 | 设置输入状态、输入状态变更监听 |

| 关系链 | 功能 |
| --- | --- |
| 好友 | 添加好友、删除好友、获取好友列表、分页获取好友、查询指定好友、搜索好友 |
| 好友申请 | 获取收到/发出的好友申请、同意/拒绝好友申请、获取未处理数量 |
| 黑名单 | 加入黑名单、移出黑名单、获取黑名单、校验好友关系 |
| 好友监听 | 好友新增、好友删除、好友资料变更、好友申请新增/同意/拒绝/删除 |

| 群组 | 功能 |
| --- | --- |
| 群资料 | 创建群、获取已加入群、分页获取群、搜索群、设置群资料 |
| 群成员 | 获取群成员、查询指定群成员、搜索群成员、设置群成员资料 |
| 群操作 | 加入群、退出群、解散群、邀请入群、踢出成员、转让群主 |
| 群禁言 | 群禁言、群成员禁言 |
| 群申请 | 获取收到/发出的群申请、同意/拒绝群申请、获取未处理数量 |
| 群监听 | 群资料变更、群解散、群成员新增/删除/资料变更、群申请新增/同意/拒绝/删除 |

| 用户 | 功能 |
| --- | --- |
| 用户资料 | 获取用户资料、获取指定用户资料、设置当前用户资料 |
| 用户状态 | 订阅/取消订阅用户状态、用户状态变更监听 |

| 文件与日志 | 功能 |
| --- | --- |
| 文件上传 | 上传文件、文件上传进度监听 |
| 日志上传 | 上传日志、日志上传进度监听 |
| 本地路径 | FullPath 本地媒体消息创建 |

## 环境要求

- HBuilderX 5.7.0 及以上版本
- uni-app x 项目
- App 端需使用自定义基座或正式打包产物验证原生 SDK 能力

## 导入方式

推荐在页面或业务模块中按需命名导入：

```uts
import {
  OpenIMPlatformAndroid,
  OpenIMPlatformIOS,
  initSDK,
  login,
  getLoginStatus,
  onConnectSuccess,
  onUploadFileProgress,
  off,
  offEvent,
  createTextMessage,
  createImageMessageFromFullPath,
  createSoundMessageFromFullPath,
  createVideoMessageFromFullPath,
  createFileMessageFromFullPath,
  sendMessage,
  uploadFile
} from '@/uni_modules/unix-openim-sdk'
```

然后直接调用对应 API：

```uts
getLoginStatus()
```

## 初始化

调用其他 SDK API 前，需要先初始化：

```uts
initSDK({
  apiAddr: 'https://your-api.example.com',
  wsAddr: 'wss://your-ws.example.com',
  platformID: OpenIMPlatformAndroid,
  dataDir: '',
  logLevel: 5,
  isLogStandardOutput: true
})
```

`dataDir` 用于配置 OpenIMSDK 的本地数据目录。一般建议传空字符串，让插件和原生 SDK 使用 App 沙盒内的默认可写目录。

- Android：传空字符串即可使用 App 私有可写目录。
- iOS：传空字符串即可，插件会在 iOS 侧归一化为 App 可写目录。
- 不建议传 `uni.env.USER_DATA_PATH`、`unifile://usr` 或其他非 POSIX 真实路径给SDK。
- 如果业务必须自定义目录，请传 App 沙盒内真实可写的绝对路径。

平台 ID 可按目标平台选择：

```uts
OpenIMPlatformAndroid
OpenIMPlatformIOS
```

## 登录

```uts
login({
  userID: 'user-id',
  token: 'user-token'
})
```

Promise 成功时直接返回有效载荷；失败时 reject 的错误对象结构为：

```uts
type UnixOpenIMError = {
  errCode: number
  errMsg: string
}
```

## 事件订阅

插件提供类型化事件订阅函数。订阅后会返回 `OpenIMSDKEventSubscription`，可用于取消订阅。

```uts
const sub = onConnectSuccess(() => {
  console.log('OpenIM connected')
})

off(sub)
```

常用事件示例：

```uts
onConnectSuccess(() => {})
onConnectFailed((error) => {})
onKickedOffline(() => {})
onRecvNewMessage((message) => {})
onConversationChanged((result) => {})
onFriendAdded((friend) => {})
onGroupInfoChanged((group) => {})
onSendMessageProgress((progress) => {})
onUploadFileProgress((progress) => {})
onUploadLogsProgress((progress) => {})
```

如需清理某一类事件的所有订阅，可调用：

```uts
offEvent('onRecvNewMessage')
```

## 发送文本消息

```uts
createTextMessage('hello').then((message) => {
  if (message == null) {
    return
  }

  sendMessage({
    message: message,
    recvID: 'receiver-user-id',
    groupID: '',
    offlinePushInfo: null,
    isOnlineOnly: false
  })
})
```

## 文件上传

`uploadFile.filepath` 必须是真实可读的 POSIX 绝对路径，例如 App 沙盒目录中的文件路径。不要传 `uni.env.USER_DATA_PATH`、`unifile://usr/...` 或只相对于业务目录的路径；这些路径在原生 OpenIM Core 中可能不可直接访问。

```uts
onUploadFileProgress((progress) => {
  console.log('upload progress', progress)
})

uploadFile({
  filepath: '/absolute/path/to/file.pdf',
  name: 'file.pdf',
  contentType: 'application/pdf',
  uuid: 'file-uuid',
  cause: 'manual upload'
})
```

## 文件类消息

本地文件消息建议使用 FullPath API 创建。`filePath`、`imageFullPath`、`soundPath`、`videoPath` 和 `snapshotPath` 都应传真实可读的 POSIX 绝对路径。demo 工程不会内置测试素材，需要业务方自行准备文件并填入页面中的 `demoFixed*FullPath` 常量。

```uts
createFileMessageFromFullPath({
  filePath: '/absolute/path/to/file.pdf',
  fileName: 'file.pdf'
}).then((message) => {
  if (message == null) {
    return
  }

  sendMessage({
    message: message,
    recvID: 'receiver-user-id',
    groupID: '',
    offlinePushInfo: null,
    isOnlineOnly: false
  })
})
```

其他 FullPath 媒体消息 API：

```uts
createImageMessageFromFullPath('/absolute/path/to/image.jpg')
createSoundMessageFromFullPath({ soundPath: '/absolute/path/to/sound.mp3', duration: 10 })
createVideoMessageFromFullPath({ videoPath: '/absolute/path/to/video.mp4', videoType: 'mp4', duration: 10, snapshotPath: '/absolute/path/to/snapshot.jpg' })
createFileMessageFromFullPath({ filePath: '/absolute/path/to/file.pdf', fileName: 'file.pdf' })
```

## 常见注意事项

- 原生 SDK 能力必须使用自定义基座或正式包验证，标准基座无法生效原生依赖。
- `operationID` 为最后一个可选参数，建议业务侧传入可追踪的字符串。
- Promise 成功结果直接返回业务 payload，不返回原生 callback wrapper。
- Promise 失败统一 reject `{ errCode, errMsg }`。
- Android 和 iOS 都建议使用 App 可读写的真实文件系统路径，不要传临时不可访问路径。
- Android typed parsing 可能把缺失的可选消息字段展示为 `null`，业务判断消息 elem 时应使用显式 null 判断。

## License

AGPL-3.0-only.
