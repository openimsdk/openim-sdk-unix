# 更新日志

## 0.2.1（待发布）

### 修复

- 兼容 Core 的批量新消息回调和单对象用户状态回调，保证既有单条事件订阅不丢失、不重复。
- 收紧消息事件关联与 SDK lifecycle epoch 边界，避免旧 session 事件被计入当前操作。
- 在群成员退出流程中等待对端成员状态可见后再继续，减少跨账号状态竞争。

### 验证

- 运行时证据升级为 schema-v3，并绑定精确 SDK/Core 提交、原生制品哈希、工具链、设备、构建配置和不可变 manifest。
- iOS 模拟器自动化改为 terminate、uninstall、install 的干净安装流程。
- Public 自动化固定使用隔离的服务端口 authority，避免误连其他部署并产生错误兼容性结论。
- iOS 独立对端批量消息事件和好友分页语义改用确定性场景验证。
- 本版本不新增或修改 Public API 名称、参数和返回类型。

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
