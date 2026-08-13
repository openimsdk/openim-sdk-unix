#!/usr/bin/env bash

set -euo pipefail
readonly runner_root="$(cd "$(dirname "$0")/../.." && pwd)"
bash "$runner_root/local-runtime/hosts/build-ios.sh"
readonly app="$(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(p.appPath)' "$OPENIM_LOCAL_RUN_ROOT/artifacts.json")"
readonly device="${OPENIM_TEST_DEVICE_ID:-$(xcrun simctl list devices booted -j | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const d=Object.values(JSON.parse(s).devices).flat().find(x=>x.state==="Booted"&&/iPhone/.test(x.name));if(d)process.stdout.write(d.udid)})')}"
test -n "$device"
readonly bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist")"
if [[ "$bundle_id" != "${OPENIM_LOCAL_APPLICATION_ID:?}" ]]; then
  echo "Assembled iOS host bundle identifier does not match the product descriptor" >&2
  exit 1
fi
node -e '
  const fs = require("fs");
  const path = process.argv[1];
  const descriptor = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const artifacts = JSON.parse(fs.readFileSync(path, "utf8"));
  const expected = descriptor.plugins.map((plugin) => plugin.id).sort();
  const actual = String(artifacts.iosProductPlugins || "").split(",").filter(Boolean).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Assembled iOS host plugin receipt does not match the product descriptor");
  artifacts.deviceID = process.argv[3];
  artifacts.bundleID = process.argv[4];
  const temporary = `${path}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(artifacts, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, path);
' "$OPENIM_LOCAL_RUN_ROOT/artifacts.json" "$OPENIM_LOCAL_PRODUCT_DESCRIPTOR" "$device" "$bundle_id"
xcrun simctl install "$device" "$app"
xcrun simctl terminate "$device" "$bundle_id" 2>/dev/null || true
readonly runtime_log_root="$(mktemp -d "${TMPDIR:-/tmp}/openim-local-ios-runtime.XXXXXX")"
trap 'rm -rf "$runtime_log_root"' EXIT
readonly runtime_stdout="$runtime_log_root/stdout.log"
readonly runtime_stderr="$runtime_log_root/stderr.log"
readonly launch_output="$(xcrun simctl launch --stdout="$runtime_stdout" --stderr="$runtime_stderr" "$device" "$bundle_id")"
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
test -d "$(xcrun simctl get_app_container "$device" "$bundle_id" app)"
node "$PROJECT_ROOT/scripts/configure-automation-env.mjs" \
  ios "$app" "$device" "$bundle_id" >/dev/null
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
rm -f "$screenshots/product-launch.previous.bmp"
readonly ready_deadline=$((SECONDS + ready_timeout))
marker_seen=0
while true; do
  if ! kill -0 "$launch_pid" 2>/dev/null; then
    echo "Launched iOS process exited during runtime smoke verification" >&2
    exit 1
  fi
  xcrun simctl io "$device" screenshot "$screenshots/product-launch.png" >/dev/null
  sips -s format bmp "$screenshots/product-launch.png" --out "$screenshots/product-launch.bmp" >/dev/null
  if node "$runner_root/local-runtime/hosts/verify-runtime-marker-bmp.mjs" \
    "$screenshots/product-launch.bmp" "$OPENIM_LOCAL_PRODUCT" "$OPENIM_LOCAL_SURFACE" >/dev/null 2>&1; then
    marker_seen=1
  fi
  frame_ready=0
  if [[ -f "$screenshots/product-launch.previous.bmp" ]] && \
    node "$runner_root/local-runtime/hosts/verify-stable-bmp.mjs" \
      "$screenshots/product-launch.previous.bmp" "$screenshots/product-launch.bmp" >/dev/null 2>&1; then
    frame_ready=1
  fi
  if (( marker_seen == 1 && frame_ready == 1 )); then
    node "$runner_root/local-runtime/hosts/verify-runtime-marker-bmp.mjs" \
      "$screenshots/product-launch.bmp" "$OPENIM_LOCAL_PRODUCT" "$OPENIM_LOCAL_SURFACE"
    node "$runner_root/local-runtime/hosts/verify-stable-bmp.mjs" \
      "$screenshots/product-launch.previous.bmp" "$screenshots/product-launch.bmp"
    break
  fi
  if (( SECONDS >= ready_deadline )); then
    if (( marker_seen == 0 )); then
      echo "runtime product-ready marker was not observed; refusing splash, HBuilder Hello, or loading UI" >&2
      exit 1
    fi
    echo "runtime product frames did not settle before the readiness timeout" >&2
    exit 1
  fi
  cp "$screenshots/product-launch.bmp" "$screenshots/product-launch.previous.bmp"
  sleep "$ready_poll"
done
