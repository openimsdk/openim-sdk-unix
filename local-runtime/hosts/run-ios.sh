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
