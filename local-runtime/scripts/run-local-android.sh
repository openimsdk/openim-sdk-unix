#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"

"$LOCAL_RUNTIME_ROOT/scripts/build-local-android.sh"

readonly APK="$PROJECT_ROOT/unpackage/debug/unix-openim-sdk-local.apk"
readonly ADB="$(resolve_adb)"
readonly DEVICE_ID="$(resolve_android_device "$ADB")"
readonly PACKAGE_NAME="$(android_package_name)"
readonly MAIN_ACTIVITY="${OPENIM_ANDROID_ACTIVITY:-io.dcloud.uniapp.UniAppActivity}"

abi="$("$ADB" -s "$DEVICE_ID" shell getprop ro.product.cpu.abi | tr -d '\r')"
if [[ "$abi" != "arm64-v8a" && "$abi" != "x86_64" ]]; then
  echo "$DEVICE_ID uses unsupported ABI $abi; local host contains arm64-v8a and x86_64" >&2
  exit 1
fi

"$ADB" -s "$DEVICE_ID" install -r -d "$APK" </dev/null
"$ADB" -s "$DEVICE_ID" shell am force-stop "$PACKAGE_NAME" </dev/null
"$ADB" -s "$DEVICE_ID" shell am start -W -n "$PACKAGE_NAME/$MAIN_ACTIVITY" </dev/null

if [[ -z "$("$ADB" -s "$DEVICE_ID" shell pidof "$PACKAGE_NAME" | tr -d '\r')" ]]; then
  echo "Android local host did not start: $PACKAGE_NAME" >&2
  exit 1
fi

node "$LOCAL_RUNTIME_ROOT/scripts/configure-automation-env.mjs" \
  android "$APK" "$DEVICE_ID" "$PACKAGE_NAME" >/dev/null
printf '%s\n' "$DEVICE_ID" > "$PROJECT_ROOT/unpackage/local-runtime/android-device-id"
echo "$DEVICE_ID: local Android host installed and started ($PACKAGE_NAME)"
