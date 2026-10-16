import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { afterAll, describe, expect, it } from 'vitest'
import { shellQuote } from '../../ssh/shellQuote'
import { buildSharedIngressConfig } from './routeBuilder'
import { CADDY_OWNERSHIP_CHECK_SCRIPT } from './caddyInstallTransaction'
import { CADDY_RECONCILE_ROLLBACK_SCRIPT, CADDY_RECONCILE_SCRIPT } from './caddyReconcile'

const wslAvailable = process.platform === 'win32' && spawnSync('wsl.exe', ['--status'], { encoding: 'utf8' }).status === 0
const linuxRoot = `/dev/shm/opspilot-caddy-reconcile-${randomBytes(8).toString('hex')}`
const tempDirectory = mkdtempSync(join(tmpdir(), 'opspilot-caddy-reconcile-'))
afterAll(() => rmSync(tempDirectory, { recursive: true, force: true }))

const encode = (value: string): string => Buffer.from(value).toString('base64')

function fixtureScript(source: string): string {
  const owner = `ownership=$(sh -c ${shellQuote(CADDY_OWNERSHIP_CHECK_SCRIPT)} 2>/dev/null)`
  return source.replaceAll(owner, 'ownership=$(if [ "$(cat "$TEST_ROOT/service.active")" = active ]; then printf OWNERSHIP=verified_active; else printf OWNERSHIP=verified_inactive; fi)')
    .replaceAll('/etc/opspilot/caddy', '$TEST_ROOT/etc/opspilot/caddy')
    .replaceAll('/run/lock', '$TEST_ROOT/run/lock')
    .replaceAll('/usr/bin/caddy', '$MOCK_BIN/caddy')
    .replaceAll('chown root:opspilot-caddy', ':')
    .replaceAll('root:opspilot-caddy', '$(id -un):$(id -gn)')
    .replaceAll('root:root', '$(id -un):$(id -gn)')
}

