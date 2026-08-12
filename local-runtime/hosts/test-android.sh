#!/usr/bin/env bash

set -euo pipefail
readonly runner_root="$(cd "$(dirname "$0")/../.." && pwd)"
bash "$runner_root/local-runtime/hosts/run-android.sh"
if [[ "${OPENIM_LOCAL_SUITE:-smoke}" == "smoke" ]]; then
  exit 0
fi
if [[ -z "${OPENIM_API_BASE:-}" || -z "${OPENIM_WS_BASE:-}" || -z "${IM_SECRET:-}" ]]; then
  echo "OPENIM_API_BASE, OPENIM_WS_BASE and IM_SECRET are required for the full suite" >&2
  exit 1
fi
exec bash "$runner_root/local-runtime/scripts/test-local-android.sh"
