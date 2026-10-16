import { createHash, randomBytes } from 'node:crypto'
import { isIP } from 'node:net'

import type { SharedIngressReadinessResult } from '@shared/ipc'

import type { SshHostIdentity, SshManager, SshHostIdentityChangedError } from '../../ssh/manager'
import { shellQuote } from '../../ssh/shellQuote'
import type { DomainRepository, SharedIngressInventorySnapshot } from '../repository'
import { checkSharedIngressReadiness } from './dnsReadiness'
import {
  CADDY_OWNERSHIP_CHECK_SCRIPT,
  OPSPILOT_INGRESS_LOCK_PATH,
  withVpsIngressMutex,
  verifyCaddyInstallationOwnershipOverSsh
} from './caddyInstallTransaction'
import { preflightSharedIngress, type IngressPreflightResult } from './preflight'
import { buildSharedIngressConfig, type CaddyCertificateEnvironment } from './routeBuilder'

const RECONCILE_TIMEOUT_MS = 180_000
const MAX_CONFIG_BYTES = 64 * 1024
const OWNER_PREFIX = '# opspilot-generation='
const INITIAL_CONFIG = buildSharedIngressConfig([])

export type CaddyReconcileCode =
  | 'RECONCILE_INVENTORY_INVALID'
  | 'RECONCILE_HOST_CHANGED'
  | 'RECONCILE_PREFLIGHT_BLOCKED'
  | 'RECONCILE_DNS_NOT_READY'
  | 'RECONCILE_FIREWALL_NOT_READY'
  | 'RECONCILE_STAGING_SCOPE_INVALID'
  | 'RECONCILE_REMOTE_CONFLICT'
  | 'RECONCILE_CONFIG_INVALID'
  | 'RECONCILE_APPLY_FAILED_ROLLED_BACK'
  | 'RECONCILE_ROLLBACK_FAILED'
  | 'RECONCILE_DB_FAILED_NO_CHANGE'
  | 'RECONCILE_DB_FAILED_ROLLED_BACK'
  | 'RECONCILE_UNCERTAIN'

export type CaddyReconcileResult =
  | { status: 'reconciled_pending' | 'already_current'; generation: string; route_count: number }
  | { status: 'blocked'; code: CaddyReconcileCode; reason: string }

export interface CaddyReconcileAdapters {
  preflight?: (ssh: SshManager, vpsId: number) => Promise<IngressPreflightResult>
  ownership?: (ssh: SshManager, target: SshHostIdentity) => Promise<{ status: 'verified' | 'blocked'; active?: boolean }>
  dns?: (hostname: string, vpsHost: string, ingress: IngressPreflightResult) => Promise<SharedIngressReadinessResult>
  cloudFirewall?: (target: SshHostIdentity) => Promise<'verified_open' | 'blocked' | 'unknown'>
  /** Trusted application configuration only; never supplied by IPC or renderer. */
  stagingLabHostnames?: readonly string[]
}

/** Reconcile all current DB-owned routes under the install/reconcile VPS mutex. */
export async function reconcileCaddyConfigOverSsh(
  ssh: SshManager,
  repository: DomainRepository,
  target: SshHostIdentity,
  environment: CaddyCertificateEnvironment = 'production',
  adapters: CaddyReconcileAdapters = {}
): Promise<CaddyReconcileResult> {
  if (!validIdentity(target)) return blocked('RECONCILE_HOST_CHANGED', 'SSH target identity is invalid.')
  return withVpsIngressMutex(target.vpsId, () => reconcileUnderMutex(ssh, repository, target, environment, adapters))
}

