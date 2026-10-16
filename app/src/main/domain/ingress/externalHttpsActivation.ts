import { isIP } from 'node:net'
import type { SharedIngressReadinessResult } from '@shared/ipc'

import type { SshHostIdentity, SshManager } from '../../ssh/manager'
import { shellQuote } from '../../ssh/shellQuote'
import type { DomainRepository, SharedIngressInventorySnapshot } from '../repository'
import { checkSharedIngressReadiness } from './dnsReadiness'
import {
  verifyCaddyInstallationOwnershipOverSsh,
  withVpsIngressMutex
} from './caddyInstallTransaction'
import { preflightSharedIngress } from './preflight'
import {
  probeExternalHttps,
  sameIpAddress,
  type ExternalHttpsProbeFailure,
  type ExternalHttpsProbeResult
} from './externalHttpsProbe'

const RUNTIME_READ_TIMEOUT_MS = 15_000
const RUNTIME_STATE_SCRIPT = `set -eu
state=/etc/opspilot/caddy/RECONCILE_STATE
config=/etc/opspilot/caddy/Caddyfile
[ -f "$state" ] && [ ! -L "$state" ]
[ -f "$config" ] && [ ! -L "$config" ]
[ "$(wc -l < "$state")" -eq 12 ]
generation=$(sed -n '2s/^generation=//p' "$state")
config_sha=$(sed -n '3s/^config_sha256=//p' "$state")
environment=$(sed -n '4s/^environment=//p' "$state")
[ "$environment" = production ]
case "$generation:$config_sha" in *[!a-f0-9:]*) exit 1 ;; esac
[ "$(sha256sum -- "$config" | awk '{print $1}')" = "$config_sha" ]
[ "$(sed -n '1s/^# opspilot-generation=//p' "$config")" = "$generation" ]
[ "$(systemctl is-active opspilot-caddy.service 2>/dev/null || true)" = active ]
adapted=$(/usr/bin/caddy adapt --config "$config" --adapter caddyfile --pretty=false 2>/dev/null)
loaded=$(curl --fail --silent --show-error --max-time 3 --max-filesize 131072 http://127.0.0.1:2019/config/ 2>/dev/null)
python3 -c 'import json,sys; sys.exit(0 if json.loads(sys.argv[1]) == json.loads(sys.argv[2]) else 1)' "$adapted" "$loaded"
printf 'GENERATION=%s\\nCONFIG_SHA256=%s\\n' "$generation" "$config_sha"
`

export type HttpsActivationFailure =
  | 'binding_not_found'
  | 'staging_not_eligible'
  | 'dns_not_propagated'
  | 'runtime_not_verified'
  | 'host_identity_changed'
  | 'remote_generation_changed'
  | 'probe_failed'
  | 'stale_result'
  | 'activation_write_failed'

export type HttpsActivationResult =
  | { status: 'active'; hostname: string; generation: string; peer_ip: string }
  | {
      status: 'pending' | 'degraded'
      reason: HttpsActivationFailure
      probe_reason?: ExternalHttpsProbeFailure
    }

export interface HttpsActivationAdapters {
  dns?: (hostname: string, vpsHost: string) => Promise<SharedIngressReadinessResult>
  probe?: (input: Parameters<typeof probeExternalHttps>[0]) => Promise<ExternalHttpsProbeResult>
  identity?: (ssh: SshManager, vpsId: number) => Promise<SshHostIdentity>
  runtime?: (ssh: SshManager, target: SshHostIdentity) => Promise<RemoteIngressRuntime | null>
  ownership?: typeof verifyCaddyInstallationOwnershipOverSsh
  now?: () => string
}

interface RemoteIngressRuntime {
  generation: string
  configSha256: string
  environment: 'production' | 'acme_staging'
}

/** Probes one DB-owned route, then rechecks DNS, DB inventory, pinned SSH identity and remote generation before CAS. */
export async function probeAndActivateSharedIngress(
  ssh: SshManager,
  repository: DomainRepository,
  target: SshHostIdentity,
  hostname: string,
  adapters: HttpsActivationAdapters = {}
): Promise<HttpsActivationResult> {
  return withVpsIngressMutex(target.vpsId, () =>
    activateUnderMutex(ssh, repository, target, hostname, adapters)
  )
}

