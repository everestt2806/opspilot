#!/bin/bash
set -euo pipefail

SCRIPT_B64='@@SCRIPT_B64@@'
BASE=$(mktemp -d)
case "$BASE" in /tmp/tmp.*) ;; *) echo "unsafe test base" >&2; exit 90 ;; esac
mount --make-rprivate / || { rmdir -- "$BASE"; exit 90; }
mount -t tmpfs -o size=256m,nosuid,nodev tmpfs "$BASE" || { rmdir -- "$BASE"; exit 90; }
trap 'umount "$BASE"; rmdir -- "$BASE"' EXIT
TOOLS="$BASE/tools"
FIXTURE="$BASE/caddy.deb"
STATE="$BASE/state"
mkdir -p "$TOOLS" "$STATE" "$BASE/package/usr/bin" "$BASE/package/DEBIAN"
printf '#!/bin/sh\nexit 0\n' > "$BASE/package/usr/bin/caddy"
chmod 0755 "$BASE/package/usr/bin/caddy"
cat > "$BASE/package/DEBIAN/control" <<'EOF'
Package: caddy
Version: 2.11.7
Architecture: amd64
Maintainer: OpsPilot isolated test
Description: local fixture only
EOF
dpkg-deb --build --root-owner-group "$BASE/package" "$FIXTURE" >/dev/null
PACKAGE_SHA=$(sha256sum "$FIXTURE" | awk '{print $1}')

cat > "$TOOLS/stat" <<'PY'
#!/usr/bin/python3
import os, re, stat, sys
args=sys.argv[1:]
if len(args)<2 or args[0] != '-c': sys.exit(2)
fmt=args[1]; paths=args[2:]
if paths and paths[0]=='--': paths=paths[1:]
state=os.environ['TX_STATE']
owners={}
try:
  for line in open(state+'/owners'):
    inode,user,group=line.rstrip('\n').split('|')
    owners[inode]=(user,group)
except FileNotFoundError: pass
for path in paths:
  st=os.lstat(path); inode=f'{st.st_dev}:{st.st_ino}'
  user,group=owners.get(inode,('root','root'))
  if os.environ.get('BAD_LOCK_OWNER')=='1' and path.endswith('/run/lock/opspilot-ingress.lock'):
    user,group='nobody','root'
  if path.endswith('/etc/opspilot/caddy') or path.endswith('/etc/opspilot/caddy/Caddyfile'):
    user,group=owners.get(inode,('root','opspilot-caddy'))
  if path.endswith('/var/lib/opspilot/caddy') or path.endswith('/var/lib/opspilot/caddy/production'):
    user,group=owners.get(inode,('opspilot-caddy','opspilot-caddy'))
  values={'d':str(st.st_dev),'i':str(st.st_ino),'U':user,'G':group,'a':format(stat.S_IMODE(st.st_mode),'o'),'h':str(st.st_nlink)}
  print(re.sub(r'%([diUGah])',lambda m: values[m.group(1)],fmt))
PY
chmod 0755 "$TOOLS/stat"

cat > "$TOOLS/chown" <<'SH'
#!/bin/sh
set -eu
owner=$1; shift
[ "${1-}" = -- ] && shift
path=$1
case "$path" in *"${FAIL_CHOWN_SUFFIX-}"*) if [ -n "${FAIL_CHOWN_SUFFIX-}" ]; then exit 1; fi ;; esac
inode=$(/usr/bin/stat -c '%d:%i' -- "$path")
printf '%s|%s|%s\n' "$inode" "${owner%%:*}" "${owner#*:}" >> "$TX_STATE/owners"
SH
cat > "$TOOLS/mkdir" <<'SH'
#!/bin/sh
/usr/bin/mkdir "$@" || exit $?
for arg do path=$arg; done
case "$path" in *"${FAIL_CREATE_SUFFIX-}"*) if [ -n "${FAIL_CREATE_SUFFIX-}" ]; then exit 1; fi ;; esac
exit 0
SH
cat > "$TOOLS/mv" <<'SH'
#!/bin/sh
/usr/bin/mv "$@" || exit $?
for arg do path=$arg; done
case "$path" in *"${FAIL_RENAME_SUFFIX-}"*) if [ -n "${FAIL_RENAME_SUFFIX-}" ]; then exit 1; fi ;; esac
exit 0
SH
cat > "$TOOLS/rm" <<'SH'
#!/bin/sh
for arg do path=$arg; done
case "$path" in *"${FAIL_ROLLBACK_SUFFIX-}"*) if [ -n "${FAIL_ROLLBACK_SUFFIX-}" ]; then exit 1; fi ;; esac
exec /usr/bin/rm "$@"
SH
cat > "$TOOLS/base64" <<'SH'
#!/bin/sh
[ "${FAIL_WRITE-}" != 1 ] || exit 1
exec /usr/bin/base64 "$@"
SH
cat > "$TOOLS/groupadd" <<'SH'
#!/bin/sh
echo 920 > "$TX_STATE/group"
SH
cat > "$TOOLS/useradd" <<'SH'
#!/bin/sh
echo 921 > "$TX_STATE/user"
SH
cat > "$TOOLS/getent" <<'SH'
#!/bin/sh
case "$1:$2" in
  group:opspilot-caddy) [ -f "$TX_STATE/group" ] || exit 2; printf 'opspilot-caddy:x:%s:\n' "$(cat "$TX_STATE/group")" ;;
  passwd:opspilot-caddy) [ -f "$TX_STATE/user" ] || exit 2; printf 'opspilot-caddy:x:%s:920::%s/var/lib/opspilot/caddy:/usr/sbin/nologin\n' "$(cat "$TX_STATE/user")" "$TX_ROOT" ;;
  *) exit 2 ;;