async function reconcileUnderMutex(
  ssh: SshManager,
  repository: DomainRepository,
  target: SshHostIdentity,
  environment: CaddyCertificateEnvironment,
  adapters: CaddyReconcileAdapters
): Promise<CaddyReconcileResult> {
  let snapshot: SharedIngressInventorySnapshot
  try {
    snapshot = repository.getSharedIngressInventory(target.vpsId)
  } catch {
    return blocked('RECONCILE_INVENTORY_INVALID', 'DB route inventory is incomplete or conflicts with current app/deployment state.')
  }
  if (!identityMatchesSnapshot(target, snapshot)) {
    return blocked('RECONCILE_HOST_CHANGED', 'DB SSH identity does not match the pinned reconcile target.')
  }
  const routes = snapshot.bindings.filter((binding) => binding.enabled).map((binding) => ({
    hostname: binding.hostname,
    host_port: binding.host_port!
  }))
  try {
    buildSharedIngressConfig(routes, environment)
  } catch {
    return blocked('RECONCILE_INVENTORY_INVALID', 'DB route inventory contains an invalid or duplicate hostname/port.')
  }
  if (environment === 'acme_staging') {
    const allowlist = new Set((adapters.stagingLabHostnames ?? []).map(normalizeHostname))
    if (routes.length === 0 || routes.some((route) => !allowlist.has(normalizeHostname(route.hostname)))) {
      return blocked('RECONCILE_STAGING_SCOPE_INVALID', 'ACME staging is limited to an explicit lab-only hostname inventory.')
    }
  }

  try {
    const observedIdentity = await ssh.getHostIdentity(target.vpsId)
    if (!sameIdentity(target, observedIdentity)) return blocked('RECONCILE_HOST_CHANGED', 'Pinned SSH identity changed before preflight.')
  } catch {
    return blocked('RECONCILE_HOST_CHANGED', 'Could not verify the pinned SSH identity before preflight.')
  }

  let ingress: IngressPreflightResult
  try {
    ingress = await (adapters.preflight ?? preflightSharedIngress)(ssh, target.vpsId)
  } catch {
    return blocked('RECONCILE_PREFLIGHT_BLOCKED', 'Read-only ingress preflight failed.')
  }
  if (
    ingress.ownership !== 'opspilot_owned' || ingress.service !== 'verified' ||
    ingress.local_assessment !== 'clear' || ingress.install_assessment === 'blocked' ||
    ingress.ports_status === 'unknown' || ingress.config_exists !== true || ingress.config_readable !== true ||
    ingress.ufw.state === 'unknown' ||
    [ingress.ufw.inbound_80_ipv4, ingress.ufw.inbound_80_ipv6, ingress.ufw.inbound_443_ipv4, ingress.ufw.inbound_443_ipv6]
      .some((state) => state === 'unknown' || state === 'blocked')
  ) {
    return blocked('RECONCILE_PREFLIGHT_BLOCKED', 'Caddy ownership, service, or local firewall is not verified safe.')
  }
  const ownership = await (adapters.ownership ?? verifyCaddyInstallationOwnershipOverSsh)(ssh, target)
  if (ownership.status !== 'verified' || typeof ownership.active !== 'boolean') {
    return blocked('RECONCILE_PREFLIGHT_BLOCKED', 'Installed Caddy service ownership could not be verified.')
  }

  const checkDns = adapters.dns ?? (async (hostname: string, vpsHost: string, currentIngress: IngressPreflightResult) =>
    checkSharedIngressReadiness({ hostname, vpsHost, ingress: currentIngress }))
  const dnsTargets: Array<{ hostname: string; ipv4: string[]; ipv6: string[] }> = []
  for (const route of routes) {
    let readiness: SharedIngressReadinessResult
    try {
      readiness = await checkDns(route.hostname, snapshot.host, ingress)
    } catch {
      return blocked('RECONCILE_DNS_NOT_READY', `DNS readiness could not be verified for ${route.hostname}.`)
    }
    if (readiness.hostname !== route.hostname || readiness.dns_status !== 'propagated') {
      return blocked('RECONCILE_DNS_NOT_READY', `DNS is not consistently propagated for ${route.hostname}.`)
    }
    if (readiness.expected_ipv4.some((address) => isIP(address) !== 4) || readiness.expected_ipv6.some((address) => isIP(address) !== 6) || readiness.expected_ipv4.length === 0) {
      return blocked('RECONCILE_DNS_NOT_READY', `Expected public DNS targets are invalid for ${route.hostname}.`)
    }
    dnsTargets.push({ hostname: normalizeHostname(readiness.hostname), ipv4: [...new Set(readiness.expected_ipv4)].sort(), ipv6: [...new Set(readiness.expected_ipv6)].sort() })
  }
  const latest = repository.getSharedIngressInventory(target.vpsId)
  if (latest.revision !== snapshot.revision) {
    return blocked('RECONCILE_INVENTORY_INVALID', 'DB route inventory changed during readiness checks; no write was sent.')
  }
  const cloudFirewall = await (adapters.cloudFirewall ?? (async () => 'unknown'))(target)
  if (cloudFirewall !== 'verified_open') {
    return blocked('RECONCILE_FIREWALL_NOT_READY', 'Cloud firewall access to TCP 80/443 is not verified open; Caddy will not be started or reloaded.')
  }
  const generation = createHash('sha256').update(`${snapshot.revision}\n${environment}`).digest('hex')
  const config = `${OWNER_PREFIX}${generation}\n${buildSharedIngressConfig(routes, environment)}`
  if (Buffer.byteLength(config) > MAX_CONFIG_BYTES) {
    return blocked('RECONCILE_INVENTORY_INVALID', 'Generated Caddyfile exceeds the fixed size limit.')
  }
  const transactionId = randomBytes(16).toString('hex')
  const initialConfigSha256 = sha256(INITIAL_CONFIG)
  try {
    const execution = await ssh.execWithHostIdentity(
      target.vpsId,
      buildCaddyReconcileCommand(transactionId, generation, environment, config, initialConfigSha256, routes.length, dnsTargets),
      { timeoutMs: RECONCILE_TIMEOUT_MS, maxStdoutBytes: 4096, maxStderrBytes: 2048, logCommand: false, retryOnReconnect: false },
      target
    )
    if (!sameIdentity(target, execution.identity)) {
      return blocked('RECONCILE_UNCERTAIN', 'SSH identity changed after the remote transaction; inspect before retrying.')
    }
    const applied = parseApplyResult(execution.result.code, execution.result.stdout, generation)
    if (applied.status === 'blocked') return applied
    try {
      repository.recordSharedIngressReconcile(snapshot)
    } catch {
      if (applied.alreadyCurrent) {
        return blocked('RECONCILE_DB_FAILED_NO_CHANGE', 'DB observation failed; the already-current Caddy config and service were left unchanged.')
      }
      const rollback = await rollbackAfterDatabaseFailure(ssh, target, transactionId, generation, applied.configSha256)
      return rollback
        ? blocked('RECONCILE_DB_FAILED_ROLLED_BACK', 'DB observation failed; the prior Caddy config and service state were restored.')
        : blocked('RECONCILE_ROLLBACK_FAILED', 'DB observation failed and Caddy rollback could not be verified; manual reconciliation is required.')
    }
    return {
      status: applied.alreadyCurrent ? 'already_current' : 'reconciled_pending',
      generation,
      route_count: routes.length
    }
  } catch (error) {
    return blocked(
      isUndispatchedIdentityError(error) ? 'RECONCILE_HOST_CHANGED' : 'RECONCILE_UNCERTAIN',
      'SSH ended during reconcile. Do not retry until the managed config, service, and transaction backup are inspected.'
    )
  }
}

function buildCaddyReconcileCommand(
  transactionId: string,
  generation: string,
  environment: CaddyCertificateEnvironment,
  config: string,
  initialConfigSha256: string,
  routeCount: number,
  dnsTargets: readonly { hostname: string; ipv4: string[]; ipv6: string[] }[]
): string {
  if (!/^[a-f0-9]{32}$/.test(transactionId) || !/^[a-f0-9]{64}$/.test(generation) || !/^[a-f0-9]{64}$/.test(initialConfigSha256)) {
    throw new Error('Invalid reconcile transaction identity.')
  }
  if (Buffer.byteLength(config) > MAX_CONFIG_BYTES || !config.startsWith(`${OWNER_PREFIX}${generation}\n`)) {
    throw new Error('Invalid generated Caddyfile.')
  }
  return `sudo -n sh -c ${shellQuote(CADDY_RECONCILE_SCRIPT)} -- ${[
    transactionId, generation, environment, Buffer.from(config).toString('base64'), initialConfigSha256, String(routeCount), Buffer.from(JSON.stringify(dnsTargets)).toString('base64')
  ].map(shellQuote).join(' ')}`
}

