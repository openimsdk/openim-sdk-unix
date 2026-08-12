#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"

readonly NATIVE_ROOT="$PROJECT_ROOT/unpackage/local-runtime/android-host"
readonly TEMPLATE_ROOT="$LOCAL_RUNTIME_ROOT/native-android-template"
readonly EXPORT_ROOT="$PROJECT_ROOT/unpackage/resources/app-android"
readonly LOCAL_APK="$PROJECT_ROOT/unpackage/debug/unix-openim-sdk-local.apk"
readonly HBUILDER_CLI="$(resolve_hbuilder_cli)"
readonly ANDROID_SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
readonly SDK_ROOT="${OPENIM_DCLOUD_ANDROID_SDK_ROOT:-$HOME/Library/Caches/DCloud/uni-app-x-sdk/5.23/Android-uni-app-x-SDK@14987-5.23}"
readonly SDK_ZIP="${OPENIM_DCLOUD_ANDROID_SDK_ZIP:-${SDK_ROOT}.zip}"

verify_hbuilder_cli "$HBUILDER_CLI"
node "$LOCAL_RUNTIME_ROOT/scripts/prepare-local-native-artifacts.mjs" android

expected_sdk_sha="$(read_json "$HARNESS_LOCK" android.dcloudSDKZipSha256)"
if [[ ! -d "$SDK_ROOT/SDK/libs" || ! -d "$SDK_ROOT/plugins" || ! -f "$SDK_ZIP" ]]; then
  echo "Locked uni-app x Android SDK is unavailable; set OPENIM_DCLOUD_ANDROID_SDK_ROOT and OPENIM_DCLOUD_ANDROID_SDK_ZIP" >&2
  exit 1
fi
if [[ "$(sha256_file "$SDK_ZIP")" != "$expected_sdk_sha" ]]; then
  echo "uni-app x Android SDK checksum mismatch: $SDK_ZIP" >&2
  exit 1
fi

mkdir -p "$NATIVE_ROOT"
rsync -a --delete \
  --exclude '/.gradle/' \
  --exclude '/*/build/' \
  --exclude '/gradle/wrapper/' \
  --exclude '/gradlew' \
  --exclude '/gradlew.bat' \
  "$TEMPLATE_ROOT/" "$NATIVE_ROOT/"

OPENIM_NATIVE_ANDROID_ROOT="$NATIVE_ROOT" \
  node "$LOCAL_RUNTIME_ROOT/scripts/configure-native-android.mjs" >/dev/null

node "$LOCAL_RUNTIME_ROOT/scripts/run-with-local-native-profile.mjs" android -- \
  node "$LOCAL_RUNTIME_ROOT/scripts/run-hbuilder-local.mjs" "$HBUILDER_CLI" -- \
    publish app-android --type appResource --project "$PROJECT_ROOT"

app_id="$(read_app_id)"
if [[ ! -d "$EXPORT_ROOT/$app_id/www" ]]; then
  echo "HBuilderX appResource export did not contain $app_id" >&2
  exit 1
fi

sync_plugin() {
  local source_root="$EXPORT_ROOT/uni_modules/unix-openim-sdk/utssdk/app-android"
  local target_root="$NATIVE_ROOT/unix-openim-sdk"
  if [[ ! -d "$source_root/src" || ! -d "$source_root/libs" ]]; then
    echo "Exported unix-openim-sdk Android module is incomplete" >&2
    exit 1
  fi
  mkdir -p "$target_root/src/main/java" "$target_root/src/main/res" "$target_root/libs"
  rsync -a --delete "$source_root/src/" "$target_root/src/main/java/"
  rsync -a --delete "$source_root/libs/" "$target_root/libs/"
  if [[ -d "$source_root/res" ]]; then
    rsync -a --delete "$source_root/res/" "$target_root/src/main/res/"
  fi
  if [[ -f "$source_root/AndroidManifest.xml" ]]; then
    cp "$source_root/AndroidManifest.xml" "$target_root/src/main/AndroidManifest.xml"
    perl -0pi -e 's/\s+package="[^"]+"//' "$target_root/src/main/AndroidManifest.xml"
  fi
}