async function activateUnderMutex(
  ssh: SshManager,
  repository: DomainRepository,
  target: SshHostIdentity,
  hostname: string,
  adapters: HttpsActivationAdapters
): Promise<HttpsActivationResult> {
  let snapshot: SharedIngressInventorySnapshot
  try {
    snapshot = repository.getSharedIngressInventory(target.vpsId)
  } catch {
    return pending('stale_result')
  }
  if (!sameTarget(target, snapshot)) return pending('host_identity_changed')
  const binding = snapshot.bindings.find((item) => item.hostname === hostname && item.enabled)
  if (!binding || !binding.healthcheck_path) return pending('binding_not_found')
  const observed = repository.getSharedIngressReconcileObservation(target.vpsId)
  if (!observed || observed.inventory_revision !== snapshot.revision) return pending('stale_result')
  if (observed.environment !== 'production') return pending('staging_not_eligible')

  const readIdentity = adapters.identity ?? ((manager, id) => manager.getHostIdentity(id))
  const dnsCheck = adapters.dns ?? defaultDnsCheck(ssh, target.vpsId)
  const runtimeCheck = adapters.runtime ?? readRemoteIngressRuntime
  const ownershipCheck = adapters.ownership ?? verifyCaddyInstallationOwnershipOverSsh
  const probe = adapters.probe ?? probeExternalHttps

  const identityBefore = await safeIdentity(readIdentity, ssh, target.vpsId)
  if (!identityBefore || !sameIdentity(target, identityBefore))
    return pending('host_identity_changed')
  const runtimeBefore = await safeRuntime(runtimeCheck, ssh, target)
  if (!runtimeMatches(runtimeBefore, observed.generation, observed.config_sha256))
    return recordPrecheckFailure(repository, snapshot, binding, observed, 'INGRESS_CONFIG_INVALID', 'remote_generation_changed', adapters)
  const ownershipBefore = await ownershipCheck(ssh, target)
  if (ownershipBefore.status !== 'verified' || ownershipBefore.active !== true)
    return recordPrecheckFailure(repository, snapshot, binding, observed, 'INGRESS_CONFIG_INVALID', 'runtime_not_verified', adapters)
  const dnsBefore = await safeDns(dnsCheck, binding.hostname, snapshot.host)
  if (!dnsMatches(dnsBefore, binding.hostname))
    return recordPrecheckFailure(repository, snapshot, binding, observed, 'DNS_NOT_PROPAGATED', 'dns_not_propagated', adapters)

  const expectedPeerIps = [...new Set([...dnsBefore.expected_ipv4, ...dnsBefore.expected_ipv6])]
  const probeResult = await probe({
    hostname: binding.hostname,
    healthcheckPath: binding.healthcheck_path,
    healthcheckResponseType: binding.healthcheck_response_type ?? 'status_2xx',
    dnsStatus: 'propagated',
    expectedPeerIps
  })
  if (probeResult.status !== 'passed' || probeResult.trust !== 'system') {
    if (probeResult.status === 'passed') return pending('staging_not_eligible')
  }

  const dnsAfter = await safeDns(dnsCheck, binding.hostname, snapshot.host)
  if (
    !dnsMatches(dnsAfter, binding.hostname) ||
    !sameIpSet(expectedPeerIps, [...dnsAfter.expected_ipv4, ...dnsAfter.expected_ipv6]) ||
    (probeResult.status === 'passed' &&
      !sameIpSet([...dnsAfter.expected_ipv4, ...dnsAfter.expected_ipv6], probeResult.peer_ips))
  ) {
    return recordPrecheckFailure(repository, snapshot, binding, observed, 'DNS_NOT_PROPAGATED', 'dns_not_propagated', adapters)
  }
  const identityAfter = await safeIdentity(readIdentity, ssh, target.vpsId)
  if (!identityAfter || !sameIdentity(target, identityAfter))
    return pending('host_identity_changed')
  const ownershipAfter = await ownershipCheck(ssh, target)
  if (ownershipAfter.status !== 'verified' || ownershipAfter.active !== true)
    return recordPrecheckFailure(repository, snapshot, binding, observed, 'INGRESS_CONFIG_INVALID', 'remote_generation_changed', adapters)
  const runtimeAfter = await safeRuntime(runtimeCheck, ssh, target)
  if (!runtimeMatches(runtimeAfter, observed.generation, observed.config_sha256))
    return recordPrecheckFailure(repository, snapshot, binding, observed, 'INGRESS_CONFIG_INVALID', 'remote_generation_changed', adapters)

  if (probeResult.status === 'failed') {
    try {
      const certificateStatus =
        probeResult.reason === 'certificate_expired'
          ? 'expired'
          : ['certificate_hostname_invalid', 'certificate_untrusted'].includes(probeResult.reason)
            ? 'failed'
            : undefined
      repository.recordProductionHttpsProbeFailure({
        snapshot,
        binding,
        generation: observed.generation,
        configSha256: observed.config_sha256,
        checkedAt: (adapters.now ?? (() => new Date().toISOString()))(),
        reasonCode:
          probeResult.reason === 'health_response_invalid'
            ? 'UPSTREAM_UNHEALTHY'
            : 'HTTPS_PROBE_FAILED',
        ...(certificateStatus ? { certificateStatus } : {})
      })
    } catch {
      return pending('stale_result')
    }
    return degraded('probe_failed', probeResult.reason)
  }

  try {
    repository.recordProductionHttpsActivation({
      snapshot,
      binding,
      generation: observed.generation,
      configSha256: observed.config_sha256,
      peerIp: probeResult.peer_ip,
      peerIps: [...probeResult.peer_ips],
      httpStatus: probeResult.http_status,
      checkedAt: (adapters.now ?? (() => new Date().toISOString()))()
    })
    return {
      status: 'active',
      hostname,
      generation: observed.generation,
      peer_ip: probeResult.peer_ip
    }
  } catch {
    return pending('stale_result')
  }
}