function buildRollbackCommand(transactionId: string, generation: string, configSha256: string): string {
  return `sudo -n sh -c ${shellQuote(CADDY_RECONCILE_ROLLBACK_SCRIPT)} -- ${[
    transactionId, generation, configSha256
  ].map(shellQuote).join(' ')}`
}

async function rollbackAfterDatabaseFailure(
  ssh: SshManager,
  target: SshHostIdentity,
  transactionId: string,
  generation: string,
  configSha256: string
): Promise<boolean> {
  try {
    const result = await ssh.execWithHostIdentity(
      target.vpsId,
      buildRollbackCommand(transactionId, generation, configSha256),
      { timeoutMs: RECONCILE_TIMEOUT_MS, maxStdoutBytes: 1024, maxStderrBytes: 1024, logCommand: false, retryOnReconnect: false },
      target
    )
    return sameIdentity(target, result.identity) && result.result.code === 0 &&
      result.result.stdout.trim() === 'RESULT=rolled_back'
  } catch {
    return false
  }
}

type AppliedResult = { status: 'applied' | 'already'; alreadyCurrent: boolean; configSha256: string; previousActive: boolean; previousEnabled: 'enabled' | 'disabled' }

function parseApplyResult(
  exitCode: number,
  stdout: string,
  generation: string
): AppliedResult | { status: 'blocked'; code: CaddyReconcileCode; reason: string } {
  if (exitCode !== 0) return blocked('RECONCILE_UNCERTAIN', 'Remote reconcile returned no final result.')
  const lines = stdout.trim().split('\n')
  const status = lines[0]
  if (status === 'RESULT=blocked') {
    const code = lines[1]?.replace(/^CODE=/, '')
    const knownCode = isCaddyReconcileCode(code) ? code : 'RECONCILE_REMOTE_CONFLICT'
    return blocked(knownCode, `Remote precondition blocked reconcile (${code ?? 'unknown'}).`)
  }
  const failure = stdout.trim().match(/^RESULT=(failed_rolled_back|rollback_failed)\nCODE=([A-Z_]+)\nSTEP=([a-z_]+)$/)
  if (failure) {
    if (failure[1] === 'rollback_failed') return blocked('RECONCILE_ROLLBACK_FAILED', 'Caddy apply failed and snapshot restoration was not verified.')
    const code: CaddyReconcileCode = failure[2] === 'RECONCILE_CONFIG_INVALID' || failure[2] === 'RECONCILE_REMOTE_CONFLICT'
      ? failure[2]
      : 'RECONCILE_APPLY_FAILED_ROLLED_BACK'
    return blocked(code, `Caddy ${failure[3]} failed; the prior config and service state were restored.`)
  }
  const match = stdout.trim().match(/^RESULT=(applied|already_current)\nGENERATION=([a-f0-9]{64})\nCONFIG_SHA256=([a-f0-9]{64})\nPREVIOUS_ACTIVE=(0|1)\nPREVIOUS_ENABLED=(enabled|disabled)$/)
  if (!match || match[2] !== generation) return blocked('RECONCILE_UNCERTAIN', 'Remote reconcile response is incomplete or belongs to another generation.')
  return {
    status: match[1] === 'already_current' ? 'already' : 'applied',
    alreadyCurrent: match[1] === 'already_current',
    configSha256: match[3],
    previousActive: match[4] === '1',
    previousEnabled: match[5] as 'enabled' | 'disabled'
  }
}

function identityMatchesSnapshot(target: SshHostIdentity, snapshot: SharedIngressInventorySnapshot): boolean {
  return target.vpsId === snapshot.vps_id && target.host === snapshot.host && target.port === snapshot.port &&
    target.hostFingerprint === snapshot.host_fingerprint && validIdentity(target)
}

function sameIdentity(left: SshHostIdentity, right: SshHostIdentity): boolean {
  return left.vpsId === right.vpsId && left.host === right.host && left.port === right.port && left.hostFingerprint === right.hostFingerprint
}

function validIdentity(target: SshHostIdentity): boolean {
  return Number.isSafeInteger(target.vpsId) && target.vpsId > 0 && target.host.trim().length > 0 &&
    Number.isInteger(target.port) && target.port >= 1 && target.port <= 65_535 &&
    /^SHA256:[A-Za-z0-9+/]{43}$/.test(target.hostFingerprint)
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '')
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isUndispatchedIdentityError(error: unknown): error is SshHostIdentityChangedError {
  return typeof error === 'object' && error !== null && 'name' in error &&
    error.name === 'SshHostIdentityChangedError' && 'commandDispatched' in error && error.commandDispatched === false
}

function blocked(code: CaddyReconcileCode, reason: string): { status: 'blocked'; code: CaddyReconcileCode; reason: string } {
  return { status: 'blocked', code, reason }
}

function isCaddyReconcileCode(code: string | undefined): code is CaddyReconcileCode {
  return code !== undefined && [
    'RECONCILE_INVENTORY_INVALID', 'RECONCILE_HOST_CHANGED', 'RECONCILE_PREFLIGHT_BLOCKED',
    'RECONCILE_DNS_NOT_READY', 'RECONCILE_FIREWALL_NOT_READY', 'RECONCILE_STAGING_SCOPE_INVALID',
    'RECONCILE_REMOTE_CONFLICT', 'RECONCILE_CONFIG_INVALID', 'RECONCILE_APPLY_FAILED_ROLLED_BACK',
    'RECONCILE_DB_FAILED_NO_CHANGE',
    'RECONCILE_ROLLBACK_FAILED', 'RECONCILE_DB_FAILED_ROLLED_BACK', 'RECONCILE_UNCERTAIN'
  ].includes(code)
}

