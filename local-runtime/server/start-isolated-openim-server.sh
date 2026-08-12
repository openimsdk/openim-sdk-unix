#!/usr/bin/env bash

set -euo pipefail

: "${OPENIM_PUBLIC_SERVER_SOURCE:?OPENIM_PUBLIC_SERVER_SOURCE is required}"

readonly runtime_dir="$OPENIM_PUBLIC_SERVER_SOURCE/.openim-public-test"
readonly config_dir="$runtime_dir/config"
readonly binary_dir="$OPENIM_PUBLIC_SERVER_SOURCE/_output/bin/platforms/darwin/arm64"
readonly tool_dir="$OPENIM_PUBLIC_SERVER_SOURCE/_output/bin/tools/darwin/arm64"
readonly log_dir="$runtime_dir/logs"
readonly pid_dir="$runtime_dir/pidfiles"
readonly api_port="${OPENIM_PUBLIC_SERVER_API_PORT:-11002}"
readonly ws_port="${OPENIM_PUBLIC_SERVER_WS_PORT:-11001}"

mkdir -p "$log_dir" "$pid_dir"

admin_token_ready() {
  ruby -r yaml -r json -r net/http - "$config_dir/share.yml" "$api_port" <<'RUBY' >/dev/null 2>&1
config = YAML.load_file(ARGV.fetch(0))
uri = URI("http://127.0.0.1:#{ARGV.fetch(1)}/auth/get_admin_token")
request = Net::HTTP::Post.new(uri)
request['Content-Type'] = 'application/json'
request['operationID'] = 'public-server-readiness'
request.body = {
  secret: config.fetch('secret'),
  platformID: 2,
  userID: config.fetch('imAdminUserID').fetch(0),
}.to_json
response = Net::HTTP.start(uri.host, uri.port, open_timeout: 2, read_timeout: 2) do |http|
  http.request(request)
end
document = JSON.parse(response.body)
exit(document['errCode'] == 0 && !document.dig('data', 'token').to_s.empty? ? 0 : 1)
RUBY
}

live_pid_count=0
pid_file_count=0
for pid_file in "$pid_dir"/*.pid; do
  [[ -e "$pid_file" ]] || continue
  pid_file_count=$((pid_file_count + 1))
  pid="$(tr -cd '0-9' < "$pid_file")"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    live_pid_count=$((live_pid_count + 1))
  fi
done
if [[ "$live_pid_count" -gt 0 ]]; then
  if [[ "$live_pid_count" -eq 12 && "$pid_file_count" -eq 12 ]] \
    && /usr/bin/nc -z 127.0.0.1 "$api_port" >/dev/null 2>&1 \
    && /usr/bin/nc -z 127.0.0.1 "$ws_port" >/dev/null 2>&1 \
    && admin_token_ready; then
    echo "isolated OpenIM server is already ready"
    exit 0
  fi
  echo "isolated OpenIM server has a partial live pid set; stop it with the scoped stop script before retrying" >&2
  exit 1
fi

"$tool_dir/check-component" -c "$config_dir"
"$tool_dir/seq" -c "$config_dir"

services=(
  openim-rpc-user
  openim-rpc-auth
  openim-rpc-conversation
  openim-rpc-group
  openim-rpc-friend
  openim-rpc-msg
  openim-rpc-third
  openim-msgtransfer
  openim-push
  openim-crontask
  openim-msggateway
  openim-api
)

for service in "${services[@]}"; do
  binary="$binary_dir/$service"
  [[ -x "$binary" ]] || { echo "missing isolated server binary: $binary" >&2; exit 1; }
  command_file="$pid_dir/$service-0.command.txt"
  pid_file="$pid_dir/$service-0.pid"
  printf '%s\n' "$binary -i 0 -c $config_dir/" > "$command_file"
  nohup "$binary" -i 0 -c "$config_dir/" >> "$log_dir/$service-0.log" 2>&1 < /dev/null &
  printf '%s\n' "$!" > "$pid_file"
done

for _attempt in $(seq 1 60); do
  alive=true
  for pid_file in "$pid_dir"/*.pid; do
    pid="$(tr -cd '0-9' < "$pid_file")"
    if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
      alive=false
      break
    fi
  done
  if [[ "$alive" == true ]] \
    && /usr/bin/nc -z 127.0.0.1 "$api_port" >/dev/null 2>&1 \
    && /usr/bin/nc -z 127.0.0.1 "$ws_port" >/dev/null 2>&1 \
    && admin_token_ready; then
    echo "isolated OpenIM server is ready"
    exit 0
  fi
  sleep 2
done

echo "isolated OpenIM server did not complete API, WebSocket, and admin readiness before timeout" >&2
exit 1
