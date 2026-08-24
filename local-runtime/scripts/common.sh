#!/usr/bin/env bash

set -euo pipefail

readonly LOCAL_RUNTIME_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly RUNNER_PROJECT_ROOT="$(cd "$LOCAL_RUNTIME_ROOT/.." && pwd)"
readonly PROJECT_ROOT="$(cd "${OPENIM_LOCAL_PROJECT_ROOT:-$RUNNER_PROJECT_ROOT}" && pwd)"
readonly HARNESS_LOCK="$LOCAL_RUNTIME_ROOT/harness-lock.json"
readonly TOOLCHAIN_LOCK="$RUNNER_PROJECT_ROOT/toolchain.lock.json"

read_json() {
  node -e '
    const fs = require("fs");
    const document = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const keys = process.argv[2].split(".");
    let value = document;
    for (const key of keys) value = value[key];
    process.stdout.write(Array.isArray(value) ? value.join(",") : String(value));
  ' "$1" "$2"
}
sha256_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

resolve_hbuilder_cli() {
  local explicit="${OPENIM_HBUILDERX_CLI:-${OPENIM_HBUILDER_CLI:-}}"
  if [[ -n "$explicit" && -x "$explicit" ]]; then
    printf '%s\n' "$explicit"
    return
  fi
  local candidate
  for candidate in \
    /Applications/HBuilderX-Alpha.app/Contents/MacOS/cli \
    /Applications/HBuilderX.app/Contents/MacOS/cli; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return
    fi
  done
  echo "HBuilderX CLI is unavailable; set OPENIM_HBUILDERX_CLI" >&2
  return 1
}

verify_hbuilder_cli() {
  local cli="$1"
  local expected
  expected="$(read_json "$TOOLCHAIN_LOCK" hbuilderx.cliSha256)"
  local actual
  actual="$(sha256_file "$cli")"
  if [[ "$actual" != "$expected" ]]; then
    echo "HBuilderX CLI checksum mismatch: $cli" >&2
    return 1
  fi
}

resolve_adb() {
  local explicit="${OPENIM_ADB_BIN:-${ADB_BIN:-}}"
  if [[ -n "$explicit" && -x "$explicit" ]]; then
    printf '%s\n' "$explicit"
    return
  fi
  local android_sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
  local candidate
  for candidate in \
    /Applications/HBuilderX-Alpha.app/Contents/HBuilderX/plugins/launcher-tools/tools/adbs/adb_osx \
    /Applications/HBuilderX-Alpha.app/Contents/HBuilderX/plugins/launcher-tools/tools/adbs/adb \
    "$android_sdk/platform-tools/adb"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return
    fi
  done
  echo "adb is unavailable; set OPENIM_ADB_BIN or ANDROID_HOME" >&2
  return 1
}

resolve_gradle_bootstrap() {
  if [[ -n "${OPENIM_GRADLE_BIN:-}" && -x "$OPENIM_GRADLE_BIN" ]]; then
    printf '%s\n' "$OPENIM_GRADLE_BIN"
    return
  fi
  local command_path
  command_path="$(command -v gradle || true)"
  if [[ -n "$command_path" ]]; then
    printf '%s\n' "$command_path"
    return
  fi
  local gradle_home="${GRADLE_USER_HOME:-$HOME/.gradle}"
  local candidate
  for candidate in "$gradle_home"/wrapper/dists/gradle-8.14*/**/gradle-8.14*/bin/gradle; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return
    fi
  done
  echo "Gradle bootstrap is unavailable; set OPENIM_GRADLE_BIN" >&2
  return 1
}

