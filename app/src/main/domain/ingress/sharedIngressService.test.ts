import { describe, expect, it, vi } from 'vitest'

import type { App, Deployment, DomainIngressState, Vps } from '@shared/ipc'

import type { AppRepository } from '../../db/appRepository'
import type { DeploymentRepository } from '../../db/deploymentRepository'
import type { VpsRepository } from '../../db/vpsRepository'
import type { SshHostIdentity, SshManager } from '../../ssh/manager'
import type { DomainRepository, SharedIngressInventorySnapshot } from '../repository'
import type { IngressPreflightResult } from './preflight'
import type { CaddyInstallPlan } from './caddyInstallPlan'
import type { CaddyInstallTransactionResult } from './caddyInstallTransaction'
import { withVpsIngressMutex } from './caddyInstallTransaction'
import type { CaddyReconcileResult } from './caddyReconcile'
import type { HttpsActivationResult } from './externalHttpsActivation'
import { SharedIngressService } from './sharedIngressService'

interface ServiceFixture {
  service: SharedIngressService
  identity: SshHostIdentity
  snapshot: SharedIngressInventorySnapshot
  bindings: SharedIngressInventorySnapshot['bindings']
  states: Map<string, DomainIngressState>
  apps: Map<number, App>
  deployments: Map<number, Deployment>
  domainRepository: {
    getSharedIngressInventory: ReturnType<typeof vi.fn>
    getByHostname: ReturnType<typeof vi.fn>
  }
  ssh: SshManager
  preflight: IngressPreflightResult
  setPreflight(value: IngressPreflightResult): void
  install: ReturnType<typeof vi.fn>
  setRevision(value: number): void
}

const identity: SshHostIdentity = {
  vpsId: 7,
  host: '198.51.100.10',
  port: 2222,
  hostFingerprint: 'SHA256:pinned'
}