mkdir -p \
  "$NATIVE_ROOT/uniappx/src/main/java" \
  "$NATIVE_ROOT/uniappx/src/main/assets/apps/$app_id" \
  "$NATIVE_ROOT/dcloud-libs" \
  "$NATIVE_ROOT/plugins"

if [[ -d "$EXPORT_ROOT/uniappx/app-android/src" ]]; then
  rsync -a --delete \
    "$EXPORT_ROOT/uniappx/app-android/src/" \
    "$NATIVE_ROOT/uniappx/src/main/java/"
else
  # Vapor bytecode exports page/app code under the app assets and do not emit
  # generated Kotlin page sources. The UTS module remains a native Gradle
  # module, while UniAppActivity loads the bytecode payload from assets.
  find "$NATIVE_ROOT/uniappx/src/main/java" -mindepth 1 -delete
fi
rsync -a --delete \
  "$EXPORT_ROOT/$app_id/" \
  "$NATIVE_ROOT/uniappx/src/main/assets/apps/$app_id/"
sync_plugin

expected_openim_aar_sha="$(read_json "$TOOLCHAIN_LOCK" publicNative.android.sha256)"
exported_openim_aar="$NATIVE_ROOT/unix-openim-sdk/libs/open_im_sdk.aar"
if [[ ! -f "$exported_openim_aar" || "$(sha256_file "$exported_openim_aar")" != "$expected_openim_aar_sha" ]]; then
  echo "Exported Public OpenIM AAR is absent or stale: $exported_openim_aar" >&2
  exit 1
fi

dcloud_lib_names=(
  uts-runtime-release.aar
  android-gif-drawable-1.2.30.aar
  app-common-release.aar
  app-runtime-release.aar
  breakpad-build-release.aar
  debug-server-release.aar
  dcloud-layout-release.aar
  framework-release.aar
  uni-clipboard-release.aar
  uni-exit-release.aar
  uni-fileSystemManager-release.aar
  uni-getAccessibilityInfo-release.aar
  uni-getAppAuthorizeSetting-release.aar
  uni-getAppBaseInfo-release.aar
  uni-getDeviceInfo-release.aar
  uni-getSystemInfo-release.aar
  uni-getSystemSetting-release.aar
  uni-keyboard-release.aar
  uni-network-release.aar
  uni-openAppAuthorizeSetting-release.aar
  uni-picker-release.aar
  uni-prompt-release.aar
  uni-showLoading-release.aar
  uni-modal-release.aar
  uni-actionSheet-release.aar
  uni-rpx2px-release.aar
  uni-storage-release.aar
  uni-theme-release.aar
  uni-websocket-release.aar
)

