# 更新日志

## 未发布
- 事件订阅改为返回可跨 UTS 桥传递的 `OpenIMSDKEventSubscription`（包含 `id` 与 `eventName`），使用 `off(subscription)` 精确取消单个监听。
- 保留 `offEvent(eventName)`，用于清理某一事件类型的全部监听。

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