function makeFixture(): ServiceFixture {
  const vps: Vps = {
    id: 7,
    name: 'lab',
    host: identity.host,
    port: identity.port,
    host_fingerprint: identity.hostFingerprint,
    username: 'ops',
    auth_type: 'key',
    provider: null,
    region: null,
    docker_version: '26',
    last_status: 'online',
    last_seen_at: null,
    created_at: '2026-01-01'
  }
  const bindings = [1, 2].map((id) => ({
    id,
    app_id: id,
    hostname: `app${id}.lab.example`,
    ownership_key: `dns:${id}`,
    route_ownership_key: `opspilot-ingress:${id}:app${id}.lab.example`,
    desired_generation: 2,
    dns_status: 'propagated' as const,
    enabled: true,
    host_port: 3100 + id,
    healthcheck_path: '/',
    healthcheck_response_type: 'status_2xx' as const,
    current_deployment_id: 10 + id,
    deployment_version: 3,
    image_tag: `app${id}:v3`
  }))
  const snapshot: SharedIngressInventorySnapshot = {
    vps_id: 7,
    host: identity.host,
    port: identity.port,
    host_fingerprint: identity.hostFingerprint,
    revision: 'revision-1',
    bindings
  }
  const apps = new Map<number, App>(
    bindings.map((binding) => [
      binding.app_id,
      {
        id: binding.app_id,
        vps_id: 7,
        name: `app${binding.app_id}`,
        framework: 'express',
        source_type: 'local',
        source_path: 'C:\\apps\\app',
        host_port: binding.host_port!,
        container_port: 3000,
        healthcheck_path: '/',
        healthcheck_response_type: 'status_2xx',
        needs_db: 0,
        current_deployment_id: binding.current_deployment_id,
        imported_from_vps: 0,
        url: `http://${identity.host}:${binding.host_port}`
      }
    ])
  )
  const deployments = new Map<number, Deployment>(
    bindings.map((binding) => [
      binding.current_deployment_id!,
      {
        id: binding.current_deployment_id!,
        app_id: binding.app_id,
        version: 3,
        image_tag: binding.image_tag!,
        origin: 'opspilot',
        status: 'running',
        failed_step: null,
        build_duration_ms: null,
        total_duration_ms: null,
        is_rollback_of: null,
        started_at: null,
        finished_at: null,
        exposure_status: 'not_checked',
        exposure_evidence_json: null
      }
    ])
  )
  const states = new Map<string, DomainIngressState>(
    bindings.map((binding) => [
      binding.hostname,
      {
        id: binding.id,
        app_id: binding.app_id,
        hostname: binding.hostname,
        mode: 'shared_ingress',
        dns_status: 'propagated',
        route_status: 'pending',
        certificate_status: 'not_requested',
        https_probe_status: 'not_run',
        desired_generation: binding.desired_generation,
        observed_generation: 0,
        ownership_key: binding.ownership_key,
        route_ownership_key: binding.route_ownership_key,
        ingress_reason_code: null,
        last_check_at: null,
        route_checked_at: null,
        certificate_checked_at: null,
        certificate_hostname: null,
        https_probe_checked_at: null,
        https_probe_hostname: null,
        route_config_generation: null,
        route_inventory_revision: null,
        route_environment: null,
        https_probe_peer_ip: null,
        https_probe_peer_ips_json: null,
        https_probe_http_status: null,
        https_probe_generation: null,
        https_probe_inventory_revision: null,
        https_probe_environment: null
      }
    ])
  )
  let revision = 1
  const domainRepository = {
    getSharedIngressInventory: vi.fn(() => ({
      ...snapshot,
      revision: `revision-${revision}`,
      bindings: [...snapshot.bindings]
    })),
    getSharedIngressBindingById: vi.fn((vpsId: number, bindingId: number) =>
      vpsId === 7 ? [...states.values()].find((state) => state.id === bindingId) : undefined
    ),
    getByHostname: vi.fn((hostname: string) => states.get(hostname) ?? null)
  }
  const ssh = { getHostIdentity: vi.fn(async () => identity) } as unknown as SshManager
  const preflight: IngressPreflightResult = {
    ownership: 'ports_free',
    ports_status: 'free',
    install_assessment: 'safe',
    local_assessment: 'clear',
    reason_code: null,
    listeners: [],
    service: 'absent',
    service_state: 'unknown',
    caddy_version: null,
    ownership_marker: 'missing',
    config_exists: false,
    config_readable: false,
    ufw: {
      state: 'inactive',
      inbound_80: 'not_applicable',
      inbound_443: 'not_applicable',
      inbound_80_ipv4: 'not_applicable',
      inbound_80_ipv6: 'not_applicable',
      inbound_443_ipv4: 'not_applicable',
      inbound_443_ipv6: 'not_applicable'
    },
    route_activation: 'not_evaluated'
  }
  let preflightResult = preflight
  const install = vi.fn(async (): Promise<CaddyInstallTransactionResult> => ({
    status: 'installed_not_running',
    version: '2.11.7',
    binarySha256: 'a'.repeat(64)
  }))
  const plan = { target: { vpsId: 7 } } as CaddyInstallPlan
  const policy = {
    certificateEnvironment: 'production' as const,
    stagingLabHostnames: [] as string[]
  }
  const service = new SharedIngressService({
    vpsRepository: {
      getById: vi.fn((id: number) => {
        if (id !== vps.id) throw new Error('not found')
        return vps
      })
    } as unknown as VpsRepository,
    appRepository: { getById: vi.fn((id: number) => apps.get(id)!) } as unknown as AppRepository,
    deploymentRepository: {
      getById: vi.fn((id: number) => deployments.get(id)!)
    } as unknown as DeploymentRepository,
    domainRepository: domainRepository as unknown as DomainRepository,
    ssh,
    policy,
    testAdapters: {
      identity: vi.fn(async () => identity),
      preflight: vi.fn(async () => preflightResult),
      verifyOwnership: vi.fn(async () => ({ status: 'verified' as const, active: true })),
      preparePlan: vi.fn(async () => ({ status: 'ready' as const, plan })),
      install,
      reconcile: vi.fn(async () =>
        withVpsIngressMutex(
          7,
          async () =>
            ({
              status: 'reconciled_pending',
              generation: 'g1',
              route_count: 2
            }) as CaddyReconcileResult
        )
      ),
      activate: vi.fn(async (_ssh, _repository, _target, hostname) => {
        const state = states.get(hostname)!
        state.route_status = 'active'
        state.certificate_status = 'valid'
        state.https_probe_status = 'passed'
        return {
          status: 'active',
          hostname,
          generation: 'g1',
          peer_ip: identity.host
        } as HttpsActivationResult
      })
    }
  })
  return {
    service,
    identity,
    snapshot,
    bindings,
    states,
    apps,
    deployments,
    domainRepository,
    ssh,
    preflight,
    setPreflight(value: IngressPreflightResult) {
      preflightResult = value
    },
    install,
    setRevision(value: number) {
      revision = value
    }
  }
}

