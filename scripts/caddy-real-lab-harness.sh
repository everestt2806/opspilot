#!/usr/bin/env bash
set -euo pipefail

mode=${1:-}
case "$mode" in
  __mount)
    shift
    mount --make-rprivate /
    mount -t tmpfs -o size=384m,mode=1777,nosuid,nodev tmpfs /dev/shm
    lab=/dev/shm/opspilot-caddy-real-lab
    mkdir -m 0700 -p "$lab/input" "$lab/package" "$lab/etc/opspilot/caddy" \
      "$lab/run/lock" "$lab/storage/production" "$lab/storage/staging" \
      "$lab/home" "$lab/config" "$lab/bin" "$lab/upstreams"
    cp -- "$@" "$lab/input/"

    # Caddy 2.11.7 amd64 was verified by the repository APT evidence collector:
    # pinned signer 2F5C3BE9886ACD2913299EFBABA1F9B8875A6661 and authenticated
    # Packages stanza SHA-256 below. Recheck the package and extracted binary.
    curl --fail --silent --show-error --location \
      https://dl.cloudsmith.io/public/caddy/stable/deb/debian/pool/any-version/main/c/ca/caddy_2.11.7/caddy_2.11.7_linux_amd64.deb \
      --output "$lab/caddy.deb"
    printf '%s  %s\n' \
      a22b914ffd1958da42bc7ab13b7b62c6100634e0798ab594891d2d61d53ba749 "$lab/caddy.deb" \
      | sha256sum --check --status
    dpkg-deb --extract "$lab/caddy.deb" "$lab/package"
    install -m 0755 "$lab/package/usr/bin/caddy" "$lab/real-caddy"
    printf '%s  %s\n' \
      678ade3bfc088749c81a681adc603333ee0bb023b6a6cfe3c0f58bef8ff854e9 "$lab/real-caddy" \
      | sha256sum --check --status
    printf 'PACKAGE_AND_BINARY_SHA256=PASS\n'
    unshare --net --fork bash -x "$0" __network "$lab"
    ;;
  __network)
    lab=$2
    ip link set lo up
    [ "$(ip -o link show | wc -l)" -eq 1 ]
    [ "$(ip -o link show | cut -d: -f2 | tr -d ' ')" = lo ]
    [ -z "$(ip route show)" ]

    service_uid=61001
    service_gid=61001
    export LAB="$lab" TEST_ROOT="$lab" SERVICE_UID="$service_uid" SERVICE_GID="$service_gid"
    chmod 0750 "$lab"
    chown 0:"$service_gid" "$lab" "$lab/etc" "$lab/etc/opspilot" "$lab/etc/opspilot/caddy"
    chmod 0750 "$lab/etc" "$lab/etc/opspilot" "$lab/etc/opspilot/caddy"
    chown 0:0 "$lab/run" "$lab/run/lock"
    chmod 0755 "$lab/run"
    chmod 1777 "$lab/run/lock"
    chown "$service_uid:$service_gid" "$lab/storage" "$lab/storage/production" \
      "$lab/storage/staging" "$lab/home" "$lab/config" "$lab/upstreams"
    chmod 0700 "$lab/storage" "$lab/storage/production" "$lab/storage/staging" \
      "$lab/home" "$lab/config" "$lab/upstreams"

    for name in production staging initial generation-one generation-two generation-three reconcile rollback; do
      [ -f "$lab/input/$name" ] || { printf 'LAB_INPUT_MISSING=%s\n' "$name" >&2; exit 2; }
    done
    for name in production staging initial generation-one generation-two generation-three; do
      sed "s|__LAB_ROOT__|$lab|g" "$lab/input/$name" > "$lab/config/$name.Caddyfile"
      chown 0:"$service_gid" "$lab/config/$name.Caddyfile"
      chmod 0640 "$lab/config/$name.Caddyfile"
    done
    cp -- "$lab/input/reconcile" "$lab/reconcile.sh"
    cp -- "$lab/input/rollback" "$lab/rollback.sh"
    chmod 0700 "$lab/reconcile.sh" "$lab/rollback.sh"

    mkdir -m 0755 -p "$lab/bin"
    cat > "$lab/bin/caddy" <<'SH'
#!/bin/sh
exec 9>&-
exec setpriv --reuid="$SERVICE_UID" --regid="$SERVICE_GID" --clear-groups \
  env HOME="$LAB/home" XDG_CONFIG_HOME="$LAB/home/config" XDG_DATA_HOME="$LAB/home/data" \
  "$LAB/real-caddy" "$@"
SH
    cat > "$lab/bin/systemctl" <<'SH'
