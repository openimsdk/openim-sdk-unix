#!/usr/bin/env bash

set -euo pipefail
readonly runner_root="$(cd "$(dirname "$0")/../.." && pwd)"
source "$runner_root/local-runtime/scripts/common.sh"

readonly profile="${OPENIM_UNI_TOOLCHAIN_PROFILE:?}"
readonly sdk_root="$(read_json "$profile" sdks.uniapp.android.sdkRoot)"
readonly native_root="$PROJECT_ROOT/unpackage/local-runtime/classic-android-host"
readonly export_root="$PROJECT_ROOT/unpackage/resources"
readonly app_id="${OPENIM_LOCAL_DCLOUD_APP_ID:?}"
readonly apk="$PROJECT_ROOT/unpackage/debug/${OPENIM_LOCAL_PRODUCT}-${OPENIM_LOCAL_SURFACE}-local.apk"
readonly hbuilder_cli="$(resolve_hbuilder_cli)"

verify_hbuilder_cli "$hbuilder_cli"
node "$runner_root/local-runtime/scripts/run-with-local-native-profile.mjs" android -- \
  node "$runner_root/local-runtime/scripts/run-hbuilder-local.mjs" "$hbuilder_cli" -- \
    publish app-android --type appResource --project "$PROJECT_ROOT"
test -d "$export_root/$app_id/www"

rm -rf "$native_root"
mkdir -p "$(dirname "$native_root")"
ditto "$sdk_root/UniPlugin-Hello-AS" "$native_root"
OPENIM_LOCAL_NATIVE_HOST="$native_root" node "$runner_root/local-runtime/hosts/configure-classic-android.mjs"

while IFS= read -r library; do
  [[ -z "$library" ]] && continue
  source_library="$sdk_root/SDK/libs/$library"
  if [[ ! -f "$source_library" ]]; then
    echo "Required classic Android library is missing: $source_library" >&2
    exit 1
  fi
  cp "$source_library" "$native_root/app/libs/$library"
done < <(node -e '
  const fs = require("fs");
  const descriptor = JSON.parse(fs.readFileSync(process.env.OPENIM_LOCAL_PRODUCT_DESCRIPTOR, "utf8"));
  for (const library of descriptor.classicAndroidLibraries ?? []) process.stdout.write(library + "\n");
')

if [[ "${OPENIM_LOCAL_CLASSIC_VIDEO:-0}" == "1" ]]; then
  for library in weex_videoplayer-release.aar media-release.aar; do
    source_library="$sdk_root/SDK/libs/$library"
    test -f "$source_library"
    cp "$source_library" "$native_root/app/libs/$library"
  done
fi

readonly java_home="$(dirname "$(dirname "$(read_json "$profile" hostTools.java.path)")")"
readonly android_sdk="$(read_json "$profile" hostTools.androidSDK.path)"
(
  cd "$native_root"
  JAVA_HOME="$java_home" ANDROID_HOME="$android_sdk" ./gradlew --no-daemon --stacktrace --rerun-tasks :app:assembleDebug
)
readonly built="$native_root/app/build/outputs/apk/debug/app-debug.apk"
test -f "$built"
mkdir -p "$(dirname "$apk")"
ditto "$built" "$apk"

entries="$(zipinfo -1 "$apk")"
printf '%s\n' "$entries" | rg -q "assets/apps/$app_id/www/manifest.json"
for abi in arm64-v8a x86_64; do
  count="$(printf '%s\n' "$entries" | awk -v path="lib/$abi/libgojni.so" '$0 == path {count++} END {print count+0}')"
  [[ "$count" == "1" ]]
done
node -e '
  const fs = require("fs"); const crypto = require("crypto");
  const bytes = fs.readFileSync(process.argv[1]);
  fs.writeFileSync(process.argv[2], JSON.stringify({ apkPath: process.argv[1], apkSha256: crypto.createHash("sha256").update(bytes).digest("hex"), apkBytes: String(bytes.length) }, null, 2) + "\n");
' "$apk" "$OPENIM_LOCAL_RUN_ROOT/artifacts.json"
