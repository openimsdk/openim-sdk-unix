# Changelog

## 0.1.1

- Changed upload file and upload logs progress callbacks to expose only `{ progress }` on Android and iOS.
- Removed public `UserCommand` event callbacks from the UTS API and native listener forwarding.
- Updated event subscription cleanup to use consistent typed unsubscribe handling.

## 0.1.0

- Initial release.
- Supports Android and iOS OpenIM native SDK integration through UTS plugin APIs.