#!/bin/sh
set -eu
active_file="$TEST_ROOT/service.active"
enabled_file="$TEST_ROOT/service.enabled"
pid_file="$TEST_ROOT/service.pid"
config_file="$TEST_ROOT/etc/opspilot/caddy/Caddyfile"
active(){ [ "$(cat "$active_file" 2>/dev/null || printf inactive)" = active ]; }
start_service(){
  active && return 0
  "$LAB/bin/caddy" run --config "$config_file" --adapter caddyfile > "$TEST_ROOT/caddy.log" 2>&1 &
  echo $! > "$pid_file"
  n=0
  until curl --fail --silent --max-time 1 http://127.0.0.1:2019/config/ >/dev/null; do
    n=$((n + 1)); [ "$n" -lt 100 ] || { cat "$TEST_ROOT/caddy.log" >&2; return 1; }
    sleep 0.1
  done
  printf active > "$active_file"
}
stop_service(){
  if active; then
    kill -TERM "$(cat "$pid_file")" 2>/dev/null || true
    n=0
    while curl --fail --silent --max-time 1 http://127.0.0.1:2019/config/ >/dev/null; do
      n=$((n + 1)); [ "$n" -lt 50 ] || return 1; sleep 0.1
    done
  fi
  printf inactive > "$active_file"
}
case "${1:-}" in
  is-active) active && printf 'active\n' || printf 'inactive\n' ;;
  is-enabled) cat "$enabled_file" ;;
  enable) printf enabled > "$enabled_file"; case " $* " in *" --now "*) start_service ;; esac ;;
  disable) printf disabled > "$enabled_file" ;;
  start) start_service ;;
  stop) stop_service ;;
  reload) active || exit 1; "$LAB/bin/caddy" reload --config "$config_file" --adapter caddyfile ;;
  restart) stop_service; start_service ;;
  show) exit 2 ;;
  *) exit 2 ;;
esac
SH
    cat > "$lab/bin/ufw" <<'SH'
#!/bin/sh
printf 'Status: inactive\n'
SH
    chmod 0755 "$lab/bin/caddy" "$lab/bin/systemctl" "$lab/bin/ufw"
    export PATH="$lab/bin:$PATH"

    for config_name in production staging; do
      config_file="$lab/config/$config_name.Caddyfile"
      setpriv --reuid="$service_uid" --regid="$service_gid" --clear-groups \
        env HOME="$lab/home" XDG_CONFIG_HOME="$lab/home/config" XDG_DATA_HOME="$lab/home/data" \
        "$lab/real-caddy" validate --config "$config_file" --adapter caddyfile >/dev/null
    done
    setpriv --reuid="$service_uid" --regid="$service_gid" --clear-groups \
      sh -c 'test -r "$1" && test -x "$(dirname "$1")" && : > "$1/.write-test" && rm "$1/.write-test"' \
      sh "$lab/storage/production"
    setpriv --reuid="$service_uid" --regid="$service_gid" --clear-groups \
      sh -c 'test -r "$1" && test -x "$(dirname "$1")" && : > "$1/.write-test" && rm "$1/.write-test"' \
      sh "$lab/storage/staging"

    python3 - "$lab/upstreams" <<'PY' &
import http.server, sys, threading
root=sys.argv[1]
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body=("upstream-"+str(self.server.server_port)).encode()
        self.send_response(200); self.send_header("Content-Length",str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self,*args): pass