function defaultDnsCheck(
  ssh: SshManager,
  vpsId: number
): NonNullable<HttpsActivationAdapters['dns']> {
  return async (hostname, vpsHost) => {
    const ingress = await preflightSharedIngress(ssh, vpsId)
    return checkSharedIngressReadiness({ hostname, vpsHost, ingress })
  }
}

async function readRemoteIngressRuntime(
  ssh: SshManager,
  target: SshHostIdentity
): Promise<RemoteIngressRuntime | null> {
  try {
    const result = await ssh.execWithHostIdentity(
      target.vpsId,
      `sudo -n sh -c ${shellQuote(RUNTIME_STATE_SCRIPT)}`,
      {
        timeoutMs: RUNTIME_READ_TIMEOUT_MS,
        maxStdoutBytes: 512,
        maxStderrBytes: 256,
        logCommand: false,
        retryOnReconnect: false
      },
      target
    )
    if (!sameIdentity(target, result.identity) || result.result.code !== 0) return null
    const lines = result.result.stdout.trim().split(/\r?\n/)
    if (lines.length !== 2) return null
    const generation = lines[0].match(/^GENERATION=([a-f0-9]{64})$/)?.[1]
    const configSha256 = lines[1].match(/^CONFIG_SHA256=([a-f0-9]{64})$/)?.[1]
    if (!generation || !configSha256) return null
    return { generation, configSha256, environment: 'production' }
  } catch {
    return null
  }
}

async function safeRuntime(
  check: NonNullable<HttpsActivationAdapters['runtime']>,
  ssh: SshManager,
  target: SshHostIdentity
): Promise<RemoteIngressRuntime | null> {
  try {
    return await check(ssh, target)
  } catch {
    return null
  }
}

async function safeIdentity(
  check: NonNullable<HttpsActivationAdapters['identity']>,
  ssh: SshManager,
  vpsId: number
): Promise<SshHostIdentity | null> {
  try {
    return await check(ssh, vpsId)
  } catch {
    return null
  }
}

async function safeDns(
  check: NonNullable<HttpsActivationAdapters['dns']>,
  hostname: string,
  vpsHost: string
): Promise<SharedIngressReadinessResult | null> {
  try {
    return await check(hostname, vpsHost)
  } catch {
    return null
  }
}

function dnsMatches(
  value: SharedIngressReadinessResult | null,
  hostname: string
): value is SharedIngressReadinessResult {
  return Boolean(
    value &&
    value.hostname === hostname &&
    value.dns_status === 'propagated' &&
    value.expected_ipv4.length > 0 &&
    [...value.expected_ipv4, ...value.expected_ipv6].every((ip) => requireIp(ip))
  )
}

function runtimeMatches(
  value: RemoteIngressRuntime | null,
  generation: string,
  configSha: string
): boolean {
  return Boolean(
    value &&
    value.environment === 'production' &&
    value.generation === generation &&
    value.configSha256 === configSha
  )
}

function sameTarget(target: SshHostIdentity, snapshot: SharedIngressInventorySnapshot): boolean {
  return (
    target.vpsId === snapshot.vps_id &&
    target.host === snapshot.host &&
    target.port === snapshot.port &&
    target.hostFingerprint === snapshot.host_fingerprint
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

function requireIp(value: string): boolean {
  return isIP(value) !== 0
}

function sameIpSet(left: readonly string[], right: readonly string[]): boolean {
  const uniqueLeft = left.filter((ip, index) => !left.slice(0, index).some((prior) => sameIpAddress(prior, ip)))
  const uniqueRight = right.filter((ip, index) => !right.slice(0, index).some((prior) => sameIpAddress(prior, ip)))
  return uniqueLeft.length === uniqueRight.length && uniqueLeft.every((ip) => uniqueRight.some((other) => sameIpAddress(ip, other)))
}

function recordPrecheckFailure(
  repository: DomainRepository,
  snapshot: SharedIngressInventorySnapshot,
  binding: SharedIngressInventorySnapshot['bindings'][number],
  observed: NonNullable<ReturnType<DomainRepository['getSharedIngressReconcileObservation']>>,
  reasonCode: 'DNS_NOT_PROPAGATED' | 'INGRESS_CONFIG_INVALID',
  resultReason: 'dns_not_propagated' | 'runtime_not_verified' | 'remote_generation_changed',
  adapters: HttpsActivationAdapters
): HttpsActivationResult {
  try {
    const invalidated = repository.recordProductionHttpsPrecheckFailure({
      snapshot,
      binding,
      generation: observed.generation,
      configSha256: observed.config_sha256,
      checkedAt: (adapters.now ?? (() => new Date().toISOString()))(),
      reasonCode
    })
    return invalidated ? degraded(resultReason) : pending(resultReason)
  } catch {
    return pending('stale_result')
  }
}
function pending(reason: HttpsActivationFailure): HttpsActivationResult {
  return { status: 'pending', reason }
}
function degraded(
  reason: HttpsActivationFailure,
  probe_reason?: ExternalHttpsProbeFailure
): HttpsActivationResult {
  return { status: 'degraded', reason, ...(probe_reason ? { probe_reason } : {}) }
}