esac
SH
cat > "$TOOLS/id" <<'SH'
#!/bin/sh
case "$1" in -u) cat "$TX_STATE/user" ;; -g) cat "$TX_STATE/group" ;; *) exit 2 ;; esac
SH
cat > "$TOOLS/userdel" <<'SH'
#!/bin/sh
rm -f "$TX_STATE/user"
SH
cat > "$TOOLS/groupdel" <<'SH'
#!/bin/sh
rm -f "$TX_STATE/group"
SH
cat > "$TOOLS/dpkg-query" <<'SH'
#!/bin/sh
exit 1
SH
cat > "$TOOLS/ss" <<'SH'
#!/bin/sh
exit 0
SH
cat > "$TOOLS/curl" <<'SH'
#!/bin/sh
while [ "$#" -gt 0 ]; do if [ "$1" = --output ]; then output=$2; shift 2; else shift; fi; done
/usr/bin/cp -- "$FIXTURE_DEB" "$output"
SH
cat > "$TOOLS/systemctl" <<'SH'
#!/bin/sh
if [ "$1" = daemon-reload ]; then exit 0; fi
if [ "$1" != show ]; then exit 1; fi
unit=$2
case "$unit" in
  opspilot-caddy.service)
    case " $* " in *' --value '*) echo not-found; exit 0 ;; esac
    if [ "${FAIL_VERIFY-}" = 1 ]; then reload='ExecReload=bad'; else reload="ExecReload={ path=$TX_ROOT/usr/bin/caddy ; argv[]=$TX_ROOT/usr/bin/caddy reload --config $TX_ROOT/etc/opspilot/caddy/Caddyfile --adapter caddyfile --force ; ignore_errors=no ; start_time=[0] ; stop_time=[0] ; pid=0 }"; fi
    printf '%s\n' \
      'LoadState=loaded' 'ActiveState=inactive' "FragmentPath=$TX_ROOT/etc/systemd/system/opspilot-caddy.service" 'DropInPaths=' \
      "ExecStartPre={ path=$TX_ROOT/usr/bin/caddy ; argv[]=$TX_ROOT/usr/bin/caddy validate --config $TX_ROOT/etc/opspilot/caddy/Caddyfile --adapter caddyfile ; ignore_errors=no ; start_time=[0] ; stop_time=[0] ; pid=0 }" \
      "ExecStart={ path=$TX_ROOT/usr/bin/caddy ; argv[]=$TX_ROOT/usr/bin/caddy run --config $TX_ROOT/etc/opspilot/caddy/Caddyfile --adapter caddyfile ; ignore_errors=no ; start_time=[0] ; stop_time=[0] ; pid=0 }" \
      "$reload" 'User=opspilot-caddy' 'Group=opspilot-caddy' 'Type=notify' "WorkingDirectory=$TX_ROOT/etc/opspilot/caddy" "Environment=HOME=$TX_ROOT/var/lib/opspilot/caddy" \
      'UMask=0077' 'Restart=on-failure' 'RestartUSec=2s' 'TimeoutStopUSec=5s' 'LimitNOFILE=1048576' 'NoNewPrivileges=yes' 'PrivateTmp=yes' \
      'ProtectSystem=strict' 'ProtectHome=yes' 'ProtectKernelTunables=yes' 'ProtectKernelModules=yes' 'ProtectControlGroups=yes' 'RestrictSUIDSGID=yes' \
      'LockPersonality=yes' 'CapabilityBoundingSet=cap_net_bind_service' 'AmbientCapabilities=cap_net_bind_service' "ReadWritePaths=$TX_ROOT/var/lib/opspilot/caddy"
    ;;
  *) echo not-found ;;
