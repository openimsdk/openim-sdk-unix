#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"

if [[ "$#" -ne 2 ]]; then
  echo "Usage: rebuild-local-android-automation.sh <automator-port> <device-id>" >&2
  exit 1
fi

readonly OPENIM_AUTOMATOR_PORT="$1"
readonly DEVICE_ID="$2"
readonly GENERATED_SOURCE="$PROJECT_ROOT/unpackage/dist/dev/cache/.app-android/src/index.kt"
readonly NATIVE_ROOT="$PROJECT_ROOT/unpackage/local-runtime/android-host"
readonly LOCAL_APK="$PROJECT_ROOT/unpackage/debug/unix-openim-sdk-local.apk"
readonly ADB="$(resolve_adb)"
readonly HBUILDER_CLI="$(resolve_hbuilder_cli)"
readonly ANDROID_SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"

if [[ ! "$OPENIM_AUTOMATOR_PORT" =~ ^[0-9]+$ ]]; then
  echo "Invalid automator port: $OPENIM_AUTOMATOR_PORT" >&2
  exit 1
fi
if [[ ! -f "$GENERATED_SOURCE" ]]; then
  echo "HBuilderX did not generate the Android automator Kotlin source: $GENERATED_SOURCE" >&2
  exit 1
fi
if ! rg -q "wsEndpoint = .*:${OPENIM_AUTOMATOR_PORT}" "$GENERATED_SOURCE" || \
   ! rg -q 'initAutomator\(\)' "$GENERATED_SOURCE"; then
  echo "Generated Android source does not target the allocated automator port $OPENIM_AUTOMATOR_PORT" >&2
  exit 1
fi
if [[ ! -x "$NATIVE_ROOT/gradlew" ]]; then
  echo "Local Android host is not prepared; run local:run:android first" >&2
  exit 1
fi

rsync -a "$GENERATED_SOURCE" "$NATIVE_ROOT/uniappx/src/main/java/index.kt"

hbuilder_contents="$(cd "$(dirname "$HBUILDER_CLI")/.." && pwd)"
java_runtime="${OPENIM_JAVA_HOME:-$hbuilder_contents/HBuilderX/plugins/amazon-corretto}"
if [[ ! -x "$java_runtime/bin/java" ]]; then
  echo "HBuilderX Corretto runtime is unavailable: $java_runtime" >&2
  exit 1
fi

(
  cd "$NATIVE_ROOT"
  JAVA_HOME="$java_runtime" ANDROID_HOME="$ANDROID_SDK" \
    ./gradlew --no-daemon --rerun-tasks :app:assembleDebug
)

built_apk="$NATIVE_ROOT/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "$built_apk" ]]; then
  echo "Gradle did not produce the Android automation host" >&2
  exit 1
fi
mkdir -p "$(dirname "$LOCAL_APK")"
ditto "$built_apk" "$LOCAL_APK"

endpoint_found=0
while IFS= read -r dex; do
  # Avoid `rg -q`: under pipefail its early exit can turn the upstream
  # unzip/strings SIGPIPE into a false-negative endpoint check.
  if unzip -p "$LOCAL_APK" "$dex" | strings | rg ":${OPENIM_AUTOMATOR_PORT}" >/dev/null; then
    endpoint_found=1
  fi
done < <(zipinfo -1 "$LOCAL_APK" | rg '^classes[0-9]*\.dex$')
if [[ "$endpoint_found" != "1" ]]; then
  echo "Rebuilt Android host does not contain the allocated automator endpoint" >&2
  exit 1
fi

"$ADB" -s "$DEVICE_ID" install -r -g "$LOCAL_APK" >/dev/null
package_name="$(android_package_name)"
"$ADB" -s "$DEVICE_ID" shell am force-stop "$package_name"
"$ADB" -s "$DEVICE_ID" shell am start \
  -n "$package_name/io.dcloud.uniapp.UniAppActivity" >/dev/null

echo "[openim-local] Android automation host rebuilt, installed, and launched for port $OPENIM_AUTOMATOR_PORT"
