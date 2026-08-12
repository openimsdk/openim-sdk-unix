#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"

readonly HBUILDER_CLI="$(resolve_hbuilder_cli)"
verify_hbuilder_cli "$HBUILDER_CLI"

readonly PLUGIN_NAME="$(read_json "$HARNESS_LOCK" automation.hbuilderxPlugin)"
readonly EXPECTED_PLUGIN_VERSION="$(read_json "$HARNESS_LOCK" automation.pluginVersion)"
readonly EXPECTED_LIBRARY_VERSION="$(read_json "$HARNESS_LOCK" automation.testLibraryVersion)"
readonly HBUILDER_CONTENTS="$(cd "$(dirname "$HBUILDER_CLI")/.." && pwd)"
readonly PLUGINS_ROOT="$HBUILDER_CONTENTS/HBuilderX/plugins"
readonly TEST_LIBRARY_ROOT="$PLUGINS_ROOT/hbuilderx-for-uniapp-test-lib"
readonly TEST_LIBRARY_PACKAGE="$TEST_LIBRARY_ROOT/package.json"
readonly JEST_ENTRY="$TEST_LIBRARY_ROOT/node_modules/jest/bin/jest.js"

plugin_version="$($HBUILDER_CLI uniapp.test --version 2>&1 | sed -n 's/^plugin version：[[:space:]]*//p' | tail -n 1)"
if [[ "$plugin_version" != "$EXPECTED_PLUGIN_VERSION" ]]; then
  "$HBUILDER_CLI" installPlugin --name "$PLUGIN_NAME" --force true
  plugin_version="$($HBUILDER_CLI uniapp.test --version 2>&1 | sed -n 's/^plugin version：[[:space:]]*//p' | tail -n 1)"
fi
if [[ "$plugin_version" != "$EXPECTED_PLUGIN_VERSION" ]]; then
  echo "HBuilderX automation plugin version mismatch: expected $EXPECTED_PLUGIN_VERSION, got ${plugin_version:-missing}" >&2
  exit 1
fi

if [[ ! -f "$TEST_LIBRARY_PACKAGE" ]]; then
  echo "HBuilderX automation test library is unavailable: $TEST_LIBRARY_PACKAGE" >&2
  exit 1
fi
library_version="$(read_json "$TEST_LIBRARY_PACKAGE" version)"
if [[ "$library_version" != "$EXPECTED_LIBRARY_VERSION" ]]; then
  echo "HBuilderX automation test library version mismatch: expected $EXPECTED_LIBRARY_VERSION, got $library_version" >&2
  exit 1
fi

if [[ ! -f "$JEST_ENTRY" ]]; then
  automation_npm_cache="$(mktemp -d "${TMPDIR:-/tmp}/openim-public-automation-npm.XXXXXX")"
  cleanup_automation_npm_cache() {
    if [[ -n "${automation_npm_cache:-}" && -d "$automation_npm_cache" ]]; then
      rm -r "$automation_npm_cache"
    fi
  }
  trap cleanup_automation_npm_cache EXIT
  (
    cd "$TEST_LIBRARY_ROOT"
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    npm_config_cache="$automation_npm_cache" \
      npm install --ignore-scripts --no-audit --no-fund
  )
fi

if [[ ! -f "$JEST_ENTRY" ]]; then
  echo "HBuilderX automation Jest runtime was not installed" >&2
  exit 1
fi

echo "[openim-local] HBuilderX automation runtime is ready (plugin $plugin_version, library $library_version)"
