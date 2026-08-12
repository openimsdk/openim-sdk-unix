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
"$LOCAL_RUNTIME_ROOT/scripts/run-local-ios.sh"

readonly IOS_TARGET="${OPENIM_IOS_TARGET:-simulator}"
readonly APP_PATH="$(cat "$PROJECT_ROOT/unpackage/local-runtime/ios-app-path")"
readonly DEVICE_ID="$(cat "$PROJECT_ROOT/unpackage/local-runtime/ios-device-id")"

if [[ "$IOS_TARGET" == "simulator" ]]; then
  os_version="$(xcrun simctl list devices -j | node -e '
    let source = "";
    process.stdin.on("data", (chunk) => source += chunk);
    process.stdin.on("end", () => {
      const target = process.argv[1];
      for (const [runtime, devices] of Object.entries(JSON.parse(source).devices || {})) {
        if (devices.some((device) => device.udid === target)) {
          const match = runtime.match(/iOS-(\d+)-(\d+)/);
          if (match) process.stdout.write(`${match[1]}.${match[2]}`);
        }
      }
    });
  ' "$DEVICE_ID")"
  architecture="$(file "$APP_PATH/UniAppX" | rg -o 'arm64|x86_64' | head -n 1)"
  bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Info.plist")"
  xcrun simctl launch "$DEVICE_ID" "$bundle_id" >/dev/null
  device_kind=simulator
else
  os_version="${OPENIM_TEST_OS_VERSION:-unknown}"
  architecture=arm64
  device_kind=physical
fi

OPENIM_TEST_CUSTOM_BASE="$APP_PATH" \
OPENIM_TEST_DEVICE_ID="$DEVICE_ID" \
OPENIM_IOS_TARGET="$IOS_TARGET" \
OPENIM_TEST_DEVICE_KIND="$device_kind" \
OPENIM_TEST_OS_VERSION="$os_version" \
OPENIM_TEST_ARCHITECTURE="$architecture" \
OPENIM_TEST_BUILD_CONFIGURATION=Debug \
OPENIM_TEST_VAPOR=false \
OPENIM_AUTOMATION_PREPROVISION=1 \
  node "$PROJECT_ROOT/scripts/run-openim-automation.mjs" ios --device-id "$DEVICE_ID"
