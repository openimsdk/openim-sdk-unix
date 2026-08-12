# 更新日志

## 0.2.0（2026-08-12）

### 新增

- 支持传统 uni-app（Vue 2 / Vue 3）和 uni-app x 的 App Android、App iOS 项目。
- 事件订阅统一返回 `OpenIMSDKEventSubscription`，可通过 `off(subscription)` 精确取消。
- 新增 `offAll(eventName)`，用于按事件名清理全部订阅。

### 变更

- Android 原生依赖升级并固定为 `io.openim:core-sdk:3.8.3-patch15`。
- iOS 原生依赖升级并固定为 `OpenIMSDKCore 3.8.3-hotfix.15-dynamic.1`。
- App iOS 最低支持版本调整为 iOS 14；App Android 最低支持 Android 5.0 / API 21。

### 修复

- 修复文件、图片、语音、视频消息及文件上传 API 无法直接使用 App `unifile://` 本地路径的问题。
- 修复 iOS 对 Foundation JSON 对象数组、布尔值和批量消息回调的解析兼容问题。
- 修复 Android、iOS 原生回调在初始化、销毁和重复订阅场景下的生命周期问题。
- 修复部分消息、用户和可选字段在不同平台返回结构不一致的问题。

### 升级提示

- 这是包含事件订阅破坏性变更的版本。旧版“`onXxx` 返回取消函数”的写法必须改为保存 subscription handle，再调用 `off(subscription)`。
- 旧的 `offEvent(eventName)` 不再提供；请改用 `offAll(eventName)`。
- 原生 SDK 能力必须通过包含本插件的自定义基座或正式安装包验证。

## 0.1.2（2026-07-10）

- 统一 `checkFriend` 的跨平台返回结构。
- 修复 Android 部分消息与会话 API 的原生参数顺序。
- 改进 Android、iOS 的结果解析和错误返回一致性。
- 修复 iOS `atTextElem.atUsersInfo`、本地媒体路径和稀疏消息字段的处理。

## 0.1.1（2026-07-03）

- 统一 Android、iOS 的类型化事件监听接口。
- 统一文件上传和日志上传进度回调为 `{ progress: number }`。
- 改进长生命周期页面中的事件监听清理。

## 0.1.0

- 首次发布。
- 支持通过 UTS API 在 Android、iOS App 中调用 OpenIM 原生 SDK。
