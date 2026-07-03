# uni-app x OpenIM SDK 👨‍💻💬

使用本 SDK 可以为 uni-app x 应用快速接入即时通讯能力。通过连接自部署的 [OpenIM](https://docs.openim.io/) 服务端，你可以在 Android 和 iOS App 中使用类型化的 UTS API 调用原生 OpenIM SDK 能力。

底层 IM 能力来自 [OpenIM SDK Core](https://github.com/openimsdk/openim-sdk-core)。本项目将 OpenIM 移动端原生 SDK 封装为 uni-app x 的 `unix-openim-sdk` UTS 插件，提供 Promise 风格 API、类型化事件订阅和 Android/iOS 原生桥接实现。

HarmonyOS 端适配已完成，作为商业版能力提供。当前开源仓库和插件市场公开包仅包含 App Android/App iOS 实现，不包含 HarmonyOS 商业版源码、HAR 或平台配置。

本仓库同时包含一个 uni-app x demo 页面，可用于在 HBuilderX 中调试插件 API。

## 文档 📚

OpenIM 服务端、REST API 和 SDK 文档请访问 [https://docs.openim.io/](https://docs.openim.io/)。

本插件相关文档：

- 插件 README：[`uni_modules/unix-openim-sdk/README.md`](uni_modules/unix-openim-sdk/README.md)
- 插件市场使用说明：[`uni_modules/unix-openim-sdk/MARKET_USAGE.md`](uni_modules/unix-openim-sdk/MARKET_USAGE.md)
- 更新日志：[`uni_modules/unix-openim-sdk/CHANGELOG.md`](uni_modules/unix-openim-sdk/CHANGELOG.md)

## 安装 💻

### 当前验证环境

本仓库当前在本机主要使用以下环境运行和验证：

- HBuilderX：5.14 alpha
- 平台：App iOS
- 编译模式：uni-app x 蒸汽模式

开源版本目标仍为 App Android 和 App iOS。Android 侧依赖自定义基座或正式包验证原生 SDK 能力；HarmonyOS 端能力请使用商业版。

### 从插件市场安装

插件市场地址：[https://ext.dcloud.net.cn/plugin?id=28593](https://ext.dcloud.net.cn/plugin?id=28593)

### 添加 uni_modules 插件

将 `unix-openim-sdk` 插件复制或安装到你的 uni-app x 项目中：

```text
uni_modules/unix-openim-sdk
```

本仓库已在 `uni_modules/unix-openim-sdk` 下包含插件源码。

### 原生依赖

插件平台配置文件中已声明原生依赖：

- Android：`io.openim:core-sdk:3.8.3-patch14.1@aar`
- iOS：`OpenIMSDKCore` `3.8.3-hotfix.14-dynamic`

由于本插件依赖原生 SDK，请使用自定义基座或正式打包产物验证原生能力。标准基座可以用于页面编译和渲染验证，但无法实际调用依赖原生 SDK 的能力。

## 使用 🚀

以下示例使用 UTS 编写，在 uni-app x 中可获得完整类型提示。

### 导入 SDK

```uts
import {
  OpenIMPlatformAndroid,
  OpenIMPlatformIOS,
  initSDK,
  login,
  onConnectFailed,
  onConnectSuccess,
  onConnecting,
  onRecvNewMessage,
  createTextMessage,
  sendMessage
} from '@/uni_modules/unix-openim-sdk'
```

### 初始化、登录并监听连接状态

> 注意：你需要先[部署 OpenIM Server](https://github.com/openimsdk/open-im-server#rocket-quick-start)。OpenIM Server 默认端口通常为 WebSocket `10001`、API `10002`。

```uts
onConnecting(() => {
  // 连接中
})

onConnectFailed((error) => {
  // 连接失败
  console.log(error.errCode, error.errMsg)
})

onConnectSuccess(() => {
  // 连接成功
})

initSDK({
  apiAddr: 'https://your-api.example.com',
  wsAddr: 'wss://your-ws.example.com',
  platformID: OpenIMPlatformAndroid,
  dataDir: '',
  logLevel: 5,
  isLogStandardOutput: true
}).then(() => {
  return login({
    userID: 'your-user-id',
    token: 'your-token'
  })
})
```

iOS 构建时可使用 `OpenIMPlatformIOS`。多数情况下建议保持 `dataDir` 为空字符串，让插件和原生 SDK 使用 App 沙盒内的默认可写目录。

登录 IM 服务端需要先创建账号并获取用户 ID 和 token，详情可参考 [OpenIM access token 文档](https://docs.openim.io/restapi/userManagement/userRegister)。

### 接收和发送消息 💬

OpenIM 可以方便地收发消息。如果服务端策略允许，并且你知道接收方用户 ID，就可以直接发送消息。

```uts
onRecvNewMessage((message) => {
  // 收到新消息
  console.log(message)
})

createTextMessage('hello openim').then((message) => {
  if (message == null) {
    return
  }

  return sendMessage({
    message: message,
    recvID: 'receiver-user-id',
    groupID: '',
    offlinePushInfo: null,
    isOnlineOnly: false
  })
}).then(() => {
  // 消息发送成功
}).catch((error) => {
  // 消息发送失败
  console.log(error)
})
```

### 发送本地文件消息 📎

本地媒体和文件消息需要向 FullPath API 传入真实可读的 POSIX 绝对路径。不要传 `uni.env.USER_DATA_PATH`、`unifile://usr/...` 或仅在 Vue 层有意义的路径。

```uts
createFileMessageFromFullPath({
  filePath: '/absolute/path/to/file.pdf',
  fileName: 'file.pdf'
}).then((message) => {
  if (message == null) {
    return
  }

  return sendMessage({
    message: message,
    recvID: 'receiver-user-id',
    groupID: '',
    offlinePushInfo: null,
    isOnlineOnly: false
  })
})
```

demo 工程不内置媒体测试素材。在 `pages/index/index.uvue` 中运行本地媒体或上传按钮前，请先将文件放到 App 可读的原生文件系统位置，并填写对应的 `demoFixed*FullPath` 常量。

## 示例 🌟

本仓库包含一个 uni-app x demo 页面：

```text
pages/index/index.uvue
```

使用 HBuilderX 5.7.0 或更高版本打开项目，替换 demo 中的 OpenIM 服务地址和账号占位值，然后使用自定义基座或正式包验证原生 SDK 行为。

## 社区 :busts_in_silhouette:

- 📚 [OpenIM Community](https://github.com/OpenIMSDK/community)
- 💕 [OpenIM Interest Group](https://github.com/Openim-sigs)
- :eyes: [OpenIM 用户案例](https://github.com/OpenIMSDK/community/blob/main/ADOPTERS.md)

## License :page_facing_up:

本项目基于 GNU Affero General Public License v3.0 only 开源。

更多信息请查看 [`LICENSE`](LICENSE)。
