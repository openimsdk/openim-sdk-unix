# Unix OpenIM SDK 插件市场使用说明

`unix-openim-sdk` 是面向 uni-app x 的 OpenIM 公共 UTS 插件。插件市场公开包仅支持 App Android 和 App iOS，不包含 HarmonyOS 商业实现、商业信令 API 或音视频会议 UI。

## 环境要求

- HBuilderX：`5.23.2026080313-alpha` 或更高兼容版本
- uni-app x：`5.23` 系列
- Android：API 21 或更高
- iOS：iOS 14 或更高
- OpenIM Server：与 OpenIM Core `3.8.3` 协议兼容的服务端

原生依赖由插件配置自动安装：

- Android：`io.openim:core-sdk:3.8.3-patch15`
- iOS：`OpenIMSDKCore 3.8.3-hotfix.15-dynamic.1`

## 安装与运行

1. 从 DCloud 插件市场将插件导入 uni-app x 项目。
2. 确认目录为 `uni_modules/unix-openim-sdk`。
3. 为 Android 或 iOS 制作包含本插件的自定义基座，或直接构建正式安装包。
4. 在业务代码中从 `@/uni_modules/unix-openim-sdk` 导入类型化 API。
5. 先调用 `initSDK`，成功后调用 `login`。

标准基座不包含 OpenIM 原生 SDK，只能用于页面层调试，不能验证 SDK 初始化、登录、消息收发或事件回调。

## 事件订阅

`0.2.0` 使用 subscription handle 管理事件：

```uts
import {
  onRecvNewMessage,
  off,
  offAll
} from '@/uni_modules/unix-openim-sdk'

const subscription = onRecvNewMessage((message) => {
  console.log(message)
})

off(subscription)
offAll('onRecvNewMessage')
```

旧版返回取消函数的 `onXxx` 用法与旧批量取消名称不再兼容，升级时必须按上述合同迁移。

## 数据与权限说明

- 插件不包含账号、Token、服务端地址或业务数据。
- SDK 数据目录默认位于应用沙盒；通常保持 `dataDir` 为空字符串即可。
- 插件自身不申请额外系统权限。业务使用相册、相机、麦克风等能力时，应由宿主应用按实际功能声明和请求权限。
- IM Token 应由业务服务端安全签发，不应写入源码或插件配置。

## 与商业版和 AV Runtime 的边界

- Public 插件只提供公共 OpenIM Android/iOS 能力。
- HarmonyOS、商业信令和 `OpenIMSDKSessionSnapshot` 属于商业版 unixsdk，不包含在本市场包中。
- `openim-av-runtime` 依赖商业版 unixsdk，不能与本 Public 市场包组合使用。

完整 API、初始化示例和迁移说明见插件目录内的 `README.md` 与 `CHANGELOG.md`。
