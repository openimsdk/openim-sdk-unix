#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/common.sh"

for name in OPENIM_PUBLIC_SERVER_SSH OPENIM_PUBLIC_SERVER_SOURCE OPENIM_PUBLIC_SERVER_REVISION OPENIM_PUBLIC_SERVER_PUBLIC_HOST; do
  if [[ -z "${!name:-}" ]]; then
    echo "$name is required" >&2
    exit 1
  fi
done

readonly remote="$OPENIM_PUBLIC_SERVER_SSH"
readonly source_root="$OPENIM_PUBLIC_SERVER_SOURCE"
readonly revision="$OPENIM_PUBLIC_SERVER_REVISION"
readonly public_host="$OPENIM_PUBLIC_SERVER_PUBLIC_HOST"
readonly runtime_dir="$source_root/.openim-public-test"
readonly data_root="${OPENIM_PUBLIC_SERVER_DATA_ROOT:-$runtime_dir/data}"
readonly docker_bin="${OPENIM_PUBLIC_SERVER_DOCKER_BIN:-/usr/local/bin/docker}"
readonly go_bin="${OPENIM_PUBLIC_SERVER_GO_BIN:-/usr/local/go/bin/go}"
readonly server_assets="$LOCAL_RUNTIME_ROOT/server"
readonly known_hosts_file="${OPENIM_PUBLIC_SERVER_KNOWN_HOSTS_FILE:-$HOME/.ssh/known_hosts}"
ssh_options=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$known_hosts_file")

ssh "${ssh_options[@]}" "$remote" bash -s -- "$source_root" "$revision" <<'REMOTE_PREPARE'
set -euo pipefail
source_root="$1"
revision="$2"
[[ -d "$source_root/.git" ]] || { echo "OpenIM source repository is missing: $source_root" >&2; exit 1; }
actual="$(git -C "$source_root" rev-parse HEAD)"
[[ "$actual" == "$revision" ]] || { echo "OpenIM source revision mismatch" >&2; exit 1; }
if ! git -C "$source_root" diff --quiet -- . ':!docker-compose.yml'; then
  echo "OpenIM source has tracked code/config changes outside docker-compose.yml" >&2
  exit 1
fi
mkdir -p "$source_root/.openim-public-test"
snapshot="$source_root/.openim-public-test/source-snapshot"
mkdir -p "$snapshot"
git -C "$source_root" archive "$revision" .env docker-compose.yml start-config.yml config | tar -x -C "$snapshot"
REMOTE_PREPARE

scp "${ssh_options[@]}" "$server_assets/configure-isolated-openim-server.rb" "$server_assets/start-isolated-openim-server.sh" "$server_assets/stop-isolated-openim-server.sh" "$remote:$runtime_dir/"

ssh "${ssh_options[@]}" "$remote" env \
  OPENIM_PUBLIC_SERVER_SOURCE="$source_root" \
  OPENIM_PUBLIC_SERVER_DATA_ROOT="$data_root" \
  OPENIM_PUBLIC_SERVER_PUBLIC_HOST="$public_host" \
  OPENIM_PUBLIC_SERVER_REVISION="$revision" \
  OPENIM_PUBLIC_SERVER_API_PORT="${OPENIM_PUBLIC_SERVER_API_PORT:-11002}" \
  OPENIM_PUBLIC_SERVER_WS_PORT="${OPENIM_PUBLIC_SERVER_WS_PORT:-11001}" \
  OPENIM_PUBLIC_SERVER_MONGO_PORT="${OPENIM_PUBLIC_SERVER_MONGO_PORT:-47017}" \
  OPENIM_PUBLIC_SERVER_REDIS_PORT="${OPENIM_PUBLIC_SERVER_REDIS_PORT:-26379}" \
  OPENIM_PUBLIC_SERVER_ETCD_CLIENT_PORT="${OPENIM_PUBLIC_SERVER_ETCD_CLIENT_PORT:-22379}" \
  OPENIM_PUBLIC_SERVER_ETCD_PEER_PORT="${OPENIM_PUBLIC_SERVER_ETCD_PEER_PORT:-22380}" \
  OPENIM_PUBLIC_SERVER_KAFKA_PORT="${OPENIM_PUBLIC_SERVER_KAFKA_PORT:-29094}" \
  OPENIM_PUBLIC_SERVER_MINIO_PORT="${OPENIM_PUBLIC_SERVER_MINIO_PORT:-20005}" \
  OPENIM_PUBLIC_SERVER_MINIO_CONSOLE_PORT="${OPENIM_PUBLIC_SERVER_MINIO_CONSOLE_PORT:-29090}" \
  ruby "$runtime_dir/configure-isolated-openim-server.rb"

ssh "${ssh_options[@]}" "$remote" bash -s -- \
  "$source_root" "$docker_bin" "$go_bin" \
  "${OPENIM_PUBLIC_SERVER_MONGO_PORT:-47017}" \
  "${OPENIM_PUBLIC_SERVER_REDIS_PORT:-26379}" \
  "${OPENIM_PUBLIC_SERVER_ETCD_CLIENT_PORT:-22379}" \
  "${OPENIM_PUBLIC_SERVER_KAFKA_PORT:-29094}" \
  "${OPENIM_PUBLIC_SERVER_MINIO_PORT:-20005}" <<'REMOTE_BUILD'
set -euo pipefail
source_root="$1"
docker_bin="$2"
go_bin="$3"
shift 3
dependency_ports=("$@")
runtime_dir="$source_root/.openim-public-test"
export PATH="$(dirname "$go_bin"):$(dirname "$docker_bin"):/Applications/Docker.app/Contents/Resources/bin:$PATH"
"$docker_bin" compose -p openim-public-test --env-file "$runtime_dir/source-snapshot/.env" -f "$runtime_dir/docker-compose.yml" up -d
for _attempt in $(seq 1 60); do
  ready=true
  for port in "${dependency_ports[@]}"; do
    /usr/bin/nc -z 127.0.0.1 "$port" || ready=false
  done
  if [[ "$ready" == true ]]; then
    break
  fi
  sleep 2
done
for port in "${dependency_ports[@]}"; do
  /usr/bin/nc -z 127.0.0.1 "$port" || { echo "isolated dependency listener did not open: $port" >&2; exit 1; }
done
mkdir -p "$runtime_dir/bin"
GOBIN="$runtime_dir/bin" "$go_bin" install github.com/magefile/mage@v1.17.2
"$runtime_dir/bin/mage" -d "$source_root" build
REMOTE_BUILD

ssh "${ssh_options[@]}" "$remote" env \
  OPENIM_PUBLIC_SERVER_SOURCE="$source_root" \
  OPENIM_PUBLIC_SERVER_API_PORT="${OPENIM_PUBLIC_SERVER_API_PORT:-11002}" \
  OPENIM_PUBLIC_SERVER_WS_PORT="${OPENIM_PUBLIC_SERVER_WS_PORT:-11001}" \
  bash "$runtime_dir/start-isolated-openim-server.sh"

echo "isolated Public OpenIM server provisioned at http://$public_host:${OPENIM_PUBLIC_SERVER_API_PORT:-11002} and ws://$public_host:${OPENIM_PUBLIC_SERVER_WS_PORT:-11001}"
