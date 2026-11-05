import { createHash, randomBytes } from 'node:crypto'
import { shellQuote } from '../../ssh/shellQuote'
import {
  SshHostIdentityChangedError,
  type SshHostIdentity,
  type SshManager
} from '../../ssh/manager'
import { CADDY_APT_EVIDENCE_MAX_AGE_MS, CADDY_STABLE_REPOSITORY } from './caddyAptEvidence'
import { isVerifiedCaddyInstallPlan, type CaddyInstallPlan } from './caddyInstallPlan'
import {
  EXPECTED_OPSPILOT_UNIT,
  preflightSharedIngress,
  type IngressPreflightResult
} from './preflight'
import { buildSharedIngressConfig } from './routeBuilder'

export type CaddyInstallTransactionCode =
  | 'INSTALL_PLAN_UNVERIFIED'
  | 'INSTALL_EVIDENCE_STALE'
  | 'INSTALL_HOST_CHANGED'
  | 'INSTALL_PREFLIGHT_NOT_CLEAN'
  | 'INSTALL_LOCK_BUSY'
  | 'INSTALL_CONFLICT'
  | 'INSTALL_FAILED_ROLLED_BACK'
  | 'INSTALL_VERIFY_FAILED_ROLLED_BACK'
  | 'INSTALL_ROLLBACK_FAILED'
  | 'INSTALL_RECONCILIATION_REQUIRED'

export type CaddyInstallTransactionResult =
  | { status: 'installed_not_running'; version: string; binarySha256: string }
  | { status: 'verified'; active: boolean }
  | { status: 'blocked'; code: CaddyInstallTransactionCode; reason: string }

const INSTALL_TIMEOUT_MS = 180_000
const MAX_STDOUT_BYTES = 4096
const MAX_STDERR_BYTES = 2048
const OWNER_MARKER = 'opspilot-shared-ingress-v1\n'
export const OPSPILOT_INGRESS_LOCK_PATH = '/run/lock/opspilot-ingress.lock'
// This mutex and the remote lock identity are shared by install and later reconcile work.
const ingressMutexes = new Map<number, Promise<void>>()

/** First-run transaction. It sends one no-retry command to the exact verified SSH endpoint. */
export async function installCaddyFirstRunOverSsh(
  ssh: SshManager,
  plan: CaddyInstallPlan
): Promise<CaddyInstallTransactionResult> {
  if (!Number.isSafeInteger(plan.target.vpsId) || plan.target.vpsId < 1) {
    return blocked('INSTALL_PLAN_UNVERIFIED', 'Install target identity is invalid.')
  }
  return withVpsIngressMutex(plan.target.vpsId, () => installCaddyFirstRunWithLock(ssh, plan))
}

async function installCaddyFirstRunWithLock(
  ssh: SshManager,
  plan: CaddyInstallPlan
): Promise<CaddyInstallTransactionResult> {
  if (!isVerifiedCaddyInstallPlan(plan) || !isSafePlan(plan)) {
    return blocked(
      'INSTALL_PLAN_UNVERIFIED',
      'Install requires a planner-issued immutable APT evidence plan.'
    )
  }
  if (!isFresh(plan))
    return blocked(
      'INSTALL_EVIDENCE_STALE',
      'APT evidence expired; refresh it before installation.'
    )

  let preflight: IngressPreflightResult
  try {
    preflight = await preflightSharedIngress(ssh, plan.target.vpsId)
  } catch {
    return blocked(
      'INSTALL_PREFLIGHT_NOT_CLEAN',
      'Read-only ingress preflight failed; no write was sent.'
    )
  }
  if (!isCleanHost(preflight)) {
    return blocked(
      'INSTALL_PREFLIGHT_NOT_CLEAN',
      'The VPS is no longer a verified clean host; no write was sent.'
    )
  }
  try {
    const identity = await ssh.getHostIdentity(plan.target.vpsId)
    if (!sameIdentity(plan.target, identity)) {
      return blocked(
        'INSTALL_HOST_CHANGED',
        'Pinned VPS identity changed before dispatch; no write was sent.'
      )
    }
  } catch {
    return blocked(
      'INSTALL_HOST_CHANGED',
      'Could not confirm the pinned VPS identity before dispatch.'
    )
  }
  if (!isFresh(plan))
    return blocked('INSTALL_EVIDENCE_STALE', 'APT evidence expired during preflight; refresh it.')

  try {
    const execution = await ssh.execWithHostIdentity(
      plan.target.vpsId,
      buildCaddyFirstRunInstallCommand(plan, randomBytes(16).toString('hex')),
      {
        timeoutMs: INSTALL_TIMEOUT_MS,
        maxStdoutBytes: MAX_STDOUT_BYTES,
        maxStderrBytes: MAX_STDERR_BYTES,
        logCommand: false,
        retryOnReconnect: false
      },
      plan.target
    )
    if (!sameIdentity(plan.target, execution.identity)) {
      return blocked(
        'INSTALL_RECONCILIATION_REQUIRED',
        'SSH identity changed after dispatch; inspect state before retrying.'
      )
    }
    return parseInstallResult(execution.result.code, execution.result.stdout, plan.version)
  } catch (error) {
    if (error instanceof SshHostIdentityChangedError && !error.commandDispatched) {
      return blocked(
        'INSTALL_HOST_CHANGED',
        'Connected host did not match the verified identity; command was not sent.'
      )
    }
    return blocked(
      'INSTALL_RECONCILIATION_REQUIRED',
      'SSH ended after the write may have started. Do not retry until the fixed installation artifacts are inspected.'
    )
  }
}

export async function withVpsIngressMutex<T>(vpsId: number, work: () => Promise<T>): Promise<T> {
  const previous = ingressMutexes.get(vpsId) ?? Promise.resolve()
  let release = (): void => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => gate)
  ingressMutexes.set(vpsId, tail)
  await previous
  try {
    return await work()
  } finally {
    release()
    if (ingressMutexes.get(vpsId) === tail) ingressMutexes.delete(vpsId)
  }
}

