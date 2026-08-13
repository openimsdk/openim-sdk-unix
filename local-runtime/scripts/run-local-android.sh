#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"

exec bash "$LOCAL_RUNTIME_ROOT/hosts/run-android.sh"