describe('SharedIngressService', () => {
  it('reads persisted state without network access and keeps the existing HTTP URL', async () => {
    const f = makeFixture()
    f.states.get('app1.lab.example')!.dns_status = 'pending'
    f.states.get('app1.lab.example')!.route_status = 'not_configured'
    expect(await f.service.readStatus(7, 1)).toMatchObject({
      operation: 'read',
      status: 'pending',
      http_url: `http://${identity.host}:3101`
    })
    expect(f.ssh.getHostIdentity).not.toHaveBeenCalled()
  })

  it('allows local status reads without a pinned fingerprint but blocks SSH actions', async () => {
    const f = makeFixture()
    f.snapshot.host_fingerprint = null
    const repository = f.service as unknown as {
      dependencies: { vpsRepository: { getById: () => Vps } }
    }
    repository.dependencies.vpsRepository.getById = () => ({
      id: 7,
      name: 'lab',
      host: identity.host,
      port: identity.port,
      host_fingerprint: null,
      username: 'ops',
      auth_type: 'key',
      provider: null,
      region: null,
      docker_version: '26',
      last_status: 'online',
      last_seen_at: null,
      created_at: '2026-01-01'
    })
    expect(await f.service.readStatus(7, 1)).toMatchObject({
      status: 'pending',
      http_url: `http://${identity.host}:3101`
    })
    expect(await f.service.reconcile(7, 1)).toMatchObject({
      status: 'blocked',
      reason: { code: 'SSH_IDENTITY_UNVERIFIED' }
    })
  })

  it('installs only on a verified clean host and does not expose the plan', async () => {
    const f = makeFixture()
    const result = await f.service.prepareOrInstall(7, 1)
    expect(result).toMatchObject({ status: 'installed', http_url: `http://${identity.host}:3101` })
    expect(f.install).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toContain('verificationSteps')
  })

  it('treats a completely verified managed host as already installed without reinstalling', async () => {
    const f = makeFixture()
    f.setPreflight({
      ...f.preflight,
      ownership: 'opspilot_owned',
      ports_status: 'occupied',
      install_assessment: 'blocked',
      service: 'verified',
      service_state: 'active',
      ownership_marker: 'valid',
      config_exists: true,
      config_readable: true
    })
    expect(await f.service.prepareOrInstall(7, 1)).toMatchObject({ status: 'installed' })
    expect(f.install).not.toHaveBeenCalled()
  })

  it('fails closed on host conflict and does not prepare or install', async () => {
    const f = makeFixture()
    f.setPreflight({
      ...f.preflight,
      ownership: 'unknown',
      install_assessment: 'unknown',
      local_assessment: 'unknown'
    })
    expect(await f.service.prepareOrInstall(7, 1)).toMatchObject({
      status: 'blocked',
      reason: { code: 'HOST_CONFLICT' }
    })
    expect(f.install).not.toHaveBeenCalled()
  })

  it('rejects a changed host identity before write', async () => {
    const f = makeFixture()
    const wrong = { ...identity, hostFingerprint: 'SHA256:other' }
    const identityAdapter = vi.fn(async () => wrong)
    // identity is checked from the SSH seam; the service dependency remains immutable.
    const context = f.service as unknown as {
      dependencies: { testAdapters: { identity: typeof identityAdapter } }
    }
    context.dependencies.testAdapters.identity = identityAdapter
    expect(await f.service.prepareOrInstall(7, 1)).toMatchObject({
      status: 'blocked',
      reason: { code: 'IDENTITY_CHANGED' }
    })
    expect(f.install).not.toHaveBeenCalled()
  })

  it('returns a preparation failure without starting installation', async () => {
    const f = makeFixture()
    const context = f.service as unknown as {
      dependencies: { testAdapters: { preparePlan: () => Promise<unknown> } }
    }
    context.dependencies.testAdapters.preparePlan = async () => ({
      status: 'blocked',
      code: 'APT_METADATA_INVALID',
      reason: 'untrusted'
    })
    expect(await f.service.prepareOrInstall(7, 1)).toMatchObject({
      status: 'blocked',
      failed_step: 'prepare',
      reason: { code: 'INSTALL_PLAN_BLOCKED' }
    })
    expect(f.install).not.toHaveBeenCalled()
  })

  it('rechecks inventory after preparation and before an install write', async () => {
    const f = makeFixture()
    const context = f.service as unknown as {
      dependencies: { testAdapters: { preparePlan: () => Promise<unknown> } }
    }
    context.dependencies.testAdapters.preparePlan = async () => {
      f.setRevision(2)
      return { status: 'ready', plan: { target: { vpsId: 7 } } }
    }
    expect(await f.service.prepareOrInstall(7, 1)).toMatchObject({
      status: 'pending',
      reason: { code: 'INVENTORY_CHANGED' }
    })
    expect(f.install).not.toHaveBeenCalled()
  })

  it('does not replay an uncertain install; the retry must pass current ownership preflight', async () => {
    const f = makeFixture()
    f.install.mockResolvedValueOnce({
      status: 'blocked',
      code: 'INSTALL_RECONCILIATION_REQUIRED',
      reason: 'uncertain'
    })
    expect(await f.service.prepareOrInstall(7, 1)).toMatchObject({
      status: 'uncertain',
      retryable: false
    })
    f.setPreflight({
      ...f.preflight,
      ownership: 'unknown',
      install_assessment: 'unknown',
      local_assessment: 'unknown'
    })
    expect(await f.service.prepareOrInstall(7, 1)).toMatchObject({
      status: 'blocked',
      reason: { code: 'HOST_CONFLICT' }
    })
    expect(f.install).toHaveBeenCalledOnce()
  })

  it('reconciles the complete VPS inventory including other apps', async () => {
    const f = makeFixture()
    const result = await f.service.reconcile(7, 1)
    expect(result).toMatchObject({ status: 'reconciled_pending', route_count: 2 })
    expect(f.domainRepository.getSharedIngressInventory).toHaveBeenCalledWith(7)
    expect(f.snapshot.bindings).toHaveLength(2)
  })

  it('returns reconcile failures without changing the app or its HTTP URL', async () => {
    const f = makeFixture()
    const context = f.service as unknown as {
      dependencies: { testAdapters: { reconcile: () => Promise<unknown> } }
    }
    context.dependencies.testAdapters.reconcile = async () => ({
      status: 'blocked',
      code: 'RECONCILE_CONFLICT',
      reason: 'conflict'
    })
    expect(await f.service.reconcile(7, 1)).toMatchObject({
      status: 'blocked',
      failed_step: 'reconcile'
    })
    expect(f.apps.get(1)?.url).toBe(`http://${identity.host}:3101`)
    expect(f.deployments.get(11)?.status).toBe('running')
  })

  it('keeps HTTPS pending on first attempt, then accepts a successful CAS retry', async () => {
    const f = makeFixture()
    const context = f.service as unknown as {
      dependencies: { testAdapters: { activate: () => Promise<HttpsActivationResult> } }
    }
    context.dependencies.testAdapters.activate = vi
      .fn()
      .mockResolvedValueOnce({ status: 'pending', reason: 'dns_not_propagated' })
      .mockImplementationOnce(async () => {
        const state = f.states.get('app1.lab.example')!
        state.route_status = 'active'
        state.certificate_status = 'valid'
        state.https_probe_status = 'passed'
        return {
          status: 'active',
          hostname: state.hostname,
          generation: 'g1',
          peer_ip: identity.host
        }
      })
    expect(await f.service.checkHttps(7, 1)).toMatchObject({
      status: 'pending',
      reason: { code: 'HTTPS_DNS_NOT_PROPAGATED' },
      http_url: `http://${identity.host}:3101`
    })
    expect(await f.service.checkHttps(7, 1)).toMatchObject({ status: 'active' })
  })

  it('keeps the app and HTTP URL intact when HTTPS probe fails', async () => {
    const f = makeFixture()
    const context = f.service as unknown as {
      dependencies: { testAdapters: { activate: () => Promise<HttpsActivationResult> } }
    }
    context.dependencies.testAdapters.activate = async () => ({
      status: 'degraded',
      reason: 'probe_failed',
      probe_reason: 'health_response_invalid'
    })
    expect(await f.service.checkHttps(7, 1)).toMatchObject({
      status: 'degraded',
      reason: { code: 'HTTPS_PROBE_FAILED' },
      http_url: `http://${identity.host}:3101`
    })
    expect(f.apps.get(1)?.url).toBe(`http://${identity.host}:3101`)
    expect(f.deployments.get(11)?.status).toBe('running')
  })

  it('blocks invalid VPS/binding/app/deployment references', async () => {
    const f = makeFixture()
    expect(await f.service.readStatus(999, 1)).toMatchObject({
      status: 'blocked',
      reason: { code: 'VPS_NOT_AVAILABLE' }
    })
    expect(await f.service.readStatus(7, 999)).toMatchObject({
      status: 'blocked',
      reason: { code: 'BINDING_NOT_FOUND' }
    })
    f.apps.get(1)!.vps_id = 8
    expect(await f.service.reconcile(7, 1)).toMatchObject({
      status: 'blocked',
      reason: { code: 'APP_OR_DEPLOYMENT_INVALID' }
    })
  })

  it('rejects inventory revision changes during a write workflow and preserves app state', async () => {
    const f = makeFixture()
    const context = f.service as unknown as {
      dependencies: { testAdapters: { reconcile: () => Promise<unknown> } }
    }
    context.dependencies.testAdapters.reconcile = async () => {
      f.setRevision(2)
      return { status: 'reconciled_pending', generation: 'g1', route_count: 2 }
    }
    expect(await f.service.reconcile(7, 1)).toMatchObject({
      status: 'pending',
      reason: { code: 'INVENTORY_CHANGED' }
    })
    expect(f.apps.get(1)?.url).toBe(`http://${identity.host}:3101`)
  })

  it('handles concurrent service requests without taking a nested ingress mutex', async () => {
    const f = makeFixture()
    const results = await Promise.race([
      Promise.all([f.service.reconcile(7, 1), f.service.reconcile(7, 2)]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('service coordination deadlocked')), 2_000)
      )
    ])
    expect(results.map((item) => item.status)).toEqual(['reconciled_pending', 'reconciled_pending'])
  })
})
