# 更新日志

## 0.2.0（2026-08-12）
- 正式发布类型化事件订阅合同：`onXxx` 返回 `OpenIMSDKEventSubscription`，使用 `off(subscription)` 精确取消，使用 `offAll(eventName)` 按事件名批量取消。
- Android 原生依赖固定为 `io.openim:core-sdk:3.8.3-patch15`；iOS 原生依赖固定为 `OpenIMSDKCore 3.8.3-hotfix.15-dynamic.1`。
- App iOS 最低支持版本提高到 iOS 14；App Android 最低支持 API 21。
- 修复 iOS Foundation JSON 数组及布尔值解析兼容问题，并收敛 Android/iOS 原生回调生命周期。
- 完善本地自定义基座、双账号自动化、筛选套件、合同证据及会话状态恢复验证。
- Public 插件市场包仅包含 Android/iOS 公共能力，不包含 HarmonyOS、商业信令、企业原生制品或 AV Runtime。

## 0.2.0-rc.2（2026-08-11）
- 事件订阅改为返回可跨 UTS 桥传递的 `OpenIMSDKEventSubscription`（包含 `id` 与 `eventName`），使用 `off(subscription)` 精确取消单个监听。
- 将事件批量取消统一为 `offAll(eventName)`；保留 `off(subscription)` 精确取消，不提供旧名称兼容导出。
- 这是 0.2.0 的破坏性迁移：调用方需将旧的事件批量取消名称替换为 `offAll`。
- App iOS 最低支持版本提高到 iOS 14。
- 公共原生依赖更新为 Android `io.openim:core-sdk:3.8.3-patch15` 和 iOS `OpenIMSDKCore 3.8.3-hotfix.15-dynamic.1`，远端制品与锁定本地制品的 SHA-256/inventory 已验证一致。

## 0.1.2（2026-07-10）
- `checkFriend` 对外返回值统一为 `{ result: [{ userID, result }] }`，兼容不同 OpenIM Core 的原始返回格式。
- 移除 public `getInputstates` 和 `getGroupMemberOwnerAndAdmin`。
- 修复 Android `createAdvancedQuoteMessage`、`getConversationIDBySessionType` 的原生参数顺序。
- 收敛 Android/iOS 结果解析与错误处理；iOS 保持 JSON 优先解析，仅在特殊 shape 下使用 common fallback。
- 修复 iOS 消息 JSON writer 对 `atTextElem.atUsersInfo`、本地媒体路径和稀疏消息字段的处理。
- 新增本地 OpenIM 双账号注册脚本和公开 Android/iOS API 自动化 runner；结果、覆盖率、事件回调和跳过原因写入文件。

## 0.1.1（2026-07-03）
- 事件监听 API 调整：所有 `onXxx` 类型化订阅函数统一返回 `OpenIMSDKUnsubscribe` 取消函数，取消单个监听时直接调用返回函数。
- 移除旧的 `off(subscription)` 单订阅取消方式，保留 `offEvent(eventName)` 用于清理某一类事件的全部监听。
- 同步更新 Android/iOS 事件监听转发实现、页面示例和插件使用文档，避免长生命周期回调清理不一致。
- 上传进度回调调整：Android/iOS 的 `onUploadFileProgress` 和 `onUploadLogsProgress` 对外 payload 统一为 `{ progress: number }`。
- 移除 public `UserCommand` 事件回调及 Android/iOS 原生 listener 到 UTS 层的转发。

## 0.1.0

- 首个版本发布。
- 支持通过 UTS 插件 API 集成 Android 和 iOS OpenIM 原生 SDK。
