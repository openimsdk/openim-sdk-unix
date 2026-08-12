#!/usr/bin/env bash

set -euo pipefail
readonly runner_root="$(cd "$(dirname "$0")/../.." && pwd)"
case "${OPENIM_LOCAL_SURFACE:?}" in
  uniappx)
    exec bash "$runner_root/local-runtime/hosts/build-uniappx-ios.sh"
    ;;
  uniapp-vue2|uniapp-vue3)
    exec bash "$runner_root/local-runtime/hosts/build-classic-ios.sh"
    ;;
  *)
    echo "Unsupported surface: ${OPENIM_LOCAL_SURFACE:-}" >&2
    exit 2
    ;;
esac
