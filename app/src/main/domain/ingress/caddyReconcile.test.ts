import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'
import type { SshHostIdentity, SshManager } from '../../ssh/manager'
import type { DomainRepository, SharedIngressInventorySnapshot } from '../repository'
import { buildSharedIngressConfig } from './routeBuilder'
import {
  reconcileCaddyConfigOverSsh,
  type CaddyReconcileAdapters
} from './caddyReconcile'
import type { IngressPreflightResult } from './preflight'

const identity: SshHostIdentity = {
  vpsId: 404,
  host: '198.51.100.44',
  port: 22,
  hostFingerprint: `SHA256:${'A'.repeat(43)}`
}

function inventory(revision = 'inventory-r1'): SharedIngressInventorySnapshot {
  return {
    vps_id: identity.vpsId,
    host: identity.host,
    port: identity.port,
    host_fingerprint: identity.hostFingerprint,
    revision,
    bindings: [{
      id: 17, app_id: 19, hostname: 'app.example.test', ownership_key: 'dns-owner:19',
      route_ownership_key: 'opspilot-ingress:19:app.example.test', desired_generation: 3,
      dns_status: 'propagated', enabled: true, host_port: 3019, current_deployment_id: 91,
      deployment_version: 4, image_tag: 'sha256:verified-image'
    }]
  }
}

const ingress: IngressPreflightResult = {
  ownership: 'opspilot_owned', ports_status: 'occupied', install_assessment: 'unknown',
  local_assessment: 'clear', reason_code: null, listeners: [], service: 'verified',
  caddy_version: 'verified-by-installation-manifest', ownership_marker: 'valid',
  config_exists: true, config_readable: true,
  ufw: {
    state: 'inactive', inbound_80: 'not_applicable', inbound_443: 'not_applicable',
    inbound_80_ipv4: 'not_applicable', inbound_80_ipv6: 'not_applicable',
    inbound_443_ipv4: 'not_applicable', inbound_443_ipv6: 'not_applicable'
  },
  route_activation: 'not_evaluated'
}

const adapters: CaddyReconcileAdapters = {
  preflight: async () => ingress,
  ownership: async () => ({ status: 'verified', active: false }),
  dns: async (hostname) => ({
    hostname, dns_status: 'propagated', dns_reason_code: null, resolvers: ['1.1.1.1', '8.8.8.8'],
    expected_ipv4: ['203.0.113.8'], expected_ipv6: [], observed_a: ['203.0.113.8'],
    observed_aaaa: [], cname_chain: [], ipv6_status: 'not_advertised', cloudflare_proxy_hint: 'unknown',
    ingress: { ports_status: 'free', install_assessment: 'safe', local_assessment: 'clear', reason_code: null,
      ufw: { state: 'inactive', inbound_80: 'not_applicable', inbound_443: 'not_applicable', inbound_80_ipv4: 'not_applicable', inbound_80_ipv6: 'not_applicable', inbound_443_ipv4: 'not_applicable', inbound_443_ipv6: 'not_applicable' } },
    cloud_firewall_status: 'unknown', acme_http_01: 'ready_to_try', acme_tls_alpn: 'ready_to_try',
    certificate_status: 'not_requested', route_status: 'not_configured', https_probe_status: 'not_run',
    overall_status: 'unknown', instructions: []
  }),
  cloudFirewall: async () => 'verified_open'
}

function commandIdentity(command: string): { generation: string; transaction: string } {
  const match = command.match(/-- '([a-f0-9]{32})' '([a-f0-9]{64})'/)
  if (!match) throw new Error('reconcile command did not contain fixed transaction arguments')
  return { transaction: match[1], generation: match[2] }
}

function successfulRemote(command: string, already = false): string {
  const { generation } = commandIdentity(command)
  const environment = command.includes('acme_staging') ? 'acme_staging' : 'production'
  const content = `# opspilot-generation=${generation}\n${buildSharedIngressConfig([{ hostname: 'app.example.test', host_port: 3019 }], environment)}`
  const configSha = createHash('sha256').update(content).digest('hex')
  return `RESULT=${already ? 'already_current' : 'applied'}\nGENERATION=${generation}\nCONFIG_SHA256=${configSha}\nPREVIOUS_ACTIVE=0\nPREVIOUS_ENABLED=disabled`
}

function setup(options: {
  inventory?: () => SharedIngressInventorySnapshot
  record?: () => void
  remote?: (command: string) => string
  waitRemote?: () => Promise<void>
} = {}): {
  repository: DomainRepository
  ssh: SshManager
  record: ReturnType<typeof vi.fn>
  getInventory: ReturnType<typeof vi.fn>
  commands: string[]
  expectedIdentities: Array<SshHostIdentity | undefined>
  maxConcurrent: () => number
} {
  const snapshot = inventory()
  const getInventory = vi.fn(() => options.inventory?.() ?? snapshot)
  const record = vi.fn(options.record ?? (() => undefined))
  const repository = { getSharedIngressInventory: getInventory, recordSharedIngressReconcile: record } as unknown as DomainRepository
  let current = 0
  let maxConcurrent = 0
  const commands: string[] = []
  const expectedIdentities: Array<SshHostIdentity | undefined> = []
  const ssh = {
    getHostIdentity: vi.fn(async () => identity),
    execWithHostIdentity: vi.fn(async (_id: number, command: string, _options?: unknown, expectedIdentity?: SshHostIdentity) => {
      commands.push(command)
      expectedIdentities.push(expectedIdentity)
      current += 1
      maxConcurrent = Math.max(maxConcurrent, current)
      await options.waitRemote?.()
      current -= 1
      const stdout = options.remote?.(command) ?? successfulRemote(command)
      return { identity, result: { code: 0, stdout, stderr: '' } }
    })
  } as unknown as SshManager
  return { repository, ssh, record, getInventory, commands, expectedIdentities, maxConcurrent: () => maxConcurrent }
}

