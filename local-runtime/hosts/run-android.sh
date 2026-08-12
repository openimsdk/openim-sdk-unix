#!/usr/bin/env bash

set -euo pipefail
readonly runner_root="$(cd "$(dirname "$0")/../.." && pwd)"
bash "$runner_root/local-runtime/hosts/build-android.sh"
source "$runner_root/local-runtime/scripts/common.sh"
readonly apk="$(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(p.apkPath)' "$OPENIM_LOCAL_RUN_ROOT/artifacts.json")"
readonly adb="$(resolve_adb)"
readonly device="$(resolve_android_device "$adb")"
readonly package="${OPENIM_LOCAL_APPLICATION_ID:?}"
if [[ "${OPENIM_LOCAL_SURFACE:?}" == "uniappx" ]]; then
  readonly activity="io.dcloud.uniapp.UniAppActivity"
else
  readonly activity="io.dcloud.PandoraEntry"
fi
"$adb" -s "$device" install -r -d "$apk" </dev/null
"$adb" -s "$device" shell am force-stop "$package" </dev/null
"$adb" -s "$device" shell am start -W -n "$package/$activity" </dev/null
test -n "$("$adb" -s "$device" shell pidof "$package" | tr -d '\r')"