servers=[]
for port in (3011,3012,3013):
    server=http.server.HTTPServer(("127.0.0.1",port),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start(); servers.append(server)
threading.Event().wait()
PY
    upstream_pid=$!
    trap '"$LAB/bin/systemctl" stop opspilot-caddy.service >/dev/null 2>&1 || true; kill "$upstream_pid" 2>/dev/null || true' EXIT

    initial="$lab/config/initial.Caddyfile"
    config="$lab/etc/opspilot/caddy/Caddyfile"
    install -o 0 -g "$service_gid" -m 0640 "$initial" "$config"
    printf inactive > "$lab/service.active"
    printf disabled > "$lab/service.enabled"
    printf active > "$lab/mock-owner-active"
    initial_sha=$(sha256sum "$config" | awk '{print $1}')
    empty_dns=e30=
    run_reconcile(){
      txn=$1; generation=$2; config_name=$3; route_count=$4; previous_generation=$5; previous_sha=$6
      config_b64=$(base64 -w0 "$lab/config/$config_name.Caddyfile")
      bash "$lab/reconcile.sh" "$txn" "$generation" production "$config_b64" \
        "$initial_sha" "$route_count" "$empty_dns" "$previous_generation" "$previous_sha"
    }
    output=$(run_reconcile aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$(sed -n 's/^# opspilot-generation=//p' "$lab/config/generation-one.Caddyfile")" generation-one 2 none "$initial_sha")
    printf '%s\n' "$output" | grep -Fxq RESULT=applied
    grep -Fq 'alpha.example.test' "$lab/etc/opspilot/caddy/Caddyfile"
    grep -Fq 'beta.example.test' "$lab/etc/opspilot/caddy/Caddyfile"
    [ "$(curl --fail --silent -H 'Host: alpha.example.test' http://127.0.0.1:18080/)" = upstream-3011 ]
    [ "$(curl --fail --silent -H 'Host: beta.example.test' http://127.0.0.1:18080/)" = upstream-3012 ]
    curl --fail --silent http://127.0.0.1:2019/config/ | grep -Fq 'alpha.example.test'
    g1=$(sed -n 's/^# opspilot-generation=//p' "$lab/config/generation-one.Caddyfile")
    sha1=$(printf '%s\n' "$output" | sed -n 's/^CONFIG_SHA256=//p')

    output=$(run_reconcile bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb "$g1" generation-one 2 "$g1" "$sha1")
    printf '%s\n' "$output" | grep -Fxq RESULT=already_current

    # Simulate DB observation failure after the first start: the production rollback script
    # must restore both the file and loaded config and return service to inactive.
    output=$(bash "$lab/rollback.sh" aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$g1" "$sha1")
    printf '%s\n' "$output" | grep -Fxq RESULT=rolled_back
    [ "$(sha256sum "$config" | awk '{print $1}')" = "$initial_sha" ]
    [ "$(cat "$lab/service.active")" = inactive ]

    output=$(run_reconcile cccccccccccccccccccccccccccccccc "$g1" generation-one 2 none "$initial_sha")
    printf '%s\n' "$output" | grep -Fxq RESULT=applied
    sha1=$(printf '%s\n' "$output" | sed -n 's/^CONFIG_SHA256=//p')
    g2=$(sed -n 's/^# opspilot-generation=//p' "$lab/config/generation-two.Caddyfile")
    output=$(run_reconcile dddddddddddddddddddddddddddddddd "$g2" generation-two 2 "$g1" "$sha1")
    printf '%s\n' "$output" | grep -Fxq RESULT=applied
    sha2=$(printf '%s\n' "$output" | sed -n 's/^CONFIG_SHA256=//p')
    stale=$(bash "$lab/rollback.sh" cccccccccccccccccccccccccccccccc "$g1" "$sha1")
    printf '%s\n' "$stale" | grep -Fxq RESULT=rollback_conflict
    grep -Fq "# opspilot-generation=$g2" "$config"
    [ "$(curl --fail --silent -H 'Host: gamma.example.test' http://127.0.0.1:18080/)" = upstream-3013 ]

    g3=$(sed -n 's/^# opspilot-generation=//p' "$lab/config/generation-three.Caddyfile")
    output=$(run_reconcile eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee "$g3" generation-three 2 "$g2" "$sha2")
    printf '%s\n' "$output" | grep -Fxq RESULT=applied
    sha3=$(printf '%s\n' "$output" | sed -n 's/^CONFIG_SHA256=//p')
    output=$(bash "$lab/rollback.sh" eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee "$g3" "$sha3")
    printf '%s\n' "$output" | grep -Fxq RESULT=rolled_back
    [ "$(sha256sum "$config" | awk '{print $1}')" = "$sha2" ]
    curl --fail --silent http://127.0.0.1:2019/config/ > "$lab/admin-loaded.json"
    python3 - "$lab/admin-loaded.json" "$g2" <<'PY'
import json,sys
payload=json.load(open(sys.argv[1]))
text=json.dumps(payload)
assert "beta.example.test" in text and "gamma.example.test" in text and "alpha.example.test" not in text
PY
    [ "$(curl --fail --silent -H 'Host: gamma.example.test' http://127.0.0.1:18080/)" = upstream-3013 ]
    if curl --fail --silent --show-error --connect-timeout 1 --max-time 2 \
      --resolve acme-staging-v02.api.letsencrypt.org:443:1.1.1.1 \
      https://acme-staging-v02.api.letsencrypt.org/directory >/dev/null 2>&1; then
      printf 'ACME_EGRESS_UNEXPECTEDLY_SUCCEEDED\n' >&2; exit 1
    fi
    printf 'CADDY_REAL_LAB_PASS=production_staging_validate,service_uid_storage,start,two_routes,reload,idempotency,db_failure_rollback,newer_generation_preserved,admin_api,upstream_http,acme_egress_blocked\n'
    ;;
  *)
    [ "$(id -u)" -eq 0 ] || { printf 'Run with: wsl -u root -- bash scripts/caddy-real-lab-harness.sh ...\n' >&2; exit 2; }
    exec unshare --mount --propagation private --fork bash -x "$0" __mount "$@"
    ;;
esac
