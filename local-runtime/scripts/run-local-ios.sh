#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"

"$LOCAL_RUNTIME_ROOT/scripts/build-local-ios.sh"

readonly IOS_TARGET="${OPENIM_IOS_TARGET:-simulator}"
readonly APP_PATH="$(cat "$PROJECT_ROOT/unpackage/local-runtime/ios-app-path")"
readonly DEVICE_ID="$(cat "$PROJECT_ROOT/unpackage/local-runtime/ios-device-id")"
readonly BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Info.plist")"

if [[ "$IOS_TARGET" == "simulator" ]]; then
  xcrun simctl terminate "$DEVICE_ID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl uninstall "$DEVICE_ID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl install "$DEVICE_ID" "$APP_PATH"
  xcrun simctl launch "$DEVICE_ID" "$BUNDLE_ID"
fi

echo "$DEVICE_ID: local iOS host installed and started ($BUNDLE_ID)"
