import { describe, expect, it, vi } from 'vitest'

import type { SshHostIdentity } from '../../ssh/manager'
import type { DomainRepository, SharedIngressInventorySnapshot } from '../repository'
import {
  probeAndActivateSharedIngress,
  type HttpsActivationAdapters
} from './externalHttpsActivation'
import type { ExternalHttpsProbeResult } from './externalHttpsProbe'
import type { SharedIngressReadinessResult } from '@shared/ipc'

const identity: SshHostIdentity = {
  vpsId: 8,
  host: '198.51.100.8',
  port: 22,
  hostFingerprint: 'SHA256:PINNED'
}
const snapshot: SharedIngressInventorySnapshot = {
  vps_id: 8,
  host: identity.host,
  port: 22,
  host_fingerprint: identity.hostFingerprint,
  revision: 'a'.repeat(64),
  bindings: [
    {
      id: 2,
      app_id: 3,
      hostname: 'app.example.test',
      ownership_key: 'dns:3',
      route_ownership_key: 'route:3',
      desired_generation: 4,
      dns_status: 'propagated',
      enabled: true,
      host_port: 3003,
      healthcheck_path: '/health',
      healthcheck_response_type: 'json',
      current_deployment_id: 10,
      deployment_version: 2,
      image_tag: 'sha256:image'
    }
  ]
}
const observation = {
  vps_id: 8,
  inventory_revision: snapshot.revision,
  environment: 'production' as const,
  generation: 'b'.repeat(64),
  config_sha256: 'c'.repeat(64)
}
const dns: SharedIngressReadinessResult = {
  hostname: 'app.example.test',
  dns_status: 'propagated',
  dns_reason_code: null,
  resolvers: ['1.1.1.1', '8.8.8.8'],
  expected_ipv4: ['203.0.113.8'],
  expected_ipv6: [],
  observed_a: ['203.0.113.8'],
  observed_aaaa: [],
  cname_chain: [],
  ipv6_status: 'not_advertised',
  cloudflare_proxy_hint: 'unknown',
  ingress: {
    ports_status: 'occupied',
    install_assessment: 'unknown',
    local_assessment: 'clear',
    reason_code: null,
    ufw: {
      state: 'inactive',
      inbound_80: 'not_applicable',
      inbound_443: 'not_applicable',
      inbound_80_ipv4: 'not_applicable',
      inbound_80_ipv6: 'not_applicable',
      inbound_443_ipv4: 'not_applicable',
      inbound_443_ipv6: 'not_applicable'
    }
  },
  cloud_firewall_status: 'unknown',
  acme_http_01: 'unknown',
  acme_tls_alpn: 'unknown',
  certificate_status: 'not_requested',
  route_status: 'not_configured',
  https_probe_status: 'not_run',
  overall_status: 'unknown',
  instructions: []
}

function setup(
  overrides: {
    env?: 'production' | 'acme_staging'
    probe?: HttpsActivationAdapters['probe']
    dns?: HttpsActivationAdapters['dns']
    runtime?: HttpsActivationAdapters['runtime']
    identity?: HttpsActivationAdapters['identity']
    cas?: () => void
  } = {}
): {
  repository: DomainRepository
  ssh: never
  adapters: HttpsActivationAdapters
  record: ReturnType<typeof vi.fn>
  recordFailure: ReturnType<typeof vi.fn>
  recordPrecheckFailure: ReturnType<typeof vi.fn>
} {
  const record = vi.fn(overrides.cas ?? (() => undefined))
  const recordFailure = vi.fn(() => undefined)
  const recordPrecheckFailure = vi.fn(() => true)
  const repository = {
    getSharedIngressInventory: vi.fn(() => snapshot),
    getSharedIngressReconcileObservation: vi.fn(() => ({
      ...observation,
      environment: overrides.env ?? 'production'
    })),
    recordProductionHttpsActivation: record,
      recordProductionHttpsProbeFailure: recordFailure,
      recordProductionHttpsPrecheckFailure: recordPrecheckFailure
  } as unknown as DomainRepository
  const ssh = {} as never
  const runtime =
    overrides.runtime ??
    vi.fn(async () => ({
      generation: observation.generation,
      configSha256: observation.config_sha256,
      environment: 'production' as const
    }))
  const adapters: HttpsActivationAdapters = {
    identity: overrides.identity ?? vi.fn(async () => identity),
    dns: overrides.dns ?? vi.fn(async () => dns),
    runtime,
    ownership: vi.fn(async () => ({ status: 'verified', active: true }) as const),
    probe:
      overrides.probe ??
      vi.fn(
        async () =>
          ({
            status: 'passed',
            hostname: 'app.example.test',
            peer_ip: '203.0.113.8',
            peer_ips: ['203.0.113.8'],
            http_status: 200,
            trust: 'system'
          }) as const
      ),
    now: () => '2026-10-16T00:00:00.000Z'
  }
  return { repository, ssh, adapters, record, recordFailure, recordPrecheckFailure }
}