function runTmpfsScenario(): string {
  const reconcile = fixtureScript(CADDY_RECONCILE_SCRIPT)
  const rollback = fixtureScript(CADDY_RECONCILE_ROLLBACK_SCRIPT).replace('set -u\numask 077', 'set -ux\numask 077')
  const initial = buildSharedIngressConfig([])
  const route1 = buildSharedIngressConfig([{ hostname: 'app.example.test', host_port: 3019 }])
  const route2 = buildSharedIngressConfig([
    { hostname: 'a.example.test', host_port: 3001 },
    { hostname: 'b.example.test', host_port: 3002 }
  ])
  const route3 = buildSharedIngressConfig([{ hostname: 'c.example.test', host_port: 3003 }])
  const script = [
    'set -eu',
    `BASE='${linuxRoot}'`,
    'export TEST_ROOT="$BASE/root" MOCK_BIN="$BASE/bin"; export CONFIG_PATH="$TEST_ROOT/etc/opspilot/caddy/Caddyfile"',
    'mkdir -m 700 -p "$BASE" "$TEST_ROOT/etc/opspilot/caddy" "$TEST_ROOT/run/lock" "$MOCK_BIN"',
    'chmod 750 "$TEST_ROOT/etc/opspilot/caddy"; chmod 1777 "$TEST_ROOT/run/lock"',
    `printf '%s' '${encode(reconcile)}' | base64 -d > "$BASE/reconcile.sh"`,
    `printf '%s' '${encode(rollback)}' | base64 -d > "$BASE/rollback.sh"`,
    'cat > "$MOCK_BIN/ufw" <<\'SH\'',
    '#!/bin/sh',
    'printf "Status: inactive\\n"',
    'SH',
    'cat > "$MOCK_BIN/dig" <<\'SH\'',
    '#!/bin/sh',
    'for arg do case "$arg" in @*) ;; A|AAAA) kind=$arg ;; +*) ;; *) host=$arg ;; esac; done',
    'if [ "$kind" = A ]; then printf "%s 30 IN A 203.0.113.8\\n" "$host"; elif [ "$kind" != AAAA ]; then exit 2; fi',
    'SH',
    'cat > "$MOCK_BIN/caddy" <<\'SH\'',
    '#!/bin/sh',
    'case "$1" in validate) [ "${FAIL_VALIDATE-0}" = 0 ] ;; adapt) shift; while [ "$#" -gt 0 ]; do case "$1" in --config) cfg=$2; shift 2 ;; *) shift ;; esac; done; python3 -c \'import json,sys; print(json.dumps({"content":open(sys.argv[1]).read()}))\' "$cfg" ;; *) exit 2 ;; esac',
    'SH',
    'cat > "$MOCK_BIN/curl" <<\'SH\'',
    '#!/bin/sh',
    'if [ "${FAIL_VERIFY-0}" = 1 ] && [ ! -e "$TEST_ROOT/verify.failed" ]; then : > "$TEST_ROOT/verify.failed"; printf "{}\\n"; exit 0; fi',
    'python3 -c \'import json,sys; print(json.dumps({"content":open(sys.argv[1]).read()}))\' "$CONFIG_PATH"',
    'SH',
    'cat > "$MOCK_BIN/systemctl" <<\'SH\'',
    '#!/bin/sh',
    'cmd=$1; shift',
    'case "$cmd" in is-active) cat "$TEST_ROOT/service.active" ;; is-enabled) cat "$TEST_ROOT/service.enabled" ;;',
    'enable) printf enabled > "$TEST_ROOT/service.enabled"; case " $* " in *" --now "*) [ "${FAIL_START-0}" = 0 ] || exit 1; printf active > "$TEST_ROOT/service.active" ;; esac ;;',
    'disable) printf disabled > "$TEST_ROOT/service.enabled" ;; start) [ "${FAIL_START-0}" = 0 ] || exit 1; printf active > "$TEST_ROOT/service.active" ;;',
    'stop) printf inactive > "$TEST_ROOT/service.active" ;; reload) [ "${FAIL_RELOAD-0}" = 0 ] || exit 1; printf active > "$TEST_ROOT/service.active" ;;',
    'restart) printf active > "$TEST_ROOT/service.active" ;; *) exit 2 ;; esac',
    'SH',
    'cat > "$MOCK_BIN/mv" <<\'SH\'',
    '#!/bin/sh',
    'n=$(cat "$TEST_ROOT/mv.count" 2>/dev/null || printf 0); n=$((n + 1)); printf "%s" "$n" > "$TEST_ROOT/mv.count"',
    '[ "${FAIL_MV_AT-0}" = "$n" ] && exit 1',
    'exec /usr/bin/mv "$@"',
    'SH',
    'chmod 755 "$MOCK_BIN"/*; printf disabled > "$TEST_ROOT/service.enabled"; printf inactive > "$TEST_ROOT/service.active"',
    `printf '%s' '${encode(initial)}' | base64 -d > "$CONFIG_PATH"; chmod 640 "$CONFIG_PATH"`,
    'export PATH="$MOCK_BIN:$PATH"',
    'g1=$(printf generation-one | sha256sum | cut -d" " -f1); t1=11111111111111111111111111111111',
    `cfg1=$( { printf '# opspilot-generation=%s\\n' "$g1"; printf '%s' '${encode(route1)}' | base64 -d; } | base64 -w0)`,
    `dns1='${encode(JSON.stringify([{ hostname: 'app.example.test', ipv4: ['203.0.113.8'], ipv6: [] }]))}'`,
    'sha0=$(sha256sum "$CONFIG_PATH" | cut -d" " -f1)',
    'FAIL_VALIDATE=1 bash "$BASE/reconcile.sh" 99999999999999999999999999999999 "$g1" production "$cfg1" "$sha0" 1 "$dns1" > "$BASE/validate-fail.out"',
    'grep -Fxq RESULT=failed_rolled_back "$BASE/validate-fail.out"; [ "$(sha256sum "$CONFIG_PATH" | cut -d" " -f1)" = "$sha0" ]',
    'first=$(bash "$BASE/reconcile.sh" "$t1" "$g1" production "$cfg1" "$sha0" 1 "$dns1")',
    'printf "%s\\n" "$first" | grep -Fxq RESULT=applied',
    '[ "$(cat "$TEST_ROOT/service.active")" = active ] && [ "$(cat "$TEST_ROOT/service.enabled")" = enabled ]',
    'grep -Fq "reverse_proxy 127.0.0.1:3019" "$CONFIG_PATH"',
    'second=$(bash "$BASE/reconcile.sh" 22222222222222222222222222222222 "$g1" production "$cfg1" "$sha0" 1 "$dns1")',
    'printf "%s\\n" "$second" | grep -Fxq RESULT=already_current',
    'printf inactive > "$TEST_ROOT/service.active"; restarted=$(bash "$BASE/reconcile.sh" 22333333333333333333333333333333 "$g1" production "$cfg1" "$sha0" 1 "$dns1")',
    'printf "%s\\n" "$restarted" | grep -Fxq RESULT=applied; [ "$(cat "$TEST_ROOT/service.active")" = active ]',
    'cp "$CONFIG_PATH" "$BASE/snapshot-initial"; initial_managed=$(sha256sum "$CONFIG_PATH" | cut -d" " -f1)',
    'gwrite=$(printf generation-write | sha256sum | cut -d" " -f1)',
    `cfgwrite=$( { printf '# opspilot-generation=%s\\n' "$gwrite"; printf '%s' '${encode(route3)}' | base64 -d; } | base64 -w0)`,
    `dnswrite='${encode(JSON.stringify([{ hostname: 'c.example.test', ipv4: ['203.0.113.8'], ipv6: [] }]))}'`,
    'rm -f "$TEST_ROOT/mv.count"; FAIL_MV_AT=1 bash "$BASE/reconcile.sh" 77777777777777777777777777777777 "$gwrite" production "$cfgwrite" "$initial_managed" 1 "$dnswrite" > "$BASE/write-fail.out"',
    'grep -Fxq RESULT=failed_rolled_back "$BASE/write-fail.out"; [ "$(sha256sum "$CONFIG_PATH" | cut -d" " -f1)" = "$initial_managed" ]',
    'g2=$(printf generation-two | sha256sum | cut -d" " -f1); t2=33333333333333333333333333333333',
    `cfg2=$( { printf '# opspilot-generation=%s\\n' "$g2"; printf '%s' '${encode(route2)}' | base64 -d; } | base64 -w0)`,
    `dns2='${encode(JSON.stringify([{ hostname: 'a.example.test', ipv4: ['203.0.113.8'], ipv6: [] }, { hostname: 'b.example.test', ipv4: ['203.0.113.8'], ipv6: [] }]))}'`,
    'sha1=$(sha256sum "$CONFIG_PATH" | cut -d" " -f1)',
    'multi=$(bash "$BASE/reconcile.sh" "$t2" "$g2" production "$cfg2" "$sha1" 2 "$dns2")',
    'printf "%s\\n" "$multi" | grep -Fxq RESULT=applied',
    'grep -Fq "a.example.test" "$CONFIG_PATH"; grep -Fq "b.example.test" "$CONFIG_PATH"',
    '[ ! -e "$TEST_ROOT/etc/opspilot/caddy/.adapt.$t2" ] && [ ! -e "$TEST_ROOT/etc/opspilot/caddy/.live.$t2" ]',
    'newsha=$(printf "%s\\n" "$multi" | sed -n "s/^CONFIG_SHA256=//p")',
    'FAIL_RELOAD=1 bash "$BASE/reconcile.sh" 55555555555555555555555555555555 "$g1" production "$cfg1" "$sha0" 1 "$dns1" > "$BASE/reload-fail.out"',
    'grep -Fxq RESULT=failed_rolled_back "$BASE/reload-fail.out"; grep -Fq "a.example.test" "$CONFIG_PATH"; grep -Fq "b.example.test" "$CONFIG_PATH"',
    'rolled=$(bash "$BASE/rollback.sh" "$t2" "$g2" "$newsha"); printf "%s\\n" "$rolled" | grep -Fxq RESULT=rolled_back',
    'grep -Fq "app.example.test" "$CONFIG_PATH"; ! grep -Fq "a.example.test" "$CONFIG_PATH"',
    'cp "$CONFIG_PATH" "$BASE/snapshot"; before=$(sha256sum "$BASE/snapshot" | cut -d" " -f1)',
    'g3=$(printf generation-three | sha256sum | cut -d" " -f1)',
    `cfg3=$( { printf '# opspilot-generation=%s\\n' "$g3"; printf '%s' '${encode(route3)}' | base64 -d; } | base64 -w0)`,
    `dns3='${encode(JSON.stringify([{ hostname: 'c.example.test', ipv4: ['203.0.113.8'], ipv6: [] }]))}'`,
    'sentinel="$BASE/sentinel"; printf sentinel > "$sentinel"; symlink_txn=66666666666666666666666666666666; ln -s "$sentinel" "$TEST_ROOT/etc/opspilot/caddy/.adapt.$symlink_txn"',
    'bash "$BASE/reconcile.sh" "$symlink_txn" "$g3" production "$cfg3" "$sha1" 1 "$dns3" > "$BASE/temp-symlink.out"',
    'grep -Fxq RESULT=rollback_failed "$BASE/temp-symlink.out"; [ "$(cat "$sentinel")" = sentinel ]; [ -L "$TEST_ROOT/etc/opspilot/caddy/.adapt.$symlink_txn" ]',
    '[ "$(sha256sum "$CONFIG_PATH" | cut -d" " -f1)" = "$sha1" ]',
    'FAIL_VERIFY=1 bash "$BASE/reconcile.sh" 66777777777777777777777777777777 "$g3" production "$cfg3" "$sha1" 1 "$dns3" > "$BASE/verify-fail.out"',
    'grep -Fxq RESULT=failed_rolled_back "$BASE/verify-fail.out"; [ "$(sha256sum "$CONFIG_PATH" | cut -d" " -f1)" = "$before" ]',
    'printf inactive > "$TEST_ROOT/service.active"; printf disabled > "$TEST_ROOT/service.enabled"',
    'FAIL_START=1 bash "$BASE/reconcile.sh" 44444444444444444444444444444444 "$g3" production "$cfg3" "$sha1" 1 "$dns3" > "$BASE/failure.out"',
    'grep -Fxq RESULT=failed_rolled_back "$BASE/failure.out"; [ "$(sha256sum "$CONFIG_PATH" | cut -d" " -f1)" = "$before" ]',
    '[ "$(cat "$TEST_ROOT/service.active")" = inactive ] && [ "$(cat "$TEST_ROOT/service.enabled")" = disabled ]',
    'rm -f "$TEST_ROOT/mv.count"; FAIL_START=1 FAIL_MV_AT=3 bash "$BASE/reconcile.sh" 88888888888888888888888888888888 "$g3" production "$cfg3" "$before" 1 "$dns3" > "$BASE/rollback-fail.out"',
    'grep -Fxq RESULT=rollback_failed "$BASE/rollback-fail.out"',
    'printf "LINUX_FS_PASS=first_start,multi_route_reload,idempotency,write_reload_verify_start_rollback_failures\\n"',
    'rm -rf -- "$BASE"'
  ].join('\n')
  const harness = join(tempDirectory, 'reconcile-tmpfs.sh')
  writeFileSync(harness, script, 'utf8')
  const linuxPath = spawnSync('wsl.exe', ['wslpath', '-a', harness.replaceAll('\\', '/')], { encoding: 'utf8' })
  if (linuxPath.status !== 0) throw new Error('WSL path mapping unavailable')
  const run = spawnSync('wsl.exe', ['bash', '-lc', `bash -x '${linuxPath.stdout.trim()}'`], { encoding: 'utf8', timeout: 60_000 })
  if (run.status !== 0) throw new Error(`tmpfs harness failed (${run.status}): ${run.stderr.slice(-6500)} ${run.stdout.slice(-500)}`)
  return run.stdout.trim()
}

describe('Caddy reconcile Linux isolated filesystem', () => {
  it.skipIf(!wslAvailable)('runs first start, multi-route reload, idempotency, and rollback on tmpfs', () => {
    expect(runTmpfsScenario()).toContain('LINUX_FS_PASS=first_start,multi_route_reload,idempotency,write_reload_verify_start_rollback_failures')
  }, 70_000)
})