/** Reusable read-only ownership gate for a later service-start checkpoint. */
export async function verifyCaddyInstallationOwnershipOverSsh(
  ssh: SshManager,
  target: SshHostIdentity
): Promise<CaddyInstallTransactionResult> {
  if (!isValidIdentity(target))
    return blocked('INSTALL_HOST_CHANGED', 'Expected SSH identity is invalid.')
  try {
    const execution = await ssh.execWithHostIdentity(
      target.vpsId,
      `sudo -n sh -c ${shellQuote(CADDY_OWNERSHIP_CHECK_SCRIPT)}`,
      {
        timeoutMs: 20_000,
        maxStdoutBytes: MAX_STDOUT_BYTES,
        maxStderrBytes: MAX_STDERR_BYTES,
        logCommand: false,
        retryOnReconnect: false
      },
      target
    )
    if (!sameIdentity(target, execution.identity))
      return blocked('INSTALL_HOST_CHANGED', 'Pinned identity changed.')
    const match = execution.result.stdout
      .trim()
      .match(/^OWNERSHIP=(verified_active|verified_inactive)$/)
    if (execution.result.code !== 0 || !match) {
      return blocked(
        'INSTALL_RECONCILIATION_REQUIRED',
        'Caddy ownership evidence is incomplete or inconsistent.'
      )
    }
    return { status: 'verified', active: match[1] === 'verified_active' }
  } catch (error) {
    return blocked(
      error instanceof SshHostIdentityChangedError && !error.commandDispatched
        ? 'INSTALL_HOST_CHANGED'
        : 'INSTALL_RECONCILIATION_REQUIRED',
      'Could not verify Caddy ownership on the pinned host.'
    )
  }
}

/** Exposed for transaction tests; only fixed internal artifacts and validated plan metadata enter the command. */
export function buildCaddyFirstRunInstallCommand(
  plan: CaddyInstallPlan,
  transactionId: string
): string {
  if (!isSafePlan(plan) || !/^[a-f0-9]{32}$/.test(transactionId))
    throw new Error('Invalid install plan.')
  const args = [
    plan.version,
    plan.architecture,
    plan.packageSha256,
    plan.downloadUri,
    transactionId
  ]
  return `sudo -n sh -c ${shellQuote(CADDY_FIRST_RUN_INSTALL_SCRIPT)} -- ${args.map(shellQuote).join(' ')}`
}

