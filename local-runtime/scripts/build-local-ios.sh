#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"

readonly HBUILDER_CLI="$(resolve_hbuilder_cli)"
readonly IOS_TARGET="${OPENIM_IOS_TARGET:-simulator}"
readonly APP_RECORD="$PROJECT_ROOT/unpackage/local-runtime/ios-app-path"
readonly DEVICE_RECORD="$PROJECT_ROOT/unpackage/local-runtime/ios-device-id"

verify_hbuilder_cli "$HBUILDER_CLI"
node "$LOCAL_RUNTIME_ROOT/scripts/prepare-local-native-artifacts.mjs" ios

if [[ "$IOS_TARGET" != "simulator" && "$IOS_TARGET" != "device" ]]; then
  echo "OPENIM_IOS_TARGET must be simulator or device" >&2
  exit 1
fi

device_id=""
if [[ "$IOS_TARGET" == "simulator" ]]; then
  device_id="$(ensure_ios_simulator)"

  node "$LOCAL_RUNTIME_ROOT/scripts/run-with-local-native-profile.mjs" ios -- \
    "$HBUILDER_CLI" launch app-ios \
    --project "$PROJECT_ROOT" \
    --iosTarget simulator \
    --deviceId "$device_id" \
    --ui false \
    --cleanCache true \
    --compile true

  hbuilder_contents="$(cd "$(dirname "$(dirname "$HBUILDER_CLI")")" && pwd)"
  base_app="$hbuilder_contents/HBuilderX/plugins/uniappx-launcher/base/Pandora_simulator.app"
  module_cache="$PROJECT_ROOT/unpackage/cache/uts_standard_simulator"
  compiled_wrapper="$module_cache/modules/unimoduleUnixOpenimSdk.framework"
  compiled_core="$module_cache/modules/OpenIMCore.framework"
  optool="$hbuilder_contents/HBuilderX/plugins/launcher-tools/tools/uts/optool"
  version="$(read_json "$TOOLCHAIN_LOCK" hbuilderx.version)"
  host_root="$PROJECT_ROOT/unpackage/local-runtime/ios-host"
  app_path="$host_root/Pandora_simulator_debug_${version}-openim.app"

  if [[ ! -d "$base_app" || ! -x "$optool" || \
        ! -f "$compiled_wrapper/unimoduleUnixOpenimSdk" || \
        ! -f "$compiled_core/OpenIMCore" ]]; then
    echo "HBuilderX did not produce an iOS local host containing unix-openim-sdk" >&2
    exit 1
  fi

  mkdir -p "$host_root"
  staging_root="$(mktemp -d "$host_root/.stage.XXXXXX")"
  staging_app="$staging_root/$(basename "$app_path")"
  cleanup_staging_host() { rm -rf "$staging_root"; }
  trap cleanup_staging_host EXIT

  ditto "$base_app" "$staging_app"
  if [[ -d "$module_cache/Resources" ]]; then
    ditto "$module_cache/Resources" "$staging_app"
  fi
  for framework in "$compiled_core" "$compiled_wrapper"; do
    framework_name="$(basename "$framework")"
    ditto "$framework" "$staging_app/Frameworks/$framework_name"
    binary_name="${framework_name%.framework}"
    "$optool" install -c weak -p "@rpath/$framework_name/$binary_name" -t "$staging_app" >/dev/null
  done

  codesign --force --sign - "$staging_app/Frameworks/OpenIMCore.framework"
  codesign --force --sign - "$staging_app/Frameworks/unimoduleUnixOpenimSdk.framework"
  codesign --force --deep --sign - "$staging_app"
  rm -rf "$app_path"
  mv "$staging_app" "$app_path"
  rmdir "$staging_root"
  trap - EXIT

  compiled_wrapper_sha="$(sha256_file "$compiled_wrapper/unimoduleUnixOpenimSdk")"
  host_wrapper_sha="$(sha256_file "$app_path/Frameworks/unimoduleUnixOpenimSdk.framework/unimoduleUnixOpenimSdk")"
  if [[ "$compiled_wrapper_sha" != "$host_wrapper_sha" ]]; then
    echo "Compiled iOS UTS wrapper does not match the assembled local host" >&2
    exit 1
  fi
