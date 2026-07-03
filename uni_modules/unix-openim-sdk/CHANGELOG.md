# 更新日志

## 0.1.1

- 事件监听 API 调整：所有 `onXxx` 类型化订阅函数统一返回 `OpenIMSDKUnsubscribe` 取消函数，取消单个监听时直接调用返回函数。
- 移除旧的 `off(subscription)` 单订阅取消方式，保留 `offEvent(eventName)` 用于清理某一类事件的全部监听。
- 同步更新 Android/iOS 事件监听转发实现、页面示例和插件使用文档，避免长生命周期回调清理不一致。
- 上传进度回调调整：Android/iOS 的 `onUploadFileProgress` 和 `onUploadLogsProgress` 对外 payload 统一为 `{ progress: number }`。
- 移除 public `UserCommand` 事件回调及 Android/iOS 原生 listener 到 UTS 层的转发。

## 0.1.0

- 首个版本发布。
- 支持通过 UTS 插件 API 集成 Android 和 iOS OpenIM 原生 SDK。