function isSafePlan(plan: CaddyInstallPlan): boolean {
  return (
    Number.isSafeInteger(plan.target.vpsId) &&
    plan.target.vpsId > 0 &&
    isValidIdentity(plan.target) &&
    /^2\.\d+\.\d+$/.test(plan.version) &&
    (plan.architecture === 'amd64' || plan.architecture === 'arm64') &&
    /^[a-f0-9]{64}$/.test(plan.packageSha256) &&
    plan.repository.uri === CADDY_STABLE_REPOSITORY.uri &&
    plan.downloadUri.startsWith(`${CADDY_STABLE_REPOSITORY.uri}/`) &&
    !/[\r\n'";$`\\]/.test(plan.downloadUri) &&
    plan.packageFilename === `caddy_${plan.version}_${plan.architecture}.deb`
  )
}

function isFresh(plan: CaddyInstallPlan): boolean {
  const age = Date.now() - plan.issuedAt
  return Number.isFinite(age) && age >= 0 && age <= CADDY_APT_EVIDENCE_MAX_AGE_MS
}

function isCleanHost(result: IngressPreflightResult): boolean {
  return (
    result.install_assessment === 'safe' &&
    result.local_assessment === 'clear' &&
    result.ownership === 'ports_free' &&
    result.ports_status === 'free' &&
    result.service === 'absent' &&
    result.ownership_marker === 'missing' &&
    result.config_exists === false &&
    result.listeners.length === 0 &&
    result.ufw.state !== 'unknown'
  )
}

function isValidIdentity(identity: SshHostIdentity): boolean {
  return (
    Number.isSafeInteger(identity.vpsId) &&
    identity.vpsId > 0 &&
    identity.host.trim().length > 0 &&
    Number.isInteger(identity.port) &&
    identity.port >= 1 &&
    identity.port <= 65535 &&
    /^SHA256:[A-Za-z0-9+/]{43}$/.test(identity.hostFingerprint)
  )
}

function sameIdentity(left: SshHostIdentity, right: SshHostIdentity): boolean {
  return (
    left.vpsId === right.vpsId &&
    left.host === right.host &&
    left.port === right.port &&
    left.hostFingerprint === right.hostFingerprint
  )
}

function parseInstallResult(
  exitCode: number,
  stdout: string,
  version: string
): CaddyInstallTransactionResult {
  if (exitCode !== 0)
    return blocked(
      'INSTALL_RECONCILIATION_REQUIRED',
      'Remote transaction has no final status; inspect before retrying.'
    )
  const output = stdout.trim()
  const success = output.match(/^RESULT=installed_not_running\nBINARY_SHA256=([a-f0-9]{64})$/)
  if (success) return { status: 'installed_not_running', version, binarySha256: success[1] }
  const match = output.match(
    /^RESULT=(blocked|failed_rolled_back|rollback_failed|reconciliation_required)\nCODE=([A-Z_]+)(?:\nSTEP=([a-z_]+))?$/
  )
  if (!match)
    return blocked(
      'INSTALL_RECONCILIATION_REQUIRED',
      'Remote transaction response is incomplete; inspect before retrying.'
    )
  if (match[1] !== 'blocked' && !match[3]) {
    return blocked(
      'INSTALL_RECONCILIATION_REQUIRED',
      'Remote rollback result did not identify its failed phase.'
    )
  }
  if (match[1] === 'blocked') {
    const code = match[2] === 'INSTALL_LOCK_BUSY' ? 'INSTALL_LOCK_BUSY' : 'INSTALL_CONFLICT'
    return blocked(
      code,
      code === 'INSTALL_LOCK_BUSY'
        ? 'Another install transaction holds the VPS lock; wait for it to finish.'
        : 'The VPS has a conflicting path, account, package or service; no existing file was overwritten.'
    )
  }
  if (match[1] === 'reconciliation_required') {
    return blocked(
      'INSTALL_RECONCILIATION_REQUIRED',
      'A creation step ended ambiguously; unverified resources were left untouched for inspection.'
    )
  }
  if (match[1] === 'rollback_failed') {
    return blocked(
      'INSTALL_ROLLBACK_FAILED',
      'Rollback could not remove all verified transaction artifacts; inspect before retrying.'
    )
  }
  return blocked(
    match[2] === 'INSTALL_VERIFY_FAILED'
      ? 'INSTALL_VERIFY_FAILED_ROLLED_BACK'
      : 'INSTALL_FAILED_ROLLED_BACK',
    match[2] === 'INSTALL_VERIFY_FAILED'
      ? 'Post-install ownership verification failed; transaction artifacts were rolled back.'
      : 'An install step failed; transaction artifacts were rolled back.'
  )
}

function blocked(code: CaddyInstallTransactionCode, reason: string): CaddyInstallTransactionResult {
  return { status: 'blocked', code, reason }
}

export const CADDY_OWNERSHIP_CHECK_SCRIPT = `set -eu
manifest=/etc/opspilot/caddy/INSTALLATION
[ -f "$manifest" ] && [ ! -L "$manifest" ] && [ "$(wc -l < "$manifest")" -eq 6 ] || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
format=$(sed -n '1s/^format=//p' "$manifest"); version=$(sed -n '2s/^version=//p' "$manifest")
arch=$(sed -n '3s/^architecture=//p' "$manifest"); channel=$(sed -n '4s/^repository_channel=//p' "$manifest")
package_sha=$(sed -n '5s/^package_sha256=//p' "$manifest"); binary_sha=$(sed -n '6s/^binary_sha256=//p' "$manifest")
[ "$format" = opspilot-caddy-installation-v1 ] && [ "$channel" = stable ] || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
printf '%s\\n' "$version" | grep -Eq '^2\\.[0-9]+\\.[0-9]+$' || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
case "$arch" in amd64|arm64) ;; *) printf 'OWNERSHIP=unknown\\n'; exit 0 ;; esac
case "$package_sha$binary_sha" in *[!a-f0-9]*|'') printf 'OWNERSHIP=unknown\\n'; exit 0 ;; esac
[ "$(printf '%s' "$package_sha$binary_sha" | wc -c)" -eq 128 ] || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
binary="/usr/local/lib/opspilot-caddy/versions/$version/caddy"
[ "$(readlink -- /usr/bin/caddy 2>/dev/null || true)" = "$binary" ] || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
[ -f "$binary" ] && [ ! -L "$binary" ] && [ "$(stat -c '%U:%G:%a:%h' -- "$binary")" = root:root:755:1 ] || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
[ "$(sha256sum -- "$binary" | awk '{print $1}')" = "$binary_sha" ] || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
for parent in /usr /usr/bin /usr/local /usr/local/lib /usr/local/lib/opspilot-caddy /usr/local/lib/opspilot-caddy/versions "/usr/local/lib/opspilot-caddy/versions/$version" /etc /etc/systemd /etc/systemd/system /etc/opspilot /etc/opspilot/caddy /var /var/lib /var/lib/opspilot /var/lib/opspilot/caddy /var/lib/opspilot/caddy/production; do [ -d "$parent" ] && [ ! -L "$parent" ] || { printf 'OWNERSHIP=unknown\\n'; exit 0; }; done
[ "$(stat -c '%U:%G:%a' /usr /usr/bin /usr/local /usr/local/lib /usr/local/lib/opspilot-caddy /usr/local/lib/opspilot-caddy/versions "/usr/local/lib/opspilot-caddy/versions/$version" /etc /etc/systemd /etc/systemd/system /etc/opspilot /var /var/lib /var/lib/opspilot 2>/dev/null | sort -u)" = 'root:root:755' ] || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
[ "$(stat -c '%U:%G:%a' /etc/opspilot/caddy)" = root:opspilot-caddy:750 ] || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
[ "$(getent group opspilot-caddy | cut -d: -f1)" = opspilot-caddy ] || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
[ "$(getent passwd opspilot-caddy | cut -d: -f6,7)" = /var/lib/opspilot/caddy:/usr/sbin/nologin ] && [ "$(id -g opspilot-caddy)" = "$(getent group opspilot-caddy | cut -d: -f3)" ] || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
[ ! -L /etc/opspilot/caddy/OWNER ] && [ "$(sha256sum /etc/opspilot/caddy/OWNER 2>/dev/null | awk '{print $1}')" = '${sha256(OWNER_MARKER)}' ] || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
[ "$(stat -c '%U:%G:%a' /etc/opspilot/caddy/OWNER 2>/dev/null || true)" = root:root:644 ] || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
[ ! -L /etc/opspilot/caddy/INSTALLATION ] && [ "$(stat -c '%U:%G:%a' /etc/opspilot/caddy/INSTALLATION 2>/dev/null || true)" = root:root:644 ] || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
[ ! -L /etc/systemd/system/opspilot-caddy.service ] && [ "$(stat -c '%U:%G:%a' /etc/systemd/system/opspilot-caddy.service 2>/dev/null || true)" = root:root:644 ] || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
[ "$(sha256sum /etc/systemd/system/opspilot-caddy.service | awk '{print $1}')" = '${sha256(EXPECTED_OPSPILOT_UNIT)}' ] || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
[ -f /etc/opspilot/caddy/Caddyfile ] && [ ! -L /etc/opspilot/caddy/Caddyfile ] && [ "$(stat -c '%U:%G:%a' /etc/opspilot/caddy/Caddyfile)" = root:opspilot-caddy:640 ] || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
[ "$(stat -c '%U:%G:%a' /etc/opspilot/caddy)" = root:opspilot-caddy:750 ] || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
[ "$(stat -c '%U:%G:%a' /var/lib/opspilot/caddy)" = opspilot-caddy:opspilot-caddy:700 ] || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
[ "$(stat -c '%U:%G:%a' /var/lib/opspilot/caddy/production)" = opspilot-caddy:opspilot-caddy:700 ] || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
unit=$(systemctl show opspilot-caddy.service --property=LoadState,ActiveState,FragmentPath,DropInPaths,ExecStartPre,ExecStart,ExecReload,User,Group,Type,WorkingDirectory,Environment,UMask,Restart,RestartUSec,TimeoutStopUSec,LimitNOFILE,NoNewPrivileges,PrivateTmp,ProtectSystem,ProtectHome,ProtectKernelTunables,ProtectKernelModules,ProtectControlGroups,RestrictSUIDSGID,LockPersonality,CapabilityBoundingSet,AmbientCapabilities,ReadWritePaths --no-pager 2>/dev/null) || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
printf '%s\\n' "$unit" | grep -Fxq LoadState=loaded && printf '%s\\n' "$unit" | grep -Fxq FragmentPath=/etc/systemd/system/opspilot-caddy.service && printf '%s\\n' "$unit" | grep -Fxq 'DropInPaths=' || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
for property in \\
  'User=opspilot-caddy' 'Group=opspilot-caddy' 'Type=notify' \\
  'WorkingDirectory=/etc/opspilot/caddy' 'Environment=HOME=/var/lib/opspilot/caddy' \\
  'UMask=0077' 'Restart=on-failure' 'RestartUSec=2s' 'TimeoutStopUSec=5s' \\
  'LimitNOFILE=1048576' 'NoNewPrivileges=yes' 'PrivateTmp=yes' \\
  'ProtectSystem=strict' 'ProtectHome=yes' 'ProtectKernelTunables=yes' \\
  'ProtectKernelModules=yes' 'ProtectControlGroups=yes' 'RestrictSUIDSGID=yes' \\
  'LockPersonality=yes' 'CapabilityBoundingSet=cap_net_bind_service' \\
  'AmbientCapabilities=cap_net_bind_service' 'ReadWritePaths=/var/lib/opspilot/caddy'; do
  printf '%s\\n' "$unit" | grep -Fxq "$property" || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
done
for property in \\
  'ExecStartPre=/usr/bin/caddy validate --config /etc/opspilot/caddy/Caddyfile --adapter caddyfile' \\
  'ExecStart=/usr/bin/caddy run --config /etc/opspilot/caddy/Caddyfile --adapter caddyfile' \\
  'ExecReload=/usr/bin/caddy reload --config /etc/opspilot/caddy/Caddyfile --adapter caddyfile --force'; do
  key=\${property%%=*}; expected=\${property#*=}; actual=$(printf '%s\\n' "$unit" | sed -n "s/^$key={ path=[^;]* ; argv\\[\\]=\\(.*\\) ; ignore_errors=.*$/\\1/p; s/^$key=//p")
  [ "$actual" = "$expected" ] || { printf 'OWNERSHIP=unknown\\n'; exit 0; }
done
active=$(printf '%s\\n' "$unit" | sed -n 's/^ActiveState=//p')
case "$active" in active) printf 'OWNERSHIP=verified_active\\n' ;; inactive) printf 'OWNERSHIP=verified_inactive\\n' ;; *) printf 'OWNERSHIP=unknown\\n' ;; esac
`

export const CADDY_FIRST_RUN_INSTALL_SCRIPT = `set -u
umask 077
version=$1; architecture=$2; package_sha=$3; download_uri=$4; txn=$5
step=lock; write_started=0; committed=0; response_sent=0; stage_created=0; uncertain=0; failure_code=INSTALL_FAILED
created_group=0; created_user=0; created_binary=0; created_link=0; created_unit=0; created_config=0; created_owner=0; created_manifest=0
made_lib=0; made_versions=0; made_version=0; made_etc=0; made_etc_caddy=0; made_var=0; made_var_caddy=0; made_storage=0
lib_id=''; versions_id=''; version_id=''; etc_id=''; etc_caddy_id=''; var_id=''; var_caddy_id=''; storage_id=''
atomic_temp_path=''; atomic_temp_id=''; atomic_temp_inode=''; binary_id=''; link_id=''; config_id=''; unit_id=''; owner_id=''; manifest_id=''
binary_temp_path=''; binary_temp_id=''; binary_temp_inode=''
group_id=''; user_id=''; binary_sha=''; binary_path="/usr/local/lib/opspilot-caddy/versions/$version/caddy"
stage_dir="/var/tmp/opspilot-caddy-install-$txn"; stage_id=''
emit() { printf '%s\\n' "$1"; }
cleanup_atomic_temp() {
  [ -n "$atomic_temp_path" ] || return 0
  if [ ! -e "$atomic_temp_path" ] && [ ! -L "$atomic_temp_path" ]; then return 0; fi
  [ -n "$atomic_temp_id" ] && [ -f "$atomic_temp_path" ] && [ ! -L "$atomic_temp_path" ] && [ "$(stat -c '%d:%i:%U:%G:%a' -- "$atomic_temp_path" 2>/dev/null)" = "$atomic_temp_id" ] || return 1
  rm -- "$atomic_temp_path" >/dev/null 2>&1
}
cleanup_binary_temp() {
  [ -n "$binary_temp_path" ] || return 0
  if [ ! -e "$binary_temp_path" ] && [ ! -L "$binary_temp_path" ]; then return 0; fi
  [ -n "$binary_temp_id" ] && [ -f "$binary_temp_path" ] && [ ! -L "$binary_temp_path" ] && [ "$(stat -c '%d:%i:%U:%G:%a' -- "$binary_temp_path" 2>/dev/null)" = "$binary_temp_id" ] || return 1
  rm -- "$binary_temp_path" >/dev/null 2>&1
}
cleanup_stage() {
  [ "$stage_created" -eq 1 ] || return 0
  [ -d "$stage_dir" ] && [ ! -L "$stage_dir" ] && [ "$(stat -c '%d:%i:%U:%G:%a' "$stage_dir" 2>/dev/null)" = "$stage_id" ] || return 1
  find "$stage_dir" -xdev -mindepth 1 ! -uid 0 -print -quit | grep -q . && return 1
  find "$stage_dir" -xdev -depth -mindepth 1 -delete >/dev/null 2>&1 || return 1
  rmdir -- "$stage_dir" >/dev/null 2>&1 || return 1
  stage_created=0
}
remove_hash() { file=$1 expected=$2 owner_mode=$3 expected_id=$4; if [ ! -e "$file" ] && [ ! -L "$file" ]; then return 0; fi; [ -f "$file" ] && [ ! -L "$file" ] && [ "$(stat -c '%U:%G:%a' -- "$file" 2>/dev/null)" = "$owner_mode" ] && [ -n "$expected_id" ] && [ "$(stat -c '%d:%i:%U:%G:%a' -- "$file" 2>/dev/null)" = "$expected_id" ] || return 1; actual=$(sha256sum -- "$file" 2>/dev/null | awk '{print $1}') || return 1; [ "$actual" = "$expected" ] || return 1; rm -- "$file"; }
remove_dir() { dir=$1 expected=$2; if [ ! -e "$dir" ] && [ ! -L "$dir" ]; then return 0; fi; [ -d "$dir" ] && [ ! -L "$dir" ] && [ "$(stat -c '%d:%i:%U:%G:%a' -- "$dir" 2>/dev/null)" = "$expected" ] || return 1; rmdir -- "$dir"; }
rollback() {
  ok=1
  cleanup_atomic_temp || ok=0
  cleanup_binary_temp || ok=0
  if [ "$created_manifest" -eq 1 ]; then expected=$(printf 'format=opspilot-caddy-installation-v1\\nversion=%s\\narchitecture=%s\\nrepository_channel=stable\\npackage_sha256=%s\\nbinary_sha256=%s\\n' "$version" "$architecture" "$package_sha" "$binary_sha" | sha256sum | awk '{print $1}'); remove_hash /etc/opspilot/caddy/INSTALLATION "$expected" root:root:644 "$manifest_id" || ok=0; fi
  [ "$created_owner" -eq 0 ] || remove_hash /etc/opspilot/caddy/OWNER '${sha256(OWNER_MARKER)}' root:root:644 "$owner_id" || ok=0
  [ "$created_config" -eq 0 ] || remove_hash /etc/opspilot/caddy/Caddyfile '${sha256(buildSharedIngressConfig([]))}' root:opspilot-caddy:640 "$config_id" || ok=0
  [ "$created_unit" -eq 0 ] || remove_hash /etc/systemd/system/opspilot-caddy.service '${sha256(EXPECTED_OPSPILOT_UNIT)}' root:root:644 "$unit_id" || ok=0
  if [ "$created_link" -eq 1 ]; then if [ -L /usr/bin/caddy ]; then [ "$(readlink -- /usr/bin/caddy 2>/dev/null || true)" = "$binary_path" ] && [ "$(stat -c '%d:%i:%U:%G:%a' /usr/bin/caddy 2>/dev/null)" = "$link_id" ] && [ "$(stat -c '%U:%G:%a' /usr/bin/caddy)" = root:root:777 ] && rm -- /usr/bin/caddy || ok=0; elif [ -e /usr/bin/caddy ]; then ok=0; fi; fi
  [ "$created_binary" -eq 0 ] || remove_hash "$binary_path" "$binary_sha" root:root:755 "$binary_id" || ok=0
  [ "$made_storage" -eq 0 ] || remove_dir /var/lib/opspilot/caddy/production "$storage_id" || ok=0
  [ "$made_var_caddy" -eq 0 ] || remove_dir /var/lib/opspilot/caddy "$var_caddy_id" || ok=0
  [ "$made_var" -eq 0 ] || remove_dir /var/lib/opspilot "$var_id" || ok=0
  [ "$made_etc_caddy" -eq 0 ] || remove_dir /etc/opspilot/caddy "$etc_caddy_id" || ok=0
  [ "$made_etc" -eq 0 ] || remove_dir /etc/opspilot "$etc_id" || ok=0
  [ "$made_version" -eq 0 ] || remove_dir "/usr/local/lib/opspilot-caddy/versions/$version" "$version_id" || ok=0
  [ "$made_versions" -eq 0 ] || remove_dir /usr/local/lib/opspilot-caddy/versions "$versions_id" || ok=0
  [ "$made_lib" -eq 0 ] || remove_dir /usr/local/lib/opspilot-caddy "$lib_id" || ok=0
  if [ "$created_unit" -eq 1 ]; then systemctl daemon-reload >/dev/null 2>&1 || ok=0; fi
  if [ "$ok" -eq 1 ] && [ "$uncertain" -eq 0 ]; then
    if [ "$created_user" -eq 1 ]; then [ "$(getent passwd opspilot-caddy | cut -d: -f3,4,6,7)" = "$user_id:$group_id:/var/lib/opspilot/caddy:/usr/sbin/nologin" ] && userdel -- opspilot-caddy >/dev/null 2>&1 || ok=0; fi
    if [ "$ok" -eq 1 ] && [ "$created_group" -eq 1 ]; then [ "$(getent group opspilot-caddy | cut -d: -f3,4)" = "$group_id:" ] && groupdel -- opspilot-caddy >/dev/null 2>&1 || ok=0; fi
  fi
  return "$((1-ok))"
}
on_exit() {
  rc=$?; trap - EXIT HUP INT TERM
  if [ "$committed" -eq 1 ]; then exit 0; fi
  if [ "$response_sent" -eq 1 ]; then cleanup_atomic_temp >/dev/null 2>&1 || true; cleanup_stage >/dev/null 2>&1 || true; exit 0; fi
  cleanup_ok=1
  if [ "$write_started" -eq 1 ]; then rollback || cleanup_ok=0; else cleanup_atomic_temp || cleanup_ok=0; fi
  cleanup_stage || cleanup_ok=0
  if [ "$uncertain" -eq 1 ]; then emit RESULT=reconciliation_required; elif [ "$cleanup_ok" -eq 1 ]; then emit RESULT=failed_rolled_back; else emit RESULT=rollback_failed; fi
  emit "CODE=$failure_code"; emit "STEP=$step"; exit 0
}
trap on_exit EXIT HUP INT TERM
fail() { failure_code=$1; exit 70; }
fail_uncertain() { uncertain=1; failure_code=INSTALL_RECONCILIATION_REQUIRED; exit 70; }
block() { emit RESULT=blocked; emit "CODE=$1"; response_sent=1; exit 0; }
make_dir() {
  dir_path=$1; dir_mode=$2; created_dir_identity=''
  [ ! -e "$dir_path" ] && [ ! -L "$dir_path" ] || { uncertain=1; return 2; }
  mkdir -m "$dir_mode" -- "$dir_path"; dir_rc=$?
  if [ "$dir_rc" -eq 0 ]; then
    [ -d "$dir_path" ] && [ ! -L "$dir_path" ] || { uncertain=1; return 2; }
    created_dir_identity=$(stat -c '%d:%i:%U:%G:%a' -- "$dir_path" 2>/dev/null) || { uncertain=1; return 2; }
    [ -n "$created_dir_identity" ] || { uncertain=1; return 2; }
    return 0
  fi
  if [ -e "$dir_path" ] || [ -L "$dir_path" ]; then uncertain=1; return 2; fi
  return 1
}
printf '%s\\n' "$version" | grep -Eq '^2\\.[0-9]+\\.[0-9]+$' || block INSTALL_CONFLICT
case "$architecture" in amd64|arm64) ;; *) block INSTALL_CONFLICT ;; esac
case "$package_sha" in *[!a-f0-9]*|'') block INSTALL_CONFLICT ;; esac
[ "$(printf '%s' "$package_sha" | wc -c)" -eq 64 ] || block INSTALL_CONFLICT
case "$download_uri" in https://dl.cloudsmith.io/public/caddy/stable/deb/debian/*) ;; *) block INSTALL_CONFLICT ;; esac
case "$txn" in *[!a-f0-9]*|'') block INSTALL_CONFLICT ;; esac
[ "$(printf '%s' "$txn" | wc -c)" -eq 32 ] || block INSTALL_CONFLICT
lock_path=${OPSPILOT_INGRESS_LOCK_PATH}
[ -d /run ] && [ ! -L /run ] && [ "$(stat -c '%U:%G' /run 2>/dev/null)" = root:root ] || block INSTALL_CONFLICT
[ "$(stat -c '%a' /run 2>/dev/null)" = 755 ] || block INSTALL_CONFLICT
[ -d /run/lock ] && [ ! -L /run/lock ] && [ "$(stat -c '%U:%G' /run/lock 2>/dev/null)" = root:root ] || block INSTALL_CONFLICT
lock_mode=$(stat -c '%a' /run/lock 2>/dev/null) || block INSTALL_CONFLICT
case "$lock_mode" in 755|1777) ;; *) block INSTALL_CONFLICT ;; esac
[ ! -L "$lock_path" ] || block INSTALL_CONFLICT
if [ ! -e "$lock_path" ]; then (umask 077; set -C; : > "$lock_path") 2>/dev/null || block INSTALL_CONFLICT; fi
[ -f "$lock_path" ] && [ ! -L "$lock_path" ] && [ "$(stat -c '%U:%G:%a:%h' "$lock_path" 2>/dev/null)" = root:root:600:1 ] || block INSTALL_CONFLICT
exec 9<>"$lock_path" || block INSTALL_CONFLICT
flock -n 9 || block INSTALL_LOCK_BUSY
step=locked_preflight
for parent in /usr /usr/bin /usr/local /usr/local/lib /etc /etc/systemd /etc/systemd/system /var /var/lib; do [ -d "$parent" ] && [ ! -L "$parent" ] && [ "$(stat -c '%U:%G:%a' -- "$parent" 2>/dev/null)" = root:root:755 ] || block INSTALL_CONFLICT; done
for path in /usr/bin/caddy /usr/local/lib/opspilot-caddy /etc/opspilot /etc/systemd/system/opspilot-caddy.service /var/lib/opspilot; do [ ! -e "$path" ] && [ ! -L "$path" ] || block INSTALL_CONFLICT; done
for temp in /etc/opspilot/caddy/Caddyfile.opspilot-$txn.tmp /etc/systemd/system/opspilot-caddy.service.opspilot-$txn.tmp /etc/opspilot/caddy/OWNER.opspilot-$txn.tmp /etc/opspilot/caddy/INSTALLATION.opspilot-$txn.tmp; do [ ! -e "$temp" ] && [ ! -L "$temp" ] || block INSTALL_CONFLICT; done
for unit in caddy.service caddy-api.service opspilot-caddy.service nginx.service apache2.service httpd.service traefik.service haproxy.service; do state=$(systemctl show "$unit" --property=LoadState --value --no-pager 2>/dev/null) || block INSTALL_CONFLICT; [ "$state" = not-found ] || block INSTALL_CONFLICT; done
command -v dpkg-query >/dev/null 2>&1 && command -v dpkg-deb >/dev/null 2>&1 && command -v curl >/dev/null 2>&1 && command -v flock >/dev/null 2>&1 || block INSTALL_CONFLICT
if dpkg-query -W caddy >/dev/null 2>&1; then block INSTALL_CONFLICT; else query_rc=$?; [ "$query_rc" -eq 1 ] || block INSTALL_CONFLICT; fi
if getent passwd opspilot-caddy >/dev/null 2>&1 || getent group opspilot-caddy >/dev/null 2>&1; then block INSTALL_CONFLICT; fi
listeners=$(ss -H -ltnp 'sport = :80 or sport = :443' 2>/dev/null) || block INSTALL_CONFLICT
[ -z "$listeners" ] || block INSTALL_CONFLICT
if [ -e "$stage_dir" ] || [ -L "$stage_dir" ]; then block INSTALL_CONFLICT; fi
if make_dir "$stage_dir" 0700; then stage_created=1; stage_id=$created_dir_identity; else [ "$uncertain" -eq 1 ] && fail_uncertain || fail INSTALL_FAILED; fi
step=download
curl --fail --silent --show-error --location --max-filesize 104857600 --output "$stage_dir/caddy.deb" "$download_uri" >/dev/null 2>&1 || fail INSTALL_FAILED
[ -s "$stage_dir/caddy.deb" ] || fail INSTALL_FAILED
printf '%s  %s\\n' "$package_sha" "$stage_dir/caddy.deb" | sha256sum --check - >/dev/null 2>&1 || fail INSTALL_FAILED
step=extract_binary
dpkg-deb --fsys-tarfile "$stage_dir/caddy.deb" > "$stage_dir/data.tar" 2>/dev/null || fail INSTALL_FAILED
tar -xOf "$stage_dir/data.tar" ./usr/bin/caddy > "$stage_dir/signed-binary" 2>/dev/null || fail INSTALL_FAILED
binary_sha=$(sha256sum -- "$stage_dir/signed-binary" | awk '{print $1}') || fail INSTALL_FAILED
dpkg-deb --extract "$stage_dir/caddy.deb" "$stage_dir/root" >/dev/null 2>&1 || fail INSTALL_FAILED
[ -f "$stage_dir/root/usr/bin/caddy" ] && [ ! -L "$stage_dir/root/usr/bin/caddy" ] && [ "$(sha256sum -- "$stage_dir/root/usr/bin/caddy" | awk '{print $1}')" = "$binary_sha" ] || fail INSTALL_FAILED
step=create_account; write_started=1
groupadd --system opspilot-caddy >/dev/null 2>&1; group_rc=$?
if [ "$group_rc" -eq 0 ]; then
  group_record=$(getent group opspilot-caddy 2>/dev/null) || fail_uncertain
  group_id=$(printf '%s\n' "$group_record" | cut -d: -f3)
  [ "$(printf '%s' "$group_record" | cut -d: -f1)" = opspilot-caddy ] && printf '%s' "$group_id" | grep -Eq '^[0-9]+$' || fail_uncertain
  created_group=1
elif getent group opspilot-caddy >/dev/null 2>&1; then fail_uncertain; else fail INSTALL_FAILED; fi
useradd --system --gid opspilot-caddy --home-dir /var/lib/opspilot/caddy --no-create-home --shell /usr/sbin/nologin opspilot-caddy >/dev/null 2>&1; user_rc=$?
if [ "$user_rc" -eq 0 ]; then
  user_record=$(getent passwd opspilot-caddy 2>/dev/null) || fail_uncertain
  user_id=$(printf '%s\n' "$user_record" | cut -d: -f3)
  [ "$(printf '%s' "$user_record" | cut -d: -f1)" = opspilot-caddy ] && printf '%s' "$user_id" | grep -Eq '^[0-9]+$' && [ "$(printf '%s' "$user_record" | cut -d: -f4)" = "$group_id" ] && [ "$(printf '%s' "$user_record" | cut -d: -f6,7)" = /var/lib/opspilot/caddy:/usr/sbin/nologin ] || fail_uncertain
  created_user=1
elif getent passwd opspilot-caddy >/dev/null 2>&1; then fail_uncertain; else fail INSTALL_FAILED; fi
step=create_paths
if make_dir /usr/local/lib/opspilot-caddy 0755; then made_lib=1; lib_id=$created_dir_identity; else [ "$uncertain" -eq 1 ] && fail_uncertain || fail INSTALL_FAILED; fi
if make_dir /usr/local/lib/opspilot-caddy/versions 0755; then made_versions=1; versions_id=$created_dir_identity; else [ "$uncertain" -eq 1 ] && fail_uncertain || fail INSTALL_FAILED; fi
if make_dir "/usr/local/lib/opspilot-caddy/versions/$version" 0755; then made_version=1; version_id=$created_dir_identity; else [ "$uncertain" -eq 1 ] && fail_uncertain || fail INSTALL_FAILED; fi
binary_temp_path="/usr/local/lib/opspilot-caddy/versions/$version/.caddy-$txn.tmp"
[ ! -e "$binary_temp_path" ] && [ ! -L "$binary_temp_path" ] || fail_uncertain
(umask 077; set -C; : > "$binary_temp_path") 2>/dev/null; binary_temp_rc=$?
if [ "$binary_temp_rc" -eq 0 ]; then
  binary_temp_id=$(stat -c '%d:%i:%U:%G:%a' -- "$binary_temp_path" 2>/dev/null) || fail_uncertain
  binary_temp_inode=$(stat -c '%d:%i' -- "$binary_temp_path" 2>/dev/null) || fail_uncertain
  [ -n "$binary_temp_id" ] && [ -n "$binary_temp_inode" ] || fail_uncertain
elif [ -e "$binary_temp_path" ] || [ -L "$binary_temp_path" ]; then fail_uncertain; else fail INSTALL_FAILED; fi
cat -- "$stage_dir/root/usr/bin/caddy" > "$binary_temp_path" || fail INSTALL_FAILED
chown root:root -- "$binary_temp_path" || fail INSTALL_FAILED
chmod 0755 -- "$binary_temp_path" || fail INSTALL_FAILED
binary_temp_id=$(stat -c '%d:%i:%U:%G:%a' -- "$binary_temp_path" 2>/dev/null) || fail_uncertain
[ "$(sha256sum -- "$binary_temp_path" | awk '{print $1}')" = "$binary_sha" ] || fail INSTALL_FAILED
mv -nT -- "$binary_temp_path" "$binary_path"; binary_move_rc=$?
if [ ! -e "$binary_temp_path" ] && [ ! -L "$binary_temp_path" ] && [ -f "$binary_path" ] && [ ! -L "$binary_path" ] && [ "$(stat -c '%d:%i' -- "$binary_path" 2>/dev/null || true)" = "$binary_temp_inode" ]; then
  binary_id=$(stat -c '%d:%i:%U:%G:%a' -- "$binary_path" 2>/dev/null) || fail_uncertain
  [ -n "$binary_id" ] || fail_uncertain
  created_binary=1
elif [ -f "$binary_temp_path" ] && [ ! -L "$binary_temp_path" ] && [ "$(stat -c '%d:%i:%U:%G:%a' -- "$binary_temp_path" 2>/dev/null || true)" = "$binary_temp_id" ]; then
  fail INSTALL_FAILED
else fail_uncertain; fi
[ "$binary_move_rc" -eq 0 ] || fail INSTALL_FAILED
[ "$(sha256sum -- "$binary_path" | awk '{print $1}')" = "$binary_sha" ] || fail INSTALL_FAILED
ln -s -- "$binary_path" /usr/bin/caddy; link_rc=$?
if [ "$link_rc" -eq 0 ]; then
  [ -L /usr/bin/caddy ] && [ "$(readlink -- /usr/bin/caddy 2>/dev/null || true)" = "$binary_path" ] || fail_uncertain
  link_id=$(stat -c '%d:%i:%U:%G:%a' -- /usr/bin/caddy 2>/dev/null) || fail_uncertain
  [ -n "$link_id" ] || fail_uncertain
  created_link=1
elif [ -L /usr/bin/caddy ] || [ -e /usr/bin/caddy ]; then fail_uncertain; else fail INSTALL_FAILED; fi
if make_dir /etc/opspilot 0755; then made_etc=1; etc_id=$created_dir_identity; else [ "$uncertain" -eq 1 ] && fail_uncertain || fail INSTALL_FAILED; fi
if make_dir /etc/opspilot/caddy 0750; then made_etc_caddy=1; etc_caddy_id=$created_dir_identity; else [ "$uncertain" -eq 1 ] && fail_uncertain || fail INSTALL_FAILED; fi
chown root:opspilot-caddy /etc/opspilot/caddy || fail INSTALL_FAILED; etc_caddy_id=$(stat -c '%d:%i:%U:%G:%a' /etc/opspilot/caddy)
if make_dir /var/lib/opspilot 0755; then made_var=1; var_id=$created_dir_identity; else [ "$uncertain" -eq 1 ] && fail_uncertain || fail INSTALL_FAILED; fi
if make_dir /var/lib/opspilot/caddy 0700; then made_var_caddy=1; var_caddy_id=$created_dir_identity; else [ "$uncertain" -eq 1 ] && fail_uncertain || fail INSTALL_FAILED; fi
chown opspilot-caddy:opspilot-caddy /var/lib/opspilot/caddy || fail INSTALL_FAILED; var_caddy_id=$(stat -c '%d:%i:%U:%G:%a' /var/lib/opspilot/caddy)
if make_dir /var/lib/opspilot/caddy/production 0700; then made_storage=1; storage_id=$created_dir_identity; else [ "$uncertain" -eq 1 ] && fail_uncertain || fail INSTALL_FAILED; fi
chown opspilot-caddy:opspilot-caddy /var/lib/opspilot/caddy/production || fail INSTALL_FAILED; storage_id=$(stat -c '%d:%i:%U:%G:%a' /var/lib/opspilot/caddy/production)
step=write_artifacts
write_atomic() {
  data=$1; path=$2; owner=$3; group=$4; mode=$5; temp="$path.opspilot-$txn.tmp"
  moved_owned=0
  atomic_temp_path=$temp
  [ ! -e "$temp" ] && [ ! -L "$temp" ] || { uncertain=1; return 1; }
  (umask 077; set -C; : > "$temp") 2>/dev/null; create_rc=$?
  if [ "$create_rc" -eq 0 ] && [ -f "$temp" ] && [ ! -L "$temp" ]; then atomic_temp_id=$(stat -c '%d:%i:%U:%G:%a' -- "$temp" 2>/dev/null || true); atomic_temp_inode=$(stat -c '%d:%i' -- "$temp" 2>/dev/null || true); fi
  if [ "$create_rc" -ne 0 ]; then if [ -e "$temp" ] || [ -L "$temp" ]; then uncertain=1; fi; return 1; fi
  [ -n "$atomic_temp_id" ] && [ -n "$atomic_temp_inode" ] || { uncertain=1; return 1; }
  printf '%s' "$data" | base64 -d > "$temp" || return 1
  chown "$owner:$group" "$temp" || return 1
  atomic_temp_id=$(stat -c '%d:%i:%U:%G:%a' -- "$temp" 2>/dev/null) || return 1
  chmod "$mode" "$temp" || return 1
  atomic_temp_id=$(stat -c '%d:%i:%U:%G:%a' -- "$temp" 2>/dev/null) || return 1
  mv -nT -- "$temp" "$path"; move_rc=$?
  if [ ! -e "$temp" ] && [ ! -L "$temp" ] && [ -f "$path" ] && [ ! -L "$path" ] && [ "$(stat -c '%d:%i' -- "$path" 2>/dev/null || true)" = "$atomic_temp_inode" ]; then
    case "$path" in
      /etc/opspilot/caddy/Caddyfile) created_config=1; config_id=$(stat -c '%d:%i:%U:%G:%a' -- "$path" 2>/dev/null || true) ;;
      /etc/systemd/system/opspilot-caddy.service) created_unit=1; unit_id=$(stat -c '%d:%i:%U:%G:%a' -- "$path" 2>/dev/null || true) ;;
      /etc/opspilot/caddy/OWNER) created_owner=1; owner_id=$(stat -c '%d:%i:%U:%G:%a' -- "$path" 2>/dev/null || true) ;;
      /etc/opspilot/caddy/INSTALLATION) created_manifest=1; manifest_id=$(stat -c '%d:%i:%U:%G:%a' -- "$path" 2>/dev/null || true) ;;
      *) return 1 ;;
    esac
    moved_owned=1
  fi
  [ "$move_rc" -eq 0 ] && [ "$moved_owned" -eq 1 ]
}
write_atomic '${Buffer.from(buildSharedIngressConfig([])).toString('base64')}' /etc/opspilot/caddy/Caddyfile root opspilot-caddy 0640 || fail INSTALL_FAILED
write_atomic '${Buffer.from(EXPECTED_OPSPILOT_UNIT).toString('base64')}' /etc/systemd/system/opspilot-caddy.service root root 0644 || fail INSTALL_FAILED
write_atomic '${Buffer.from(OWNER_MARKER).toString('base64')}' /etc/opspilot/caddy/OWNER root root 0644 || fail INSTALL_FAILED
manifest=$(printf 'format=opspilot-caddy-installation-v1\\nversion=%s\\narchitecture=%s\\nrepository_channel=stable\\npackage_sha256=%s\\nbinary_sha256=%s\\n' "$version" "$architecture" "$package_sha" "$binary_sha" | base64 | tr -d '\\n')
write_atomic "$manifest" /etc/opspilot/caddy/INSTALLATION root root 0644 || fail INSTALL_FAILED
step=verify
systemctl daemon-reload >/dev/null 2>&1 || fail INSTALL_VERIFY_FAILED
listeners=$(ss -H -ltnp 'sport = :80 or sport = :443' 2>/dev/null) || fail INSTALL_VERIFY_FAILED; [ -z "$listeners" ] || fail INSTALL_VERIFY_FAILED
ownership=$(sh -c ${shellQuote(CADDY_OWNERSHIP_CHECK_SCRIPT)}) || fail INSTALL_VERIFY_FAILED
[ "$ownership" = OWNERSHIP=verified_inactive ] || fail INSTALL_VERIFY_FAILED
[ "$(sha256sum /etc/opspilot/caddy/Caddyfile | awk '{print $1}')" = '${sha256(buildSharedIngressConfig([]))}' ] || fail INSTALL_VERIFY_FAILED
cleanup_stage || fail INSTALL_VERIFY_FAILED
committed=1; emit RESULT=installed_not_running; emit "BINARY_SHA256=$binary_sha"; exit 0
`

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
