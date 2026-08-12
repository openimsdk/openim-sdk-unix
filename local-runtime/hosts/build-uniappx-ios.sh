#!/usr/bin/env bash

set -euo pipefail
readonly runner_root="$(cd "$(dirname "$0")/../.." && pwd)"
source "$runner_root/local-runtime/scripts/common.sh"

readonly profile="${OPENIM_UNI_TOOLCHAIN_PROFILE:?}"
readonly sdk_root="$(read_json "$profile" sdks.uniappx.ios.sdkRoot)"
readonly ext_api_binary="$sdk_root/TemporarySampleFramework/DCloudUTSExtAPI.xcframework/ios-x86_64-simulator/DCloudUTSExtAPI.framework/DCloudUTSExtAPI"
test -f "$ext_api_binary"
readonly exported_archs="$(lipo -archs "$ext_api_binary")"
test -n "$exported_archs"
readonly native_root="$PROJECT_ROOT/unpackage/local-runtime/uniappx-ios-host"
readonly export_root="$PROJECT_ROOT/unpackage/resources/app-ios"
readonly app_id="${OPENIM_LOCAL_DCLOUD_APP_ID:?}"
readonly hbuilder_cli="$(resolve_hbuilder_cli)"
readonly pod_bin="$(read_json "$profile" hostTools.cocoapods.path)"
readonly pod_gem_home="$(cd "$(dirname "$pod_bin")/../libexec" && pwd)"
readonly pod_ruby="$(head -n 1 "$pod_gem_home/bin/pod" | sed 's/^#!//')"
readonly output_root="$PROJECT_ROOT/unpackage/debug/ios-${OPENIM_LOCAL_PRODUCT}-${OPENIM_LOCAL_SURFACE}"
verify_hbuilder_cli "$hbuilder_cli"
test -x "$pod_bin"
test -x "$pod_ruby"

node "$runner_root/local-runtime/scripts/run-with-local-native-profile.mjs" ios -- \
  node "$runner_root/local-runtime/scripts/run-hbuilder-local.mjs" "$hbuilder_cli" -- \
    publish app-ios --type appResource --project "$PROJECT_ROOT"
test -d "$export_root/$app_id/www"

rm -rf "$native_root" "$output_root"
mkdir -p "$native_root" "$output_root"
ditto "$sdk_root/UniAppXDemo" "$native_root/UniAppXDemo"
OPENIM_LOCAL_NATIVE_HOST="$native_root" OPENIM_LOCAL_UNIAPPX_IOS_SDK="$sdk_root" \
  node "$runner_root/local-runtime/hosts/configure-uniappx-ios.mjs"

readonly info_plist="$native_root/UniAppXDemo/UniAppXDemo/Info.plist"
/usr/libexec/PlistBuddy -c "Set :uniapp-x:appid $app_id" "$info_plist"
(
  cd "$native_root/UniAppXDemo"
  "$pod_bin" install
  GEM_HOME="$pod_gem_home" "$pod_ruby" \
    "$runner_root/local-runtime/hosts/prune-uniappx-sample-plugins.rb" \
    "$native_root/UniAppXDemo/UniAppXDemo.xcodeproj" \
    "${OPENIM_LOCAL_APPLICATION_ID:?}"
  xcodebuild \
    -workspace UniAppXDemo.xcworkspace \
    -scheme UniAppX \
    -configuration Debug \
    -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$native_root/DerivedData" \
    CODE_SIGNING_ALLOWED=NO \
    IPHONEOS_DEPLOYMENT_TARGET=14.0 \
    ARCHS="$exported_archs" \
    ONLY_ACTIVE_ARCH=YES \
    CONFIGURATION_BUILD_DIR="$output_root" \
    build
)
readonly app="$output_root/UniAppX.app"
test -d "$app"
mkdir -p "$app/Frameworks"
embed_framework() {
  local framework="$1"
  local target="$app/Frameworks/$(basename "$framework")"
  test -d "$framework"
  if [[ -e "$target" ]]; then
    echo "Duplicate embedded framework: $(basename "$framework")" >&2
    exit 1
  fi
  ditto "$framework" "$target"
}

while IFS=$'\t' read -r plugin_id pod_name; do
  wrapper="$output_root/$pod_name.framework"
  if [[ ! -d "$wrapper" ]]; then
    echo "Expected generated iOS wrapper framework for $plugin_id: $wrapper" >&2
    exit 1
  fi
  embed_framework "$wrapper"
  intermediates="$native_root/DerivedData/Build/Products/Debug-iphonesimulator/XCFrameworkIntermediates/$pod_name"
  if [[ -d "$intermediates" ]]; then
    while IFS= read -r framework; do
      embed_framework "$framework"
    done < <(find "$intermediates" -maxdepth 1 -type d -name '*.framework' -print | sort)
  fi
done < <(node -e '
  const fs = require("fs");
  const descriptor = JSON.parse(fs.readFileSync(process.env.OPENIM_LOCAL_PRODUCT_DESCRIPTOR, "utf8"));
  const camelize = (name) => name.split(/[^A-Za-z0-9]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join("");
  for (const plugin of descriptor.plugins) process.stdout.write(`${plugin.id}\tunimodule${camelize(plugin.id)}\n`);
')
test -f "$app/uni-app-x/apps/$app_id/www/manifest.json"
test -f "$app/Frameworks/OpenIMCore.framework/OpenIMCore"
test -f "$app/Frameworks/unimoduleUnixOpenimSdk.framework/unimoduleUnixOpenimSdk"
test -f "$app/PrivacyInfo.xcprivacy"
verify_required_ios_frameworks "$app"
if find "$app/Frameworks" -maxdepth 1 -type d -name 'OpenIMCore.framework' | awk 'END { exit NR == 1 ? 0 : 1 }'; then :; else
  echo "Expected exactly one OpenIMCore.framework in the uni-app x iOS host" >&2
  exit 1
fi
codesign --verify --deep --strict "$app" 2>/dev/null || true
node -e '
  const fs = require("fs"); const crypto = require("crypto"); const path = process.argv[1];
  const files = []; const walk = (d) => fs.readdirSync(d).sort().forEach((n) => { const p = `${d}/${n}`; fs.statSync(p).isDirectory() ? walk(p) : files.push(p) }); walk(path);
  const hash = crypto.createHash("sha256"); for (const file of files) { hash.update(file.slice(path.length)); hash.update("\0"); hash.update(fs.readFileSync(file)); }
  fs.writeFileSync(process.argv[2], JSON.stringify({ appPath: path, appPayloadSha256: hash.digest("hex"), appFileCount: String(files.length) }, null, 2) + "\n");
' "$app" "$OPENIM_LOCAL_RUN_ROOT/artifacts.json"