describe('reconcileCaddyConfigOverSsh', () => {
  it('builds all routes from current DB inventory, pins identity, and records only pending observations', async () => {
    const state = setup()
    const result = await reconcileCaddyConfigOverSsh(state.ssh, state.repository, identity, 'production', adapters)
    expect(result).toMatchObject({ status: 'reconciled_pending', route_count: 1 })
    expect(state.ssh.execWithHostIdentity).toHaveBeenCalledOnce()
    expect(state.expectedIdentities.at(-1)).toEqual(identity)
    const command = state.commands[0]
    const encodedConfig = command.match(/-- '[a-f0-9]{32}' '[a-f0-9]{64}' 'production' '([A-Za-z0-9+/=]+)'/)?.[1]
    expect(encodedConfig && Buffer.from(encodedConfig, 'base64').toString('utf8')).toContain('app.example.test')
    expect(command).toContain('RECONCILE_STATE')
    expect(state.record).toHaveBeenCalledOnce()
  })

  it('returns idempotent status when the remote reports the same generation', async () => {
    const state = setup({ remote: (command) => successfulRemote(command, true) })
    expect(await reconcileCaddyConfigOverSsh(state.ssh, state.repository, identity, 'production', adapters))
      .toMatchObject({ status: 'already_current' })
  })

  it('blocks staging when any enabled hostname is outside the trusted lab allowlist', async () => {
    const state = setup()
    const result = await reconcileCaddyConfigOverSsh(state.ssh, state.repository, identity, 'acme_staging', {
      ...adapters, stagingLabHostnames: ['lab.example.test']
    })
    expect(result).toMatchObject({ status: 'blocked', code: 'RECONCILE_STAGING_SCOPE_INVALID' })
    expect(state.ssh.execWithHostIdentity).not.toHaveBeenCalled()
  })

  it('blocks when the DB inventory changes during readiness and sends no write', async () => {
    let reads = 0
    const state = setup({ inventory: () => inventory(++reads === 1 ? 'r1' : 'r2') })
    const result = await reconcileCaddyConfigOverSsh(state.ssh, state.repository, identity, 'production', adapters)
    expect(result).toMatchObject({ status: 'blocked', code: 'RECONCILE_INVENTORY_INVALID' })
    expect(state.ssh.execWithHostIdentity).not.toHaveBeenCalled()
  })

  it('rolls back the remote snapshot when the DB observation transaction fails', async () => {
    const state = setup({
      record: () => { throw new Error('fixture DB failure') },
      remote: (command) => command.includes('expected_config_sha=')
        ? 'RESULT=rolled_back'
        : successfulRemote(command)
    })
    const result = await reconcileCaddyConfigOverSsh(state.ssh, state.repository, identity, 'production', adapters)
    expect(result).toMatchObject({ status: 'blocked', code: 'RECONCILE_DB_FAILED_ROLLED_BACK' })
    expect(state.ssh.execWithHostIdentity).toHaveBeenCalledTimes(2)
  })

  it('does not run rollback when DB observation fails for an already-current remote config', async () => {
    const state = setup({
      record: () => { throw new Error('fixture DB failure') },
      remote: (command) => successfulRemote(command, true)
    })

    expect(await reconcileCaddyConfigOverSsh(state.ssh, state.repository, identity, 'production', adapters))
      .toMatchObject({ status: 'blocked', code: 'RECONCILE_DB_FAILED_NO_CHANGE' })
    expect(state.ssh.execWithHostIdentity).toHaveBeenCalledOnce()
  })

  it('reports rollback failure instead of claiming DB failure was restored', async () => {
    const state = setup({
      record: () => { throw new Error('fixture DB failure') },
      remote: (command) => command.includes('expected_config_sha=')
        ? 'RESULT=rollback_failed'
        : successfulRemote(command)
    })
    expect(await reconcileCaddyConfigOverSsh(state.ssh, state.repository, identity, 'production', adapters))
      .toMatchObject({ status: 'blocked', code: 'RECONCILE_ROLLBACK_FAILED' })
  })

  it('serializes reconciles for a VPS with the installer mutex', async () => {
    let release!: () => void
    let entered!: () => void
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const state = setup({ waitRemote: async () => { entered(); await gate } })
    const first = reconcileCaddyConfigOverSsh(state.ssh, state.repository, identity, 'production', adapters)
    await enteredPromise
    const second = reconcileCaddyConfigOverSsh(state.ssh, state.repository, identity, 'production', adapters)
    await Promise.resolve()
    expect(state.ssh.execWithHostIdentity).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([first, second])
    expect(state.maxConcurrent()).toBe(1)
  })

  it('does not write when cloud firewall evidence is unknown', async () => {
    const state = setup()
    expect(await reconcileCaddyConfigOverSsh(state.ssh, state.repository, identity, 'production', {
      ...adapters, cloudFirewall: async () => 'unknown'
    })).toMatchObject({ status: 'blocked', code: 'RECONCILE_FIREWALL_NOT_READY' })
    expect(state.ssh.execWithHostIdentity).not.toHaveBeenCalled()
  })
})
