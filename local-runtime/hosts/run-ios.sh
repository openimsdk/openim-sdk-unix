#!/usr/bin/env bash

set -euo pipefail
readonly runner_root="$(cd "$(dirname "$0")/../.." && pwd)"
bash "$runner_root/local-runtime/hosts/build-ios.sh"
readonly app="$(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(p.appPath)' "$OPENIM_LOCAL_RUN_ROOT/artifacts.json")"
readonly device="${OPENIM_TEST_DEVICE_ID:-$(xcrun simctl list devices booted -j | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const d=Object.values(JSON.parse(s).devices).flat().find(x=>x.state==="Booted"&&/iPhone/.test(x.name));if(d)process.stdout.write(d.udid)})')}"
test -n "$device"
xcrun simctl install "$device" "$app"
xcrun simctl terminate "$device" "${OPENIM_LOCAL_APPLICATION_ID:?}" 2>/dev/null || true
xcrun simctl launch "$device" "$OPENIM_LOCAL_APPLICATION_ID" >/dev/null
test -d "$(xcrun simctl get_app_container "$device" "$OPENIM_LOCAL_APPLICATION_ID" app)"
sleep "${OPENIM_LOCAL_IOS_SETTLE_SECONDS:-5}"
readonly screenshots="$OPENIM_LOCAL_RUN_ROOT/screenshots"
mkdir -p "$screenshots"
xcrun simctl io "$device" screenshot "$screenshots/product-launch.png" >/dev/null
sips -s format bmp "$screenshots/product-launch.png" --out "$screenshots/product-launch.bmp" >/dev/null
node "$runner_root/local-runtime/hosts/verify-nonblank-bmp.mjs" "$screenshots/product-launch.bmp"