read_app_id() {
  node -e '
    const fs = require("fs");
    const source = fs.readFileSync(process.argv[1], "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    process.stdout.write(JSON.parse(source).appid || "");
  ' "$PROJECT_ROOT/manifest.json"
}

android_package_name() {
  local app_id
  app_id="$(read_app_id)"
  local suffix="${app_id#__UNI__}"
  printf '%s\n' "${OPENIM_ANDROID_PACKAGE:-uni.app.${suffix}.local}"
}

resolve_android_device() {
  local adb_bin="$1"
  local requested="${OPENIM_TEST_DEVICE_ID:-${OPENIM_ANDROID_DEVICE_ID:-}}"
  if [[ -n "$requested" ]]; then
    if [[ "$("$adb_bin" -s "$requested" get-state 2>/dev/null || true)" != "device" ]]; then
      echo "Android device is not ready: $requested" >&2
      return 1
    fi
    printf '%s\n' "$requested"
    return
  fi
  local device
  device="$("$adb_bin" devices | awk 'NR > 1 && $2 == "device" {print $1; exit}')"
  if [[ -z "$device" ]]; then
    echo "No connected Android device or emulator was found" >&2
    return 1
  fi
  printf '%s\n' "$device"
}

resolve_ios_simulator() {
  local requested="${OPENIM_IOS_SIMULATOR_UDID:-${OPENIM_TEST_DEVICE_ID:-}}"
  if [[ -n "$requested" ]]; then
    printf '%s\n' "$requested"
    return
  fi
  xcrun simctl list devices booted -j | node -e '
    let source = "";
    process.stdin.on("data", (chunk) => source += chunk);
    process.stdin.on("end", () => {
      const devices = Object.values(JSON.parse(source).devices || {}).flat();
      const target = devices.find((item) => item.state === "Booted" && item.isAvailable !== false && /iPhone/.test(item.name));
      if (target) process.stdout.write(target.udid);
    });
  '
}

ensure_ios_simulator() {
  local simulator
  simulator="$(resolve_ios_simulator)"
  if [[ -n "$simulator" ]]; then
    printf '%s\n' "$simulator"
    return
  fi
  simulator="$(xcrun simctl list devices available -j | node -e '
    let source = "";
    process.stdin.on("data", (chunk) => source += chunk);
    process.stdin.on("end", () => {
      const entries = Object.entries(JSON.parse(source).devices || {}).reverse();
      const devices = entries.flatMap((entry) => entry[1]);
      const target = devices.find((item) => item.isAvailable !== false && /iPhone 17 Pro/.test(item.name)) ||
        devices.find((item) => item.isAvailable !== false && /iPhone/.test(item.name));
      if (target) process.stdout.write(target.udid);
    });
  ')"
  if [[ -z "$simulator" ]]; then
    echo "No available iPhone Simulator was found" >&2
    return 1
  fi
  xcrun simctl boot "$simulator" >/dev/null 2>&1 || true
  open -a Simulator --args -CurrentDeviceUDID "$simulator"
  xcrun simctl bootstatus "$simulator" -b
  printf '%s\n' "$simulator"
}

verify_required_ios_frameworks() {
  local app_bundle="$1"
  while IFS= read -r framework; do
    [[ -z "$framework" ]] && continue
    if [[ ! "$framework" =~ ^[A-Za-z0-9_+.-]+$ ]]; then
      echo "Invalid required iOS framework name: $framework" >&2
      return 1
    fi
    local count
    count="$(find "$app_bundle/Frameworks" -maxdepth 1 -type d -name "$framework.framework" | wc -l | tr -d ' ')"
    if [[ "$count" != "1" ]]; then
      echo "Expected exactly one $framework.framework in the assembled iOS app, found $count" >&2
      return 1
    fi
  done < <(node -e '
    const fs = require("fs");
    const descriptor = JSON.parse(fs.readFileSync(process.env.OPENIM_LOCAL_PRODUCT_DESCRIPTOR, "utf8"));
    const required = [...(descriptor.iosHost?.requiredFrameworks ?? [])];
    if (process.env.OPENIM_LOCAL_SURFACE === "uniappx") required.push(...(descriptor.iosHost?.uniappxRequiredFrameworks ?? []));
    for (const framework of required) process.stdout.write(framework + "\n");
  ')
}
