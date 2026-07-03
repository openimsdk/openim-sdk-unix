# Unix OpenIM SDK

Unix OpenIM SDK is a Promise-style UTS plugin for using the native OpenIM SDK in uni-app x projects.

## Platform Support

- Android App: supported
- iOS App: supported
- Web and Mini Program: not supported

## License

AGPL-3.0-only.

This plugin depends on native SDKs. App projects must use a custom base or packaged build for native SDK behavior to take effect.

## Native Dependencies

- Android: MavenCentral AAR dependency `io.openim:core-sdk:3.8.3-patch14.1@aar`
- iOS: CocoaPods dependency `OpenIMSDKCore` version `3.8.3-hotfix.14-dynamic`
- iOS links `libresolv.tbd` through `utssdk/app-ios/config.json`
- Android supports `armeabi-v7a`, `arm64-v8a`, `x86`, and `x86_64`

## Usage

Import the plugin APIs from the module:

```uts
import * as sdk from '@/uni_modules/unix-openim-sdk'
```

Initialize the SDK before calling login or message APIs. Keep `operationID` as the last optional argument when using APIs that accept it.

```uts
sdk.initSDK({
  apiAddr: 'https://your-api.example.com',
  wsAddr: 'wss://your-ws.example.com',
  platformID: 2,
  dataDir: '',
  logLevel: 5,
  isLogStandardOutput: true
})
```

Promise APIs resolve with the useful payload directly. Rejections use this shape:

```uts
type UnixOpenIMError = {
  errCode: number
  errMsg: string
}
```

## Events

Long-lived event subscriptions use typed helpers such as `onConnectSuccess`, `onRecvNewMessages`, `onSendMessageProgress`, `onUploadFileProgress`, and `onUploadLogsProgress`.

Each subscription returns an `unsubscribe` function. Call it to remove that listener, or use `offEvent(eventName)` to clear all handlers for a specific event.

## Local Media Paths

For local files, pass readable POSIX absolute paths and use the FullPath message APIs. Do not pass `uni.env.USER_DATA_PATH`, `unifile://usr/...`, or paths that only make sense in the Vue layer.

- `createImageMessageFromFullPath`
- `createSoundMessageFromFullPath`
- `createVideoMessageFromFullPath`
- `createFileMessageFromFullPath`

## Known Notes

- Android typed parsing may materialize missing optional message fields as `null`; message elem presence should be checked with explicit null checks.
- Cloud packaging with newer Xcode versions may expose Mach-O/linker issues from generated plugin frameworks that embed Go Mobile code.
