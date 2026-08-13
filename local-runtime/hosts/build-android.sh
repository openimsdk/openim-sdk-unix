#!/usr/bin/env bash

set -euo pipefail
readonly runner_root="$(cd "$(dirname "$0")/../.." && pwd)"
node "$runner_root/local-runtime/hosts/inject-runtime-ready-marker.mjs" \
  "${OPENIM_LOCAL_PROJECT_ROOT:?}" \
  "${OPENIM_LOCAL_PRODUCT:?}" \
  "${OPENIM_LOCAL_SURFACE:?}"
case "${OPENIM_LOCAL_SURFACE:?}" in
  uniappx)
    exec bash "$runner_root/local-runtime/scripts/build-local-android.sh"
    ;;
  uniapp-vue2|uniapp-vue3)
    exec bash "$runner_root/local-runtime/hosts/build-classic-android.sh"
    ;;
  *)
    echo "Unsupported surface: ${OPENIM_LOCAL_SURFACE:-}" >&2
    exit 2
    ;;
esac
