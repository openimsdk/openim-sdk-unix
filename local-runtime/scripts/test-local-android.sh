#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"

for name in OPENIM_API_BASE OPENIM_WS_BASE IM_SECRET; do
  if [[ -z "${!name:-}" ]]; then
    echo "$name is required for local OpenIM runtime automation" >&2
    exit 1
  fi
done

readonly local_automation_env_path="$PROJECT_ROOT/env.js"
readonly local_automation_env_backup="$(mktemp "${TMPDIR:-/tmp}/openim-public-env.XXXXXX")"
local_automation_env_existed=false
if [[ -f "$local_automation_env_path" ]]; then
  cp -p "$local_automation_env_path" "$local_automation_env_backup"
  local_automation_env_existed=true
fi
restore_local_automation_environment() {
  if [[ "$local_automation_env_existed" == true ]]; then
    cp -p "$local_automation_env_backup" "$local_automation_env_path"
  else
    rm -f "$local_automation_env_path"
  fi
  rm -f "$local_automation_env_backup"
}
trap restore_local_automation_environment EXIT

"$LOCAL_RUNTIME_ROOT/scripts/prepare-automation-test-runtime.sh"
"$LOCAL_RUNTIME_ROOT/scripts/run-local-android.sh"

readonly APK="$PROJECT_ROOT/unpackage/debug/unix-openim-sdk-local.apk"
readonly ADB="$(resolve_adb)"
readonly DEVICE_ID="$(cat "$PROJECT_ROOT/unpackage/local-runtime/android-device-id")"
readonly OS_VERSION="$("$ADB" -s "$DEVICE_ID" shell getprop ro.build.version.release | tr -d '\r')"
readonly ARCHITECTURE="$("$ADB" -s "$DEVICE_ID" shell getprop ro.product.cpu.abi | tr -d '\r')"

OPENIM_TEST_CUSTOM_BASE="$APK" \
OPENIM_TEST_DEVICE_ID="$DEVICE_ID" \
OPENIM_TEST_DEVICE_KIND="${OPENIM_TEST_DEVICE_KIND:-emulator}" \
OPENIM_TEST_OS_VERSION="$OS_VERSION" \
OPENIM_TEST_ARCHITECTURE="$ARCHITECTURE" \
OPENIM_TEST_BUILD_CONFIGURATION=Debug \
OPENIM_TEST_VAPOR=false \
OPENIM_AUTOMATION_PREPROVISION=1 \
OPENIM_LOCAL_ANDROID_AUTOMATION_REBUILD=1 \
  node "$PROJECT_ROOT/scripts/run-openim-automation.mjs" android --device-id "$DEVICE_ID"
