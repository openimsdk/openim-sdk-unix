#!/usr/bin/env bash

set -euo pipefail
readonly runner_root="$(cd "$(dirname "$0")/../.." && pwd)"
bash "$runner_root/local-runtime/hosts/build-ios.sh"
readonly app="$(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(p.appPath)' "$OPENIM_LOCAL_RUN_ROOT/artifacts.json")"
readonly device="${OPENIM_TEST_DEVICE_ID:-$(xcrun simctl list devices booted -j | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const d=Object.values(JSON.parse(s).devices).flat().find(x=>x.state==="Booted"&&/iPhone/.test(x.name));if(d)process.stdout.write(d.udid)})')}"
test -n "$device"
xcrun simctl install "$device" "$app"
xcrun simctl terminate "$device" "${OPENIM_LOCAL_APPLICATION_ID:?}" 2>/dev/null || true
readonly launch_output="$(xcrun simctl launch "$device" "$OPENIM_LOCAL_APPLICATION_ID")"
readonly launch_pid="${launch_output##*: }"
if ! [[ "$launch_pid" =~ ^[0-9]+$ ]]; then
  echo "Unable to determine launched iOS process ID" >&2
  exit 1
fi
sleep 1
if ! kill -0 "$launch_pid" 2>/dev/null; then
  echo "Launched iOS process exited before runtime smoke verification" >&2
  exit 1
fi
test -d "$(xcrun simctl get_app_container "$device" "$OPENIM_LOCAL_APPLICATION_ID" app)"
readonly screenshots="$OPENIM_LOCAL_RUN_ROOT/screenshots"
readonly ready_timeout="${OPENIM_LOCAL_IOS_READY_TIMEOUT_SECONDS:-20}"
readonly ready_poll="${OPENIM_LOCAL_IOS_READY_POLL_SECONDS:-2}"
if ! [[ "$ready_timeout" =~ ^[0-9]+$ ]] || (( ready_timeout < 1 )); then
  echo "OPENIM_LOCAL_IOS_READY_TIMEOUT_SECONDS must be a positive integer" >&2
  exit 64
fi
if ! [[ "$ready_poll" =~ ^[0-9]+$ ]] || (( ready_poll < 1 )); then
  echo "OPENIM_LOCAL_IOS_READY_POLL_SECONDS must be a positive integer" >&2
  exit 64
fi
mkdir -p "$screenshots"
readonly ready_deadline=$((SECONDS + ready_timeout))
while true; do
  if ! kill -0 "$launch_pid" 2>/dev/null; then
    echo "Launched iOS process exited during runtime smoke verification" >&2
    exit 1
  fi
  xcrun simctl io "$device" screenshot "$screenshots/product-launch.png" >/dev/null
  sips -s format bmp "$screenshots/product-launch.png" --out "$screenshots/product-launch.bmp" >/dev/null
  if node "$runner_root/local-runtime/hosts/verify-nonblank-bmp.mjs" "$screenshots/product-launch.bmp" >/dev/null 2>&1; then
    node "$runner_root/local-runtime/hosts/verify-nonblank-bmp.mjs" "$screenshots/product-launch.bmp"
    break
  fi
  if (( SECONDS >= ready_deadline )); then
    node "$runner_root/local-runtime/hosts/verify-nonblank-bmp.mjs" "$screenshots/product-launch.bmp"
  fi
  sleep "$ready_poll"
done