esac
SH
chmod 0755 "$TOOLS"/*

run_case() {
  name=$1; create_fail=${2-}; chown_fail=${3-}; write_fail=${4-}; rename_fail=${5-}; verify_fail=${6-}; rollback_fail=${7-}; lock_case=${8-}
  root="$BASE/$name"; state="$STATE/$name"; mkdir -p "$state"
  mkdir -p "$root/usr/bin" "$root/usr/local/lib" "$root/etc/systemd/system" "$root/var/lib" "$root/var/tmp" "$root/run/lock"
  find "$root" -type d -exec chmod 0755 {} +
  chmod 1777 "$root/run/lock"
  case "$lock_case" in
    dir-symlink) rmdir "$root/run/lock"; ln -s "$root/var/tmp" "$root/run/lock" ;;
    file-symlink) printf keep > "$BASE/lock-target"; ln -s "$BASE/lock-target" "$root/run/lock/opspilot-ingress.lock" ;;
    bad-owner) : > "$root/run/lock/opspilot-ingress.lock"; chmod 0600 "$root/run/lock/opspilot-ingress.lock" ;;
  esac
  export TX_ROOT="$root" TX_STATE="$state" FIXTURE_DEB="$FIXTURE"
  export FAIL_CREATE_SUFFIX="$create_fail" FAIL_CHOWN_SUFFIX="$chown_fail" FAIL_WRITE="$write_fail" FAIL_RENAME_SUFFIX="$rename_fail" FAIL_VERIFY="$verify_fail" FAIL_ROLLBACK_SUFFIX="$rollback_fail"
  export BAD_LOCK_OWNER=0; [ "$lock_case" != bad-owner ] || BAD_LOCK_OWNER=1; export BAD_LOCK_OWNER
  script=${SCRIPT//@@ROOT@@/$root}
  out=$(printf '%s\n' "$script" | PATH="$TOOLS:/usr/bin:/bin" /bin/sh -s -- 2.11.7 amd64 "$PACKAGE_SHA" 'https://dl.cloudsmith.io/public/caddy/stable/deb/debian/any-version/caddy_2.11.7_amd64.deb' 0123456789abcdef0123456789abcdef)
  printf '%s|%s\n' "$name" "$(printf '%s\n' "$out" | grep -E '^(RESULT=|CODE=|STEP=)' | tr '\n' ',')"
  case "$name" in
    success) printf '%s\n' "$out" | grep -q '^RESULT=installed_not_running$'; test -f "$root/etc/opspilot/caddy/INSTALLATION"; test "$(stat -c '%a' "$root/run/lock")" = 1777 ;;
    rollback-failure) printf '%s\n' "$out" | grep -q '^RESULT=rollback_failed$'; test -f "$root/etc/opspilot/caddy/Caddyfile"; test -f "$state/user"; test -f "$state/group"; test ! -f "$root/etc/systemd/system/opspilot-caddy.service"; test ! -e "$root/etc/opspilot/caddy/OWNER"; test ! -e "$root/etc/opspilot/caddy/INSTALLATION"; test ! -e "$root/usr/bin/caddy"; test ! -e "$root/usr/local/lib/opspilot-caddy/versions/2.11.7/caddy" ;;
    lock-*) printf '%s\n' "$out" | grep -q '^RESULT=blocked$'; printf '%s\n' "$out" | grep -q '^CODE=INSTALL_CONFLICT$'; test ! -e "$root/usr/local/lib/opspilot-caddy"; test ! -f "$state/user"; test ! -f "$state/group" ;;
    *) printf '%s\n' "$out" | grep -q '^RESULT=failed_rolled_back$'; test ! -e "$root/usr/bin/caddy"; test ! -e "$root/etc/systemd/system/opspilot-caddy.service"; test ! -e "$root/etc/opspilot/caddy/Caddyfile"; test ! -f "$state/user"; test ! -f "$state/group" ;;
  esac
}

SCRIPT=$(printf '%s' "$SCRIPT_B64" | base64 -d)
case "$SCRIPT" in *'/etc/opspilot/caddy/Caddyfile'*) ;; *) echo 'missing installer script' >&2; exit 91 ;; esac
run_case success
run_case create-failure '/usr/local/lib/opspilot-caddy/versions'
run_case chown-failure '' '/etc/opspilot/caddy'
run_case write-failure '' '' 1
run_case rename-failure '' '' '' '/etc/opspilot/caddy/Caddyfile'
run_case verify-failure '' '' '' '' 1
run_case rollback-failure '' '' '' '' 1 '/etc/opspilot/caddy/Caddyfile'
run_case lock-dir-symlink '' '' '' '' '' '' dir-symlink
run_case lock-file-symlink '' '' '' '' '' '' file-symlink
run_case lock-bad-owner '' '' '' '' '' '' bad-owner
echo LINUX_TMPFS_TRANSACTION_TESTS=PASS