export const CADDY_RECONCILE_SCRIPT = `set -u
umask 077
txn=$1; generation=$2; environment=$3; config_b64=$4; initial_config_sha=$5; route_count=$6; dns_b64=$7
config=/etc/opspilot/caddy/Caddyfile; state=/etc/opspilot/caddy/RECONCILE_STATE
lock_path=${OPSPILOT_INGRESS_LOCK_PATH}
candidate="/etc/opspilot/caddy/.Caddyfile.$txn.candidate"; state_candidate="/etc/opspilot/caddy/.RECONCILE_STATE.$txn.candidate"
backup="/etc/opspilot/caddy/.Caddyfile.$txn.backup"; state_backup="/etc/opspilot/caddy/.RECONCILE_STATE.$txn.backup"
step=preflight; failure_code=RECONCILE_WRITE_FAILED; published=0; old_state_exists=0; was_active=0; was_enabled=disabled
candidate_id=; state_candidate_id=; backup_id=; state_backup_id=; candidate_sha=; state_sha=; old_config_sha=; old_state_sha=
emit(){ printf '%s\\n' "$1"; }; hash_file(){ sha256sum -- "$1" 2>/dev/null | awk '{print $1}'; }
identity(){ stat -c '%d:%i:%u:%g:%a' -- "$1" 2>/dev/null; }
remove_owned(){ path=$1; id=$2; digest=$3; [ -n "$id" ] || return 0; [ -e "$path" ] || [ -L "$path" ] || return 0; [ -f "$path" ] && [ ! -L "$path" ] && [ "$(identity "$path")" = "$id" ] && [ -n "$digest" ] && [ "$(hash_file "$path")" = "$digest" ] || return 1; rm -- "$path"; }
restore_service(){
  if [ "$was_enabled" = enabled ]; then systemctl enable opspilot-caddy.service >/dev/null 2>&1 || return 1; else systemctl disable opspilot-caddy.service >/dev/null 2>&1 || return 1; fi
  if [ "$was_active" -eq 1 ]; then systemctl start opspilot-caddy.service >/dev/null 2>&1 || return 1; verify_runtime "$config" || return 1
  else systemctl stop opspilot-caddy.service >/dev/null 2>&1 || return 1; [ "$(systemctl is-active opspilot-caddy.service 2>/dev/null || true)" != active ] || return 1; fi
}
verify_runtime(){
  expected=$1; adapted="/etc/opspilot/caddy/.adapt.$txn"; live="/etc/opspilot/caddy/.live.$txn"
  [ ! -e "$adapted" ] && [ ! -L "$adapted" ] && [ ! -e "$live" ] && [ ! -L "$live" ] || return 1
  (umask 077; set -C; : > "$adapted") 2>/dev/null || return 1
  adapted_id=$(identity "$adapted") || return 1
  (umask 077; set -C; : > "$live") 2>/dev/null || { remove_owned "$adapted" "$adapted_id" "$(hash_file "$adapted")"; return 1; }
  live_id=$(identity "$live") || { remove_owned "$adapted" "$adapted_id" "$(hash_file "$adapted")"; return 1; }
  rc=0
  /usr/bin/caddy adapt --config "$expected" --adapter caddyfile --pretty=false > "$adapted" 2>/dev/null || rc=1
  if [ "$rc" -eq 0 ]; then curl --fail --silent --show-error --max-time 3 http://127.0.0.1:2019/config/ > "$live" 2>/dev/null || rc=1; fi
  if [ "$rc" -eq 0 ]; then python3 -c 'import json,sys; a=json.load(open(sys.argv[1])); b=json.load(open(sys.argv[2])); sys.exit(0 if a==b else 1)' "$adapted" "$live" || rc=1; fi
  remove_owned "$adapted" "$adapted_id" "$(hash_file "$adapted")" || rc=1
  remove_owned "$live" "$live_id" "$(hash_file "$live")" || rc=1
  return "$rc"
}
rollback(){
  [ "$published" -eq 1 ] || return 0
  current_config_sha=$(hash_file "$config"); [ "$current_config_sha" = "$candidate_sha" ] || [ "$current_config_sha" = "$old_config_sha" ] || return 1
  [ -f "$backup" ] && [ ! -L "$backup" ] && [ "$(identity "$backup")" = "$backup_id" ] && [ "$(hash_file "$backup")" = "$old_config_sha" ] || return 1
  if [ "$current_config_sha" = "$candidate_sha" ]; then
    restore_tmp="/etc/opspilot/caddy/.Caddyfile.$txn.restore"; [ ! -e "$restore_tmp" ] && [ ! -L "$restore_tmp" ] || return 1
    (umask 077; set -C; : > "$restore_tmp") 2>/dev/null || return 1
    cat -- "$backup" > "$restore_tmp" || return 1
    chown root:opspilot-caddy "$restore_tmp" && chmod 0640 "$restore_tmp" || return 1
    [ "$(hash_file "$restore_tmp")" = "$old_config_sha" ] || return 1
    mv -fT -- "$restore_tmp" "$config" || return 1
  fi
  if [ "$old_state_exists" -eq 1 ]; then
    current_state_sha=$(hash_file "$state"); [ "$current_state_sha" = "$state_sha" ] || [ "$current_state_sha" = "$old_state_sha" ] || return 1
    [ -f "$state_backup" ] && [ "$(identity "$state_backup")" = "$state_backup_id" ] && [ "$(hash_file "$state_backup")" = "$old_state_sha" ] || return 1
    if [ "$current_state_sha" = "$state_sha" ]; then
      state_restore="/etc/opspilot/caddy/.RECONCILE_STATE.$txn.restore"; [ ! -e "$state_restore" ] && [ ! -L "$state_restore" ] || return 1
      (umask 077; set -C; : > "$state_restore") 2>/dev/null || return 1
      cat -- "$state_backup" > "$state_restore" || return 1; chmod 0600 "$state_restore" || return 1
      [ "$(hash_file "$state_restore")" = "$old_state_sha" ] || return 1
      mv -fT -- "$state_restore" "$state" || return 1
    fi
  else
    if [ -e "$state" ] || [ -L "$state" ]; then
      [ -f "$state" ] && [ "$(identity "$state")" = "$state_candidate_id" ] && [ "$(hash_file "$state")" = "$state_sha" ] || return 1
      rm -- "$state" || return 1
    fi
  fi
  if [ "$was_active" -eq 1 ]; then systemctl reload opspilot-caddy.service >/dev/null 2>&1 || systemctl restart opspilot-caddy.service >/dev/null 2>&1 || return 1; fi
  restore_service
}
cleanup(){
  rc=$?; trap - EXIT HUP INT TERM
  if [ "$rc" -ne 0 ]; then
    rolled=1; rollback || rolled=0
    remove_owned "$candidate" "$candidate_id" "$(hash_file "$candidate" 2>/dev/null || true)" || rolled=0
    remove_owned "$state_candidate" "$state_candidate_id" "$(hash_file "$state_candidate" 2>/dev/null || true)" || rolled=0
    if [ "$rolled" -eq 1 ]; then emit "RESULT=failed_rolled_back"; else emit "RESULT=rollback_failed"; fi
    emit "CODE=$failure_code"; emit "STEP=$step"; exit 0
  fi
}
trap cleanup EXIT HUP INT TERM
fail(){ failure_code=$1; exit 70; }; block(){ trap - EXIT HUP INT TERM; emit 'RESULT=blocked'; emit "CODE=$1"; exit 0; }
case "$txn" in *[!a-f0-9]*|'') block RECONCILE_CONFLICT ;; esac
[ "$(printf '%s' "$txn" | wc -c)" -eq 32 ] || block RECONCILE_CONFLICT
case "$generation$initial_config_sha" in *[!a-f0-9]*|'') block RECONCILE_CONFLICT ;; esac
[ "$(printf '%s' "$generation" | wc -c)" -eq 64 ] && [ "$(printf '%s' "$initial_config_sha" | wc -c)" -eq 64 ] || block RECONCILE_CONFLICT
case "$environment" in production|acme_staging) ;; *) block RECONCILE_CONFLICT ;; esac
case "$route_count" in *[!0-9]*|'') block RECONCILE_CONFLICT ;; esac
[ "$(printf '%s' "$config_b64" | wc -c)" -le 90000 ] || block RECONCILE_CONFLICT
[ -d /run/lock ] && [ ! -L /run/lock ] && [ "$(stat -c '%U:%G' /run/lock 2>/dev/null)" = root:root ] || block RECONCILE_LOCK_UNSAFE
case "$(stat -c '%a' /run/lock 2>/dev/null)" in 755|1777) ;; *) block RECONCILE_LOCK_UNSAFE ;; esac
[ ! -L "$lock_path" ] || block RECONCILE_LOCK_UNSAFE
if [ ! -e "$lock_path" ]; then (umask 077; set -C; : > "$lock_path") 2>/dev/null || block RECONCILE_LOCK_UNSAFE; fi
[ -f "$lock_path" ] && [ ! -L "$lock_path" ] && [ "$(stat -c '%U:%G:%a:%h' "$lock_path" 2>/dev/null)" = root:root:600:1 ] || block RECONCILE_LOCK_UNSAFE
exec 9<>"$lock_path" || block RECONCILE_LOCK_UNSAFE
flock -n 9 || block RECONCILE_LOCK_BUSY
step=locked_preflight
ownership=$(sh -c ${shellQuote(CADDY_OWNERSHIP_CHECK_SCRIPT)} 2>/dev/null) || block RECONCILE_OWNER_UNKNOWN
case "$ownership" in OWNERSHIP=verified_active) was_active=1 ;; OWNERSHIP=verified_inactive) was_active=0 ;; *) block RECONCILE_OWNER_UNKNOWN ;; esac
was_enabled=$(systemctl is-enabled opspilot-caddy.service 2>/dev/null || true); case "$was_enabled" in enabled|disabled) ;; *) block RECONCILE_OWNER_UNKNOWN ;; esac
check_dns(){
  [ "$(printf '%s' "$dns_b64" | wc -c)" -le 12000 ] || return 1
  python3 - "$dns_b64" <<'PY'
import base64, ipaddress, json, re, subprocess, sys
try:
  targets=json.loads(base64.b64decode(sys.argv[1], validate=True))
  if not isinstance(targets,list) or len(targets)>64: raise ValueError()
  for target in targets:
    host=target["hostname"].rstrip(".").lower()
    if not isinstance(host,str) or len(host)>253 or not re.fullmatch(r"[a-z0-9.-]+",host): raise ValueError()
    expected4={str(ipaddress.ip_address(x)) for x in target["ipv4"]}
    expected6={str(ipaddress.ip_address(x)) for x in target["ipv6"]}
    if any(ipaddress.ip_address(x).version != 4 for x in target["ipv4"]) or any(ipaddress.ip_address(x).version != 6 for x in target["ipv6"]): raise ValueError()
    answers=[]
    for server in ("1.1.1.1","8.8.8.8"):
      found4=set(); found6=set(); cname_chains=[]
      for kind in ("A","AAAA"):
        result=subprocess.run(("dig","+time=2","+tries=1","+noall","+answer","@"+server,host,kind),capture_output=True,timeout=3,check=False)
        if result.returncode or len(result.stdout)>8192: raise ValueError()
        records=[]
        for line in result.stdout.decode("ascii").splitlines():
          fields=line.split()
          if len(fields)!=5 or fields[2] != "IN" or fields[3] not in ("A","AAAA","CNAME"): raise ValueError()
          owner=fields[0].rstrip(".").lower(); value=fields[4].rstrip(".").lower()
          if not re.fullmatch(r"[a-z0-9.-]+",owner): raise ValueError()
          records.append((owner,fields[3],value))
        cname_map={}
        for owner,record_type,value in records:
          if record_type=="CNAME":
            if owner in cname_map or not re.fullmatch(r"[a-z0-9.-]+",value): raise ValueError()
            cname_map[owner]=value
        current=host; chain=[]; seen=set()
        while current in cname_map:
          if current in seen or len(chain)>=8: raise ValueError()
          seen.add(current); chain.append((current,cname_map[current])); current=cname_map[current]
        if any(owner not in {x for pair in chain for x in pair} for owner,record_type,value in records if record_type=="CNAME"): raise ValueError()
        cname_chains.append(tuple(chain))
        for owner,record_type,value in records:
          if record_type=="CNAME": continue
          if owner!=current: raise ValueError()
          address=ipaddress.ip_address(value)
          if record_type=="A" and address.version==4: found4.add(str(address))
          elif record_type=="AAAA" and address.version==6: found6.add(str(address))
          else: raise ValueError()
      if cname_chains[0]!=cname_chains[1] or found4!=expected4 or found6!=expected6: raise ValueError()
      answers.append((found4,found6,cname_chains[0]))
    if answers[0]!=answers[1]: raise ValueError()
except Exception:
  sys.exit(1)
sys.exit(0)
PY
}
check_dns || block RECONCILE_DNS_NOT_READY
check_ufw(){ out=$(ufw status numbered 2>/dev/null) || return 1; first=$(printf '%s\\n' "$out" | sed -n '1p'); [ "$first" = 'Status: inactive' ] && return 0; [ "$first" = 'Status: active' ] || return 1; printf '%s\\n' "$out" | awk '
  /^Status:/ {next} /^(To[[:space:]]+Action|--+)/ {next}
  {line=$0; sub(/^\\[[[:space:]]*[0-9]+\\][[:space:]]*/,"",line); if(line ~ /(^|[[:space:]])(80|443)(\\/tcp)?([[:space:]]|$)/){if(line=="80/tcp ALLOW IN Anywhere")a++;else if(line=="80/tcp (v6) ALLOW IN Anywhere (v6)")b++;else if(line=="443/tcp ALLOW IN Anywhere")c++;else if(line=="443/tcp (v6) ALLOW IN Anywhere (v6)")d++;else bad=1}} END{exit !(a==1&&b==1&&c==1&&d==1&&!bad)}' ; }
check_ufw || block RECONCILE_FIREWALL_UNKNOWN
[ -d /etc/opspilot/caddy ] && [ ! -L /etc/opspilot/caddy ] && [ "$(stat -c '%U:%G:%a' /etc/opspilot/caddy 2>/dev/null)" = root:opspilot-caddy:750 ] || block RECONCILE_OWNER_UNKNOWN
[ -f "$config" ] && [ ! -L "$config" ] && [ "$(stat -c '%U:%G:%a' "$config" 2>/dev/null)" = root:opspilot-caddy:640 ] || block RECONCILE_CONFIG_CONFLICT
old_config_sha=$(hash_file "$config"); [ "$(printf '%s' "$old_config_sha" | wc -c)" -eq 64 ] || block RECONCILE_CONFIG_CONFLICT
if [ -e "$state" ] || [ -L "$state" ]; then
 [ -f "$state" ] && [ ! -L "$state" ] && [ "$(stat -c '%U:%G:%a' "$state" 2>/dev/null)" = root:root:600 ] || block RECONCILE_CONFIG_CONFLICT
 [ "$(wc -l < "$state" 2>/dev/null)" -eq 12 ] && [ "$(sed -n '1p' "$state")" = opspilot-caddy-reconcile-v3 ] || block RECONCILE_CONFIG_CONFLICT
 old_generation=$(sed -n '2s/^generation=//p' "$state"); state_config_sha=$(sed -n '3s/^config_sha256=//p' "$state"); old_environment=$(sed -n '4s/^environment=//p' "$state"); old_transaction=$(sed -n '5s/^transaction=//p' "$state")
 case "$old_generation$state_config_sha$old_transaction" in *[!a-f0-9]*|'') block RECONCILE_CONFIG_CONFLICT ;; esac
 [ "$(printf '%s' "$old_generation" | wc -c)" -eq 64 ] && [ "$(printf '%s' "$state_config_sha" | wc -c)" -eq 64 ] && [ "$(printf '%s' "$old_transaction" | wc -c)" -eq 32 ] || block RECONCILE_CONFIG_CONFLICT
 [ "$old_environment" = production ] || [ "$old_environment" = acme_staging ] || block RECONCILE_CONFIG_CONFLICT
 [ "$state_config_sha" = "$old_config_sha" ] && grep -Fxq "# opspilot-generation=$old_generation" "$config" || block RECONCILE_CONFIG_CONFLICT
 old_state_exists=1; old_state_sha=$(hash_file "$state")
else
 old_generation=; [ "$old_config_sha" = "$initial_config_sha" ] || block RECONCILE_CONFIG_CONFLICT
fi
candidate_sha=$(printf '%s' "$config_b64" | base64 -d 2>/dev/null | sha256sum | awk '{print $1}') || block RECONCILE_CONFIG_INVALID
case "$candidate_sha" in *[!a-f0-9]*|'') block RECONCILE_CONFIG_INVALID ;; esac
candidate_content=$(printf '%s' "$config_b64" | base64 -d 2>/dev/null) || block RECONCILE_CONFIG_INVALID
[ "$(printf '%s' "$candidate_content" | wc -c)" -le 65536 ] || block RECONCILE_CONFIG_INVALID
printf '%s\\n' "$candidate_content" | grep -Fxq "# opspilot-generation=$generation" || block RECONCILE_CONFIG_INVALID
if [ "$candidate_sha" = "$old_config_sha" ] && [ "$old_generation" = "$generation" ] && { [ "$route_count" -eq 0 ] || [ "$was_active" -eq 1 ]; }; then
 if [ "$was_active" -eq 1 ]; then verify_runtime "$config" || fail RECONCILE_VERIFY_FAILED; fi
 trap - EXIT HUP INT TERM; emit 'RESULT=already_current'; emit "GENERATION=$generation"; emit "CONFIG_SHA256=$candidate_sha"; emit "PREVIOUS_ACTIVE=$was_active"; emit "PREVIOUS_ENABLED=$was_enabled"; exit 0
fi
for path in "$candidate" "$state_candidate" "$backup" "$state_backup"; do [ ! -e "$path" ] && [ ! -L "$path" ] || block RECONCILE_CONFIG_CONFLICT; done
step=stage_candidate
(umask 077; set -C; : > "$candidate") 2>/dev/null || fail RECONCILE_WRITE_FAILED; candidate_id=$(identity "$candidate") || fail RECONCILE_WRITE_FAILED
printf '%s' "$config_b64" | base64 -d > "$candidate" || fail RECONCILE_WRITE_FAILED
chown root:opspilot-caddy "$candidate" && chmod 0640 "$candidate" || fail RECONCILE_WRITE_FAILED
candidate_id=$(identity "$candidate") || fail RECONCILE_WRITE_FAILED; candidate_sha=$(hash_file "$candidate") || fail RECONCILE_WRITE_FAILED
step=validate
/usr/bin/caddy validate --config "$candidate" --adapter caddyfile >/dev/null 2>&1 || { failure_code=RECONCILE_CONFIG_INVALID; fail "$failure_code"; }
step=backup_snapshot
(umask 077; set -C; : > "$backup") 2>/dev/null || fail RECONCILE_WRITE_FAILED; backup_id=$(identity "$backup") || fail RECONCILE_WRITE_FAILED
cat -- "$config" > "$backup" && chown root:opspilot-caddy "$backup" && chmod 0640 "$backup" || fail RECONCILE_WRITE_FAILED
backup_id=$(identity "$backup") || fail RECONCILE_WRITE_FAILED; [ "$(hash_file "$backup")" = "$old_config_sha" ] || fail RECONCILE_WRITE_FAILED
if [ "$old_state_exists" -eq 1 ]; then (umask 077; set -C; : > "$state_backup") 2>/dev/null || fail RECONCILE_WRITE_FAILED; state_backup_id=$(identity "$state_backup") || fail RECONCILE_WRITE_FAILED; cat -- "$state" > "$state_backup" && chmod 0600 "$state_backup" || fail RECONCILE_WRITE_FAILED; state_backup_id=$(identity "$state_backup") || fail RECONCILE_WRITE_FAILED; [ "$(hash_file "$state_backup")" = "$old_state_sha" ] || fail RECONCILE_WRITE_FAILED; fi
step=publish
(umask 077; set -C; : > "$state_candidate") 2>/dev/null || fail RECONCILE_WRITE_FAILED; state_candidate_id=$(identity "$state_candidate") || fail RECONCILE_WRITE_FAILED
if [ "$old_state_exists" -eq 1 ]; then prior_state_exists=1; prior_state_backup_id=$state_backup_id; else prior_state_exists=0; old_state_sha=none; state_backup_id=none; fi
printf 'opspilot-caddy-reconcile-v3\\ngeneration=%s\\nconfig_sha256=%s\\nenvironment=%s\\ntransaction=%s\\nprevious_active=%s\\nprevious_enabled=%s\\nprior_config_sha256=%s\\nprior_config_identity=%s\\nprior_state_exists=%s\\nprior_state_sha256=%s\\nprior_state_backup_identity=%s\\n' "$generation" "$candidate_sha" "$environment" "$txn" "$was_active" "$was_enabled" "$old_config_sha" "$backup_id" "$prior_state_exists" "$old_state_sha" "$state_backup_id" > "$state_candidate" && chmod 0600 "$state_candidate" || fail RECONCILE_WRITE_FAILED
state_sha=$(hash_file "$state_candidate") || fail RECONCILE_WRITE_FAILED; state_candidate_id=$(identity "$state_candidate") || fail RECONCILE_WRITE_FAILED
step=prepublish_snapshot_check
[ "$(hash_file "$config")" = "$old_config_sha" ] || { failure_code=RECONCILE_REMOTE_CONFLICT; fail "$failure_code"; }
if [ "$old_state_exists" -eq 1 ]; then [ "$(hash_file "$state")" = "$old_state_sha" ] || { failure_code=RECONCILE_REMOTE_CONFLICT; fail "$failure_code"; }
else [ ! -e "$state" ] && [ ! -L "$state" ] || { failure_code=RECONCILE_REMOTE_CONFLICT; fail "$failure_code"; }; fi
config_inode=$(stat -c '%d:%i' "$candidate" 2>/dev/null) || fail RECONCILE_WRITE_FAILED; published=1; mv -fT -- "$candidate" "$config" || fail RECONCILE_WRITE_FAILED
[ "$(stat -c '%d:%i' "$config" 2>/dev/null)" = "$config_inode" ] && [ "$(hash_file "$config")" = "$candidate_sha" ] || fail RECONCILE_WRITE_FAILED; published=1
state_inode=$(stat -c '%d:%i' "$state_candidate" 2>/dev/null) || fail RECONCILE_WRITE_FAILED; mv -fT -- "$state_candidate" "$state" || fail RECONCILE_WRITE_FAILED
[ "$(stat -c '%d:%i' "$state" 2>/dev/null)" = "$state_inode" ] && [ "$(hash_file "$state")" = "$state_sha" ] || fail RECONCILE_WRITE_FAILED
step=service_transition
[ "$(hash_file "$config")" = "$candidate_sha" ] && [ "$(hash_file "$state")" = "$state_sha" ] || { failure_code=RECONCILE_REMOTE_CONFLICT; fail "$failure_code"; }
if [ "$was_active" -eq 1 ]; then systemctl reload opspilot-caddy.service >/dev/null 2>&1 || { failure_code=RECONCILE_RELOAD_FAILED; fail "$failure_code"; }
elif [ "$route_count" -gt 0 ]; then systemctl enable --now opspilot-caddy.service >/dev/null 2>&1 || { failure_code=RECONCILE_START_FAILED; fail "$failure_code"; }
fi
step=verify_runtime
[ "$(hash_file "$config")" = "$candidate_sha" ] && [ "$(hash_file "$state")" = "$state_sha" ] || { failure_code=RECONCILE_REMOTE_CONFLICT; fail "$failure_code"; }
if [ "$route_count" -gt 0 ] || [ "$was_active" -eq 1 ]; then [ "$(systemctl is-active opspilot-caddy.service 2>/dev/null || true)" = active ] && verify_runtime "$config" || { failure_code=RECONCILE_VERIFY_FAILED; fail "$failure_code"; }
else [ "$(systemctl is-active opspilot-caddy.service 2>/dev/null || true)" != active ] || { failure_code=RECONCILE_VERIFY_FAILED; fail "$failure_code"; }; fi
trap - EXIT HUP INT TERM; emit 'RESULT=applied'; emit "GENERATION=$generation"; emit "CONFIG_SHA256=$candidate_sha"; emit "PREVIOUS_ACTIVE=$was_active"; emit "PREVIOUS_ENABLED=$was_enabled"; exit 0
`

