#!/usr/bin/env bash

set -euo pipefail
readonly runner_root="$(cd "$(dirname "$0")/../.." && pwd)"
source "$runner_root/local-runtime/scripts/common.sh"

readonly profile="${OPENIM_UNI_TOOLCHAIN_PROFILE:?}"
readonly sdk_root="$(read_json "$profile" sdks.uniapp.ios.sdkRoot)"
readonly native_root="$PROJECT_ROOT/unpackage/local-runtime/classic-ios-host"
readonly export_root="$PROJECT_ROOT/unpackage/resources"
readonly app_id="${OPENIM_LOCAL_DCLOUD_APP_ID:?}"
readonly hbuilder_cli="$(resolve_hbuilder_cli)"
readonly pod_bin="$(read_json "$profile" hostTools.cocoapods.path)"
readonly output_root="$PROJECT_ROOT/unpackage/debug/ios-${OPENIM_LOCAL_PRODUCT}-${OPENIM_LOCAL_SURFACE}"
readonly deployment_target="$(node -e 'const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(d.iosHost?.deploymentTarget ?? "14.0"))' "$OPENIM_LOCAL_PRODUCT_DESCRIPTOR")"
verify_hbuilder_cli "$hbuilder_cli"
test -x "$pod_bin"

node "$runner_root/local-runtime/scripts/run-with-local-native-profile.mjs" ios -- \
  node "$runner_root/local-runtime/scripts/run-hbuilder-local.mjs" "$hbuilder_cli" -- \
    publish app-ios --type appResource --project "$PROJECT_ROOT"
test -d "$export_root/$app_id/www"

rm -rf "$native_root" "$output_root"
mkdir -p "$(dirname "$native_root")" "$output_root"
ditto "$sdk_root/HBuilder-Hello" "$native_root"
OPENIM_LOCAL_NATIVE_HOST="$native_root" OPENIM_LOCAL_UNIAPP_IOS_SDK="$sdk_root" \
  node "$runner_root/local-runtime/hosts/configure-classic-ios.mjs"
(
  cd "$native_root"
  "$pod_bin" install
  xcodebuild \
    -workspace HBuilder-Hello.xcworkspace \
    -scheme HBuilder \
    -configuration Debug \
    -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$native_root/DerivedData" \
    ARCHS=x86_64 \
    ONLY_ACTIVE_ARCH=YES \
    'EXCLUDED_ARCHS[sdk=iphonesimulator*]=arm64' \
    CODE_SIGNING_ALLOWED=NO \
    IPHONEOS_DEPLOYMENT_TARGET="$deployment_target" \
    PRODUCT_BUNDLE_IDENTIFIER="${OPENIM_LOCAL_APPLICATION_ID:?}" \
    CONFIGURATION_BUILD_DIR="$output_root" \
    build
)
readonly app="$output_root/HBuilder.app"
readonly dcloud_uts_ext_api="$sdk_root/SDK/Libs/DCloudUTSExtAPI.framework"
test -d "$app"
test -f "$dcloud_uts_ext_api/DCloudUTSExtAPI"
ditto "$dcloud_uts_ext_api" "$app/Frameworks/DCloudUTSExtAPI.framework"
test -f "$app/Pandora/apps/$app_id/www/manifest.json"
test -f "$app/Frameworks/OpenIMCore.framework/OpenIMCore"
test -f "$app/Frameworks/DCloudUTSExtAPI.framework/DCloudUTSExtAPI"
verify_required_ios_frameworks "$app"
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"
node -e '
  const fs = require("fs"); const crypto = require("crypto"); const path = process.argv[1];
  const files = []; const walk = (d) => fs.readdirSync(d).sort().forEach((n) => { const p = `${d}/${n}`; fs.statSync(p).isDirectory() ? walk(p) : files.push(p) }); walk(path);
  const hash = crypto.createHash("sha256"); for (const file of files) { hash.update(file.slice(path.length)); hash.update("\0"); hash.update(fs.readFileSync(file)); }
  fs.writeFileSync(process.argv[2], JSON.stringify({ appPath: path, appPayloadSha256: hash.digest("hex"), appFileCount: String(files.length) }, null, 2) + "\n");
' "$app" "$OPENIM_LOCAL_RUN_ROOT/artifacts.json"
