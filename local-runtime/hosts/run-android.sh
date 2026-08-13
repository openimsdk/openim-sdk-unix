#!/usr/bin/env bash

set -euo pipefail
readonly runner_root="$(cd "$(dirname "$0")/../.." && pwd)"
bash "$runner_root/local-runtime/hosts/build-android.sh"
source "$runner_root/local-runtime/scripts/common.sh"
readonly apk="$(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(p.apkPath)' "$OPENIM_LOCAL_RUN_ROOT/artifacts.json")"
readonly adb="$(resolve_adb)"
readonly device="$(resolve_android_device "$adb")"
readonly package="${OPENIM_LOCAL_APPLICATION_ID:?}"
if [[ "${OPENIM_LOCAL_SURFACE:?}" == "uniappx" ]]; then
  readonly activity="io.dcloud.uniapp.UniAppActivity"
else
  readonly activity="io.dcloud.PandoraEntry"
fi
"$adb" -s "$device" install -r -d "$apk" </dev/null
"$adb" -s "$device" shell am force-stop "$package" </dev/null
"$adb" -s "$device" logcat -c </dev/null
"$adb" -s "$device" shell am start -W -n "$package/$activity" </dev/null
test -n "$("$adb" -s "$device" shell pidof "$package" | tr -d '\r')"
node "$PROJECT_ROOT/scripts/configure-automation-env.mjs" \
  android "$apk" "$device" "$package" >/dev/null
mkdir -p "$PROJECT_ROOT/unpackage/local-runtime"
printf '%s\n' "$device" > "$PROJECT_ROOT/unpackage/local-runtime/android-device-id"
readonly screenshots="$OPENIM_LOCAL_RUN_ROOT/screenshots"
readonly ready_marker="OPENIM_LOCAL_RUNTIME_READY:v1:${OPENIM_LOCAL_PRODUCT:?}:${OPENIM_LOCAL_SURFACE:?}"
readonly ready_timeout="${OPENIM_LOCAL_ANDROID_READY_TIMEOUT_SECONDS:-20}"
readonly ready_poll="${OPENIM_LOCAL_ANDROID_READY_POLL_SECONDS:-2}"
if ! [[ "$ready_timeout" =~ ^[0-9]+$ ]] || (( ready_timeout < 1 )); then
  echo "OPENIM_LOCAL_ANDROID_READY_TIMEOUT_SECONDS must be a positive integer" >&2
  exit 64
fi
if ! [[ "$ready_poll" =~ ^[0-9]+$ ]] || (( ready_poll < 1 )); then
  echo "OPENIM_LOCAL_ANDROID_READY_POLL_SECONDS must be a positive integer" >&2
  exit 64
fi
mkdir -p "$screenshots"
rm -f "$screenshots/product-launch.previous.bmp"
readonly ready_deadline=$((SECONDS + ready_timeout))
marker_seen=0
while true; do
  test -n "$("$adb" -s "$device" shell pidof "$package" | tr -d '\r')"
  if "$adb" -s "$device" logcat -d -v brief 2>/dev/null | \
    node "$runner_root/local-runtime/hosts/verify-runtime-ready.mjs" --marker "$ready_marker" >/dev/null 2>&1; then
    marker_seen=1
  fi
  "$adb" -s "$device" exec-out screencap -p >"$screenshots/product-launch.png"
  sips -s format bmp "$screenshots/product-launch.png" --out "$screenshots/product-launch.bmp" >/dev/null
  frame_ready=0
  if node "$runner_root/local-runtime/hosts/verify-nonblank-bmp.mjs" "$screenshots/product-launch.bmp" >/dev/null 2>&1 && \
    [[ -f "$screenshots/product-launch.previous.bmp" ]] && \
    node "$runner_root/local-runtime/hosts/verify-stable-bmp.mjs" \
      "$screenshots/product-launch.previous.bmp" "$screenshots/product-launch.bmp" >/dev/null 2>&1; then
    frame_ready=1
  fi
  if (( marker_seen == 1 && frame_ready == 1 )); then
    "$adb" -s "$device" logcat -d -v brief 2>/dev/null | \
      node "$runner_root/local-runtime/hosts/verify-runtime-ready.mjs" --marker "$ready_marker"
    node "$runner_root/local-runtime/hosts/verify-nonblank-bmp.mjs" "$screenshots/product-launch.bmp"
    node "$runner_root/local-runtime/hosts/verify-stable-bmp.mjs" \
      "$screenshots/product-launch.previous.bmp" "$screenshots/product-launch.bmp"
    break
  fi
  if (( SECONDS >= ready_deadline )); then
    if (( marker_seen == 0 )); then
      echo "runtime product-ready marker was not observed; refusing splash, HBuilder Hello, or loading UI" >&2
      exit 1
    fi
    node "$runner_root/local-runtime/hosts/verify-nonblank-bmp.mjs" "$screenshots/product-launch.bmp"
    echo "runtime product frames did not settle before the readiness timeout" >&2
    exit 1
  fi
  if node "$runner_root/local-runtime/hosts/verify-nonblank-bmp.mjs" "$screenshots/product-launch.bmp" >/dev/null 2>&1; then
    cp "$screenshots/product-launch.bmp" "$screenshots/product-launch.previous.bmp"
  fi
  sleep "$ready_poll"
done