for existing in "$NATIVE_ROOT/dcloud-libs"/*; do
  [[ -f "$existing" ]] && unlink "$existing"
done
for lib_name in "${dcloud_lib_names[@]}"; do
  source_lib="$SDK_ROOT/SDK/libs/$lib_name"
  if [[ ! -f "$source_lib" ]]; then
    echo "Required DCloud library is missing: $source_lib" >&2
    exit 1
  fi
  cp "$source_lib" "$NATIVE_ROOT/dcloud-libs/$lib_name"
done

for existing in "$NATIVE_ROOT/plugins"/*; do
  [[ -f "$existing" ]] && unlink "$existing"
done
for plugin_name in \
  uts-kotlin-compiler-plugin-0.0.1.jar \
  uts-kotlin-gradle-plugin-0.0.1.jar; do
  source_plugin="$SDK_ROOT/plugins/$plugin_name"
  if [[ ! -f "$source_plugin" ]]; then
    echo "Required UTS Gradle plugin is missing: $source_plugin" >&2
    exit 1
  fi
  expected_key="android.utsKotlinGradlePluginSha256"
  [[ "$plugin_name" == uts-kotlin-compiler-plugin-* ]] && expected_key="android.utsKotlinCompilerPluginSha256"
  if [[ "$(sha256_file "$source_plugin")" != "$(read_json "$HARNESS_LOCK" "$expected_key")" ]]; then
    echo "UTS Gradle plugin checksum mismatch: $plugin_name" >&2
    exit 1
  fi
  cp "$source_plugin" "$NATIVE_ROOT/plugins/$plugin_name"
done

hbuilder_contents="$(cd "$(dirname "$HBUILDER_CLI")/.." && pwd)"
java_runtime="${OPENIM_JAVA_HOME:-$hbuilder_contents/HBuilderX/plugins/amazon-corretto}"
if [[ ! -x "$java_runtime/bin/java" ]]; then
  echo "HBuilderX Corretto runtime is unavailable: $java_runtime" >&2
  exit 1
fi

if [[ ! -f "$NATIVE_ROOT/gradle/wrapper/gradle-wrapper.jar" || ! -x "$NATIVE_ROOT/gradlew" ]]; then
  gradle_bootstrap="$(resolve_gradle_bootstrap)"
  (
    cd "$NATIVE_ROOT"
    JAVA_HOME="$java_runtime" ANDROID_HOME="$ANDROID_SDK" \
      "$gradle_bootstrap" wrapper \
        --gradle-version "$(read_json "$HARNESS_LOCK" android.gradleVersion)" \
        --distribution-type bin
  )
fi

(
  cd "$NATIVE_ROOT"
  JAVA_HOME="$java_runtime" ANDROID_HOME="$ANDROID_SDK" \
    ./gradlew --no-daemon --stacktrace --rerun-tasks :app:assembleDebug
)

built_apk="$NATIVE_ROOT/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "$built_apk" ]]; then
  echo "Gradle did not produce $built_apk" >&2
  exit 1
fi
mkdir -p "$(dirname "$LOCAL_APK")"
ditto "$built_apk" "$LOCAL_APK"

apk_entries="$(zipinfo -1 "$LOCAL_APK")"
for abi in arm64-v8a x86_64; do
  count="$(printf '%s\n' "$apk_entries" | awk -v path="lib/$abi/libgojni.so" '$0 == path {count++} END {print count+0}')"
  if [[ "$count" != "1" ]]; then
    echo "Expected exactly one $abi libgojni.so in local APK, found $count" >&2
    exit 1
  fi
done
if ! printf '%s\n' "$apk_entries" | rg -q '^classes[0-9]*\.dex$'; then
  echo "Local APK contains no DEX files" >&2
  exit 1
fi

dex_strings="$PROJECT_ROOT/unpackage/local-runtime/android-dex-strings.txt"
mkdir -p "$(dirname "$dex_strings")"
: > "$dex_strings"
while IFS= read -r dex; do
  unzip -p "$LOCAL_APK" "$dex" | strings >> "$dex_strings"
done < <(printf '%s\n' "$apk_entries" | rg '^classes[0-9]*\.dex$')
if ! rg -q 'Luts/sdk/modules/unixOpenimSdk/' "$dex_strings"; then
  echo "Local APK does not contain the unix-openim-sdk UTS module" >&2
  exit 1
fi
if ! rg -q 'Luts/sdk/modules/DCloudUniWebsocket/' "$dex_strings"; then
  echo "Local APK does not contain uni-websocket" >&2
  exit 1
fi
if ! rg -q 'Lio/dcloud/debug/PullDebugActivity;' "$dex_strings"; then
  echo "Local APK does not contain the DCloud PullDebugActivity required by uniapp.test" >&2
  exit 1
fi

shasum -a 256 "$LOCAL_APK"
echo "Local Android APK ready: $LOCAL_APK"