else
  device_id="${OPENIM_IOS_DEVICE_ID:-}"
  developer_certificate="${OPENIM_IOS_DEVELOPER_CERTIFICATE:-}"
  provisioning_profile="${OPENIM_IOS_PROVISIONING_PROFILE:-}"
  private_key="${OPENIM_IOS_PRIVATE_KEY:-}"
  if [[ -z "$device_id" || -z "$developer_certificate" || -z "$provisioning_profile" || -z "$private_key" ]]; then
    echo "Physical iPhone build requires OPENIM_IOS_DEVICE_ID, OPENIM_IOS_DEVELOPER_CERTIFICATE," >&2
    echo "OPENIM_IOS_PROVISIONING_PROFILE, and OPENIM_IOS_PRIVATE_KEY" >&2
    exit 1
  fi
  if [[ ! -f "$developer_certificate" || ! -f "$provisioning_profile" ]]; then
    echo "Configured iOS certificate or provisioning profile does not exist" >&2
    exit 1
  fi
  launch_args=(
    launch app-ios
    --project "$PROJECT_ROOT"
    --iosTarget device
    --ui true
    --cleanCache true
    --deviceId "$device_id"
    --peveloperCertificate "$developer_certificate"
    --provisioningProfile "$provisioning_profile"
    --privateKey "$private_key"
  )
  node "$LOCAL_RUNTIME_ROOT/scripts/run-hbuilder-local.mjs" "$HBUILDER_CLI" -- \
    "${launch_args[@]}"
  app_path="$(node -e '
    const fs = require("fs");
    const path = require("path");
    const root = process.argv[1];
    if (!fs.existsSync(root)) process.exit(0);
    const candidates = fs.readdirSync(root)
      .filter((name) => /^Pandora.*\.app$/.test(name))
      .map((name) => path.join(root, name))
      .map((candidate) => ({
        candidate,
        wrapper: path.join(candidate, "Frameworks", "unimoduleUnixOpenimSdk.framework", "unimoduleUnixOpenimSdk"),
      }))
      .filter((entry) => fs.existsSync(entry.wrapper))
      .sort((left, right) => fs.statSync(right.wrapper).mtimeMs - fs.statSync(left.wrapper).mtimeMs);
    if (candidates[0]) process.stdout.write(candidates[0].candidate);
  ' "$PROJECT_ROOT/unpackage/debug")"
fi

if [[ -z "$app_path" || ! -d "$app_path" ]]; then
  echo "HBuilderX did not produce an iOS local host containing unix-openim-sdk" >&2
  exit 1
fi

dependency_file="$app_path/HXDependencies/uniapp-x-uts.json"
core_binary="$app_path/Frameworks/OpenIMCore.framework/OpenIMCore"
wrapper_binary="$app_path/Frameworks/unimoduleUnixOpenimSdk.framework/unimoduleUnixOpenimSdk"
if [[ ! -f "$dependency_file" || ! -f "$core_binary" || ! -f "$wrapper_binary" ]]; then
  echo "Generated iOS host is missing dependency metadata or OpenIM frameworks: $app_path" >&2
  exit 1
fi
if ! node -e '
  const fs = require("fs");
  const document = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.exit(Array.isArray(document.duts) && document.duts.includes("uni-websocket") ? 0 : 1);
' "$dependency_file"; then
  echo "Generated iOS host does not contain uni-websocket" >&2
  exit 1
fi
if ! otool -L "$wrapper_binary" | rg -q 'OpenIMCore\.framework/OpenIMCore'; then
  echo "Generated iOS UTS wrapper is not linked to OpenIMCore" >&2
  exit 1
fi
if ! xcrun vtool -show-build "$wrapper_binary" | rg -q 'minos 14\.0'; then
  echo "Generated iOS UTS wrapper is not built for minimum iOS 14.0" >&2
  exit 1
fi

source_framework="$PROJECT_ROOT/uni_modules/unix-openim-sdk/utssdk/app-ios/Frameworks/OpenIMCore.xcframework"
source_uuids="$(xcrun dwarfdump --uuid "$source_framework"/*/OpenIMCore.framework/OpenIMCore | awk '{print $2}' | sort -u)"
app_uuids="$(xcrun dwarfdump --uuid "$core_binary" | awk '{print $2}' | sort -u)"
while IFS= read -r uuid; do
  [[ -n "$uuid" ]] || continue
  if ! printf '%s\n' "$source_uuids" | rg -q "^${uuid}$"; then
    echo "Generated iOS host contains an unrecognized OpenIMCore UUID: $uuid" >&2
    exit 1
  fi
done <<< "$app_uuids"

codesign --verify --deep --strict "$app_path"
bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app_path/Info.plist")"
mkdir -p "$(dirname "$APP_RECORD")"
printf '%s\n' "$app_path" > "$APP_RECORD"
printf '%s\n' "$device_id" > "$DEVICE_RECORD"
node "$LOCAL_RUNTIME_ROOT/scripts/configure-automation-env.mjs" \
  ios "$app_path" "$device_id" "$bundle_id" >/dev/null

echo "Local iOS host ready: $app_path"
echo "Device: $device_id ($IOS_TARGET, bundle $bundle_id)"