describe('probeAndActivateSharedIngress', () => {
  it('activates after production probe and post-probe DNS, SSH identity and runtime generation checks', async () => {
    const state = setup()
    const result = await probeAndActivateSharedIngress(
      state.ssh,
      state.repository,
      identity,
      'app.example.test',
      state.adapters
    )
    expect(result).toEqual({
      status: 'active',
      hostname: 'app.example.test',
      generation: observation.generation,
      peer_ip: '203.0.113.8'
    })
    expect(state.adapters.dns).toHaveBeenCalledTimes(2)
    expect(state.adapters.identity).toHaveBeenCalledTimes(2)
    expect(state.record).toHaveBeenCalledOnce()
    expect(state.record).toHaveBeenCalledWith(
      expect.objectContaining({
        generation: observation.generation,
        configSha256: observation.config_sha256,
        peerIp: '203.0.113.8',
        peerIps: ['203.0.113.8'],
        httpStatus: 200
      })
    )
  })

  it('never activates staging/lab evidence', async () => {
    const state = setup({ env: 'acme_staging' })
    expect(
      await probeAndActivateSharedIngress(
        state.ssh,
        state.repository,
        identity,
        'app.example.test',
        state.adapters
      )
    ).toEqual({ status: 'pending', reason: 'staging_not_eligible' })
    expect(state.adapters.probe).not.toHaveBeenCalled()
    expect(state.record).not.toHaveBeenCalled()
  })

  it('reports probe errors and never records invalid TLS/health evidence', async () => {
    for (const reason of [
      'certificate_hostname_invalid',
      'certificate_expired',
      'certificate_untrusted',
      'timeout',
      'health_response_invalid',
      'redirect_rejected'
    ] as const) {
      const state = setup({
        probe: vi.fn(async (): Promise<ExternalHttpsProbeResult> => ({ status: 'failed', reason }))
      })
      expect(
        await probeAndActivateSharedIngress(
          state.ssh,
          state.repository,
          identity,
          'app.example.test',
          state.adapters
        )
      ).toEqual({ status: 'degraded', reason: 'probe_failed', probe_reason: reason })
      expect(state.record).not.toHaveBeenCalled()
      expect(state.recordFailure).toHaveBeenCalledOnce()
    }
  })

  it('rejects a wrong peer IP even when the TLS probe returned success', async () => {
    const state = setup({
      probe: vi.fn(async (): Promise<ExternalHttpsProbeResult> => ({
        status: 'passed',
        hostname: 'app.example.test',
        peer_ip: '203.0.113.99',
        peer_ips: ['203.0.113.99'],
        http_status: 200,
        trust: 'system'
      }))
    })
    expect(
      await probeAndActivateSharedIngress(
        state.ssh,
        state.repository,
        identity,
        'app.example.test',
        state.adapters
      )
    ).toEqual({ status: 'degraded', reason: 'dns_not_propagated' })
    expect(state.record).not.toHaveBeenCalled()
  })

  it('rejects a generation changed during the probe and lets repository CAS reject a DB change', async () => {
    let calls = 0
    const remoteChange = setup({
      runtime: vi.fn(async () => ({
        generation: ++calls === 1 ? observation.generation : 'd'.repeat(64),
        configSha256: observation.config_sha256,
        environment: 'production' as const
      }))
    })
    expect(
      await probeAndActivateSharedIngress(
        remoteChange.ssh,
        remoteChange.repository,
        identity,
        'app.example.test',
        remoteChange.adapters
      )
    ).toEqual({ status: 'degraded', reason: 'remote_generation_changed' })
    expect(remoteChange.record).not.toHaveBeenCalled()
    expect(remoteChange.recordPrecheckFailure).toHaveBeenCalledWith(expect.objectContaining({
      reasonCode: 'INGRESS_CONFIG_INVALID'
    }))

    const dbChange = setup({
      cas: () => {
        throw new Error('CAS_CONFLICT')
      }
    })
    expect(
      await probeAndActivateSharedIngress(
        dbChange.ssh,
        dbChange.repository,
        identity,
        'app.example.test',
        dbChange.adapters
      )
    ).toEqual({ status: 'pending', reason: 'stale_result' })
  })

  it('rejects a host identity change after probing', async () => {
    let calls = 0
    const state = setup({
      identity: vi.fn(async () =>
        ++calls === 1 ? identity : { ...identity, hostFingerprint: 'SHA256:OTHER' }
      )
    })
    expect(
      await probeAndActivateSharedIngress(
        state.ssh,
        state.repository,
        identity,
        'app.example.test',
        state.adapters
      )
    ).toEqual({ status: 'pending', reason: 'host_identity_changed' })
    expect(state.record).not.toHaveBeenCalled()
  })

  it('records a precheck CAS invalidation when DNS or runtime no longer match', async () => {
    const dnsMismatch = setup({
      dns: vi.fn(async () => ({ ...dns, dns_status: 'target_mismatch' as const }))
    })
    expect(await probeAndActivateSharedIngress(
      dnsMismatch.ssh, dnsMismatch.repository, identity, 'app.example.test', dnsMismatch.adapters
    )).toEqual({ status: 'degraded', reason: 'dns_not_propagated' })
    expect(dnsMismatch.recordPrecheckFailure).toHaveBeenCalledWith(expect.objectContaining({
      reasonCode: 'DNS_NOT_PROPAGATED', generation: observation.generation
    }))
    expect(dnsMismatch.adapters.probe).not.toHaveBeenCalled()

    const runtimeMismatch = setup({ runtime: vi.fn(async () => null) })
    expect(await probeAndActivateSharedIngress(
      runtimeMismatch.ssh, runtimeMismatch.repository, identity, 'app.example.test', runtimeMismatch.adapters
    )).toEqual({ status: 'degraded', reason: 'remote_generation_changed' })
    expect(runtimeMismatch.recordPrecheckFailure).toHaveBeenCalledWith(expect.objectContaining({
      reasonCode: 'INGRESS_CONFIG_INVALID', generation: observation.generation
    }))
    expect(runtimeMismatch.adapters.probe).not.toHaveBeenCalled()
  })
})