export const CADDY_RECONCILE_ROLLBACK_SCRIPT = `set -u
umask 077
txn=$1; generation=$2; expected_config_sha=$3
config=/etc/opspilot/caddy/Caddyfile; state=/etc/opspilot/caddy/RECONCILE_STATE
backup="/etc/opspilot/caddy/.Caddyfile.$txn.backup"; state_backup="/etc/opspilot/caddy/.RECONCILE_STATE.$txn.backup"
fail(){ printf 'RESULT=rollback_failed\\n'; exit 0; }; conflict(){ printf 'RESULT=rollback_conflict\\n'; exit 0; }
case "$txn$generation$expected_config_sha" in *[!a-f0-9]*|'') conflict ;; esac
lock_path=${OPSPILOT_INGRESS_LOCK_PATH}; [ -d /run/lock ] && [ ! -L /run/lock ] && [ "$(stat -c '%U:%G' /run/lock 2>/dev/null)" = root:root ] || fail
[ ! -L "$lock_path" ] || fail; [ -f "$lock_path" ] || fail; [ "$(stat -c '%U:%G:%a:%h' "$lock_path" 2>/dev/null)" = root:root:600:1 ] || fail
exec 9<>"$lock_path" || fail; flock -n 9 || conflict
ownership=$(sh -c ${shellQuote(CADDY_OWNERSHIP_CHECK_SCRIPT)} 2>/dev/null) || fail
case "$ownership" in OWNERSHIP=verified_active|OWNERSHIP=verified_inactive) ;; *) fail ;; esac
[ -f "$config" ] && [ ! -L "$config" ] && [ -f "$state" ] && [ ! -L "$state" ] || conflict
[ "$(sha256sum -- "$config" | awk '{print $1}')" = "$expected_config_sha" ] || conflict
[ "$(wc -l < "$state")" -eq 12 ] && [ "$(sed -n '1p' "$state")" = opspilot-caddy-reconcile-v3 ] && [ "$(sed -n '2s/^generation=//p' "$state")" = "$generation" ] && [ "$(sed -n '5s/^transaction=//p' "$state")" = "$txn" ] || conflict
[ "$(sed -n '3s/^config_sha256=//p' "$state")" = "$expected_config_sha" ] || conflict
previous_active=$(sed -n '6s/^previous_active=//p' "$state"); previous_enabled=$(sed -n '7s/^previous_enabled=//p' "$state")
[ "$previous_active" = 0 ] || [ "$previous_active" = 1 ] || fail; [ "$previous_enabled" = enabled ] || [ "$previous_enabled" = disabled ] || fail
[ -f "$backup" ] && [ ! -L "$backup" ] && [ "$(stat -c '%U:%G:%a' "$backup")" = root:opspilot-caddy:640 ] || fail
old_config_sha=$(sed -n '8s/^prior_config_sha256=//p' "$state"); backup_id=$(sed -n '9s/^prior_config_identity=//p' "$state")
[ "$(stat -c '%d:%i:%u:%g:%a' "$backup")" = "$backup_id" ] && [ "$(sha256sum -- "$backup" | awk '{print $1}')" = "$old_config_sha" ] || fail
prior_state_exists=$(sed -n '10s/^prior_state_exists=//p' "$state"); prior_state_sha=$(sed -n '11s/^prior_state_sha256=//p' "$state"); prior_state_backup_id=$(sed -n '12s/^prior_state_backup_identity=//p' "$state")
restore="/etc/opspilot/caddy/.Caddyfile.$txn.rollback"; [ ! -e "$restore" ] && [ ! -L "$restore" ] || conflict
(umask 077; set -C; : > "$restore") 2>/dev/null || fail
cat -- "$backup" > "$restore" && chown root:opspilot-caddy "$restore" && chmod 0640 "$restore" || fail
[ "$(sha256sum -- "$restore" | awk '{print $1}')" = "$old_config_sha" ] || fail
mv -fT -- "$restore" "$config" || fail
if [ "$prior_state_exists" = 1 ]; then
 [ -f "$state_backup" ] && [ ! -L "$state_backup" ] && [ "$(stat -c '%U:%G:%a' "$state_backup")" = root:root:600 ] || fail
 [ "$(stat -c '%d:%i:%u:%g:%a' "$state_backup")" = "$prior_state_backup_id" ] && [ "$(sha256sum -- "$state_backup" | awk '{print $1}')" = "$prior_state_sha" ] || fail
 restore_state="/etc/opspilot/caddy/.RECONCILE_STATE.$txn.rollback"; [ ! -e "$restore_state" ] && [ ! -L "$restore_state" ] || fail
 (umask 077; set -C; : > "$restore_state") 2>/dev/null || fail; cat -- "$state_backup" > "$restore_state" && chmod 0600 "$restore_state" || fail; mv -fT -- "$restore_state" "$state" || fail
elif [ "$prior_state_exists" = 0 ] && [ "$prior_state_sha" = none ] && [ "$prior_state_backup_id" = none ]; then rm -- "$state" || fail
else fail; fi
if [ "$previous_enabled" = enabled ]; then systemctl enable opspilot-caddy.service >/dev/null 2>&1 || fail; else systemctl disable opspilot-caddy.service >/dev/null 2>&1 || fail; fi
if [ "$previous_active" = 1 ]; then systemctl start opspilot-caddy.service >/dev/null 2>&1 || fail; else systemctl stop opspilot-caddy.service >/dev/null 2>&1 || fail; fi
printf 'RESULT=rolled_back\\n'
`
