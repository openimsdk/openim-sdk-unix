#!/usr/bin/env bash

set -euo pipefail

: "${OPENIM_PUBLIC_SERVER_SOURCE:?OPENIM_PUBLIC_SERVER_SOURCE is required}"

readonly runtime_dir="$OPENIM_PUBLIC_SERVER_SOURCE/.openim-public-test"
readonly pid_dir="$runtime_dir/pidfiles"
readonly docker_bin="${OPENIM_PUBLIC_SERVER_DOCKER_BIN:-/usr/local/bin/docker}"

if [[ -d "$pid_dir" ]]; then
  for pid_file in "$pid_dir"/*.pid; do
    [[ -e "$pid_file" ]] || continue
    pid="$(tr -cd '0-9' < "$pid_file")"
    command_file="${pid_file%.pid}.command.txt"
    [[ -n "$pid" && -f "$command_file" ]] || { echo "invalid isolated pid metadata: $pid_file" >&2; exit 1; }
    expected="$(cat "$command_file")"
    actual="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ -n "$actual" ]]; then
      case "$actual" in
        "$OPENIM_PUBLIC_SERVER_SOURCE"/_output/bin/platforms/*/*/openim-*" -i 0 -c $runtime_dir/config/")
          kill "$pid"
          ;;
        *)
          echo "refusing to stop pid outside isolated root: $pid ($expected)" >&2
          exit 1
          ;;
      esac
    fi
  done
fi

sleep 2
if [[ -x "$docker_bin" && -f "$runtime_dir/docker-compose.yml" ]]; then
  "$docker_bin" compose -p openim-public-test -f "$runtime_dir/docker-compose.yml" down
fi

echo "isolated OpenIM server stopped"
