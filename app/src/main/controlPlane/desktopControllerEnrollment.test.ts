import { PRODUCT_POSTGRES_IMAGE } from './productPostgres'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ClientChannel } from 'ssh2'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { initializeDatabase, closeDatabase } from '../db'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import type { SshManager } from '../ssh/manager'
import type {
  ProductDesktopControllerBindingIntent,
  ProductDesktopEnrollmentResponse
} from '../../../../docs/contracts/product-controller-api'
import { DesktopControllerVault } from './desktopControllerVault'
import { DesktopControllerEnrollment } from './desktopControllerEnrollment'

let directory: string,
  vault: DesktopControllerVault,
  intent: ProductDesktopControllerBindingIntent,
  issued: ProductDesktopEnrollmentResponse,
  service: DesktopControllerEnrollment,
  open: ReturnType<typeof vi.fn<SshManager['openProductBootstrapChannel']>>,
  requests: Array<Record<string, unknown>>,
  reply: (channel: FakeChannel) => void

it('refuses reconnection through a legacy direct binding and never accepts caller paths', async () => {
  await service.enroll(intent.binding_id)
  open.mockClear()
  await expect(
    service.reconnectionContext(intent.binding_id, {
      format: 1,
      controller_id: intent.controller_id,
      app_id: 42
    })
  ).rejects.toThrow('PROJECT_RECONNECTION_UNAVAILABLE')
  await expect(
    service.reconnectionContext(intent.binding_id, {
      format: 1,
      controller_id: intent.controller_id,
      app_id: 42,
      artifact: '/caller/path'
    } as never)
  ).rejects.toThrow('PROJECT_RECONNECTION_INPUT_INVALID')
  expect(open).not.toHaveBeenCalled()
})
type FakeChannel = EventEmitter & {
  stderr: PassThrough
  end: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}
function channel(): FakeChannel {
  const value = Object.assign(new EventEmitter(), {
    stderr: new PassThrough(),
    end: vi.fn(),
    destroy: vi.fn()
  })
  value.end.mockImplementation((body: string) => {
    requests.push(JSON.parse(body))
    queueMicrotask(() => reply(value))
    return value
  })
  return value
}
function respond(value: FakeChannel, data: unknown): void {
  value.emit('data', Buffer.from(JSON.stringify({ ok: true, data })))
  value.emit('end')
  value.emit('close', 0)
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-enrollment-'))
  const db = initializeDatabase(directory)
  db.prepare(
    `INSERT INTO vps(id,name,host,port,host_fingerprint,username,auth_type,encrypted_secret)
    VALUES(1,'unit','controller.test',22,?,'operator','key',X'0102')`
  ).run('SHA256:' + 'A'.repeat(43))
  vault = new DesktopControllerVault(db, new AesGcmCredentialCipher(randomBytes(32)))
  intent = {
    binding_id: randomUUID(),
    controller_id: 'remote-controller',
    vps_id: 1,
    ssh_security_revision: 1,
    principal: {
      vpsId: 1,
      host: 'controller.test',
      port: 22,
      hostFingerprint: 'SHA256:' + 'A'.repeat(43),
      username: 'operator',
      authType: 'key'
    },
    artifact_path: '/opt/opspilot/payload/control-plane.cjs',
    data_directory: '/var/lib/opspilot/controller',
    node_path: '/opt/opspilot/node',
    manifest_sha256: 'a'.repeat(64),
    display_name: 'Enrollment unit',
    requested_scopes: ['read', 'deploy:manual', 'policy:write']
  }
  const expires = new Date(Date.now() + 30 * 86400000).toISOString()
  issued = {
    state: 'issued_once',
    controller_id: intent.controller_id,
    client: {
      client_id: randomUUID(),
      controller_id: intent.controller_id,
      display_name: intent.display_name,
      scopes: intent.requested_scopes,
      created_at: new Date().toISOString(),
      revoked_at: null,
      token_expires_at: expires
    },
    credential: {
      access_token: 'opspilot_' + randomBytes(32).toString('base64url'),
      token_type: 'Bearer',
      expires_at: expires
    }
  }
  vault.prepare(intent)
  requests = []
  reply = (value) => respond(value, issued)
  open = vi.fn<SshManager['openProductBootstrapChannel']>(async () => ({
    channel: channel() as unknown as ClientChannel,
    identity: { ...intent.principal }
  }))
  service = new DesktopControllerEnrollment(vault, { openProductBootstrapChannel: open })
})
afterEach(() => {
  closeDatabase()
  rmSync(directory, { recursive: true })
})
describe('Trusted Desktop controller enrollment', () => {
  it('sends bounded large environment bodies through the fixed operation and calls the last-moment guard', async () => {
    await service.enroll(intent.binding_id)
    const request = {
      format: 1 as const,
      request_key: randomUUID(),
      scope: {
        controller_id: intent.controller_id,
        app_id: 42,
        ownership_generation: 1,
        target: {
          vps_id: 77,
          host: 'target.test',
          port: 22,
          username: 'operator',
          auth_type: 'key' as const,
          host_fingerprint: 'SHA256:' + 'B'.repeat(43),
          ssh_security_revision: 1
        }
      },
      expected_latest_revision: null,
      expected_source_generation: 1,
      expected_source_config_sha256: 'a'.repeat(64),
      values: {
        runtime_env: {
          APP_PADDING: 'x'.repeat(8000),
          APP_PADDING_2: 'y'.repeat(8000),
          APP_PADDING_3: 'z'.repeat(8000)
        },
        public_build_args: {}
      }
    }
    const metadata = {
      controller_id: intent.controller_id,
      app_id: 42,
      ownership_generation: 1,
      revision: 1,
      basis_source_generation: 1,
      basis_source_config_sha256: 'a'.repeat(64),
      framework: 'nextjs',
      runtime_keys: ['APP_PADDING', 'APP_PADDING_2', 'APP_PADDING_3'],
      public_build_keys: [],
      created_at: new Date().toISOString(),
      activation: 'staged'
    }
    reply = (value) =>
      respond(value, { state: 'staged', request_key: request.request_key, metadata })
    const guard = vi.fn()
    expect(
      (await service.stageEnvironment(intent.binding_id, request, guard)).metadata.revision
    ).toBe(1)
    expect(guard).toHaveBeenCalledOnce()
    expect(requests.at(-1)).toMatchObject({
      operation: 'stage-project-environment',
      payload: request
    })
    expect(JSON.stringify(requests.at(-1)).length).toBeGreaterThan(16384)
  })
  it('does not transmit environment values after current authority changes at the send boundary', async () => {
    await service.enroll(intent.binding_id)
    const guard = vi.fn(() => {
      throw Error('SYNTHETIC_ONLY_GUARD')
    })
    const request = {
      format: 1 as const,
      request_key: randomUUID(),
      scope: {
        controller_id: intent.controller_id,
        app_id: 42,
        ownership_generation: 1,
        target: {
          vps_id: 77,
          host: 'target.test',
          port: 22,
          username: 'operator',
          auth_type: 'key' as const,
          host_fingerprint: 'SHA256:' + 'B'.repeat(43),
          ssh_security_revision: 1
        }
      },
      expected_latest_revision: null,
      expected_source_generation: 1,
      expected_source_config_sha256: 'a'.repeat(64),
      values: { runtime_env: { APP_TOKEN: 'SYNTHETIC_ONLY' }, public_build_args: {} }
    }
    await expect(service.stageEnvironment(intent.binding_id, request, guard)).rejects.toThrow()
    expect(requests.filter((r) => r.operation === 'stage-project-environment')).toHaveLength(0)
  })
  it('pins the approved bootstrap and principal, persists the credential and returns metadata only', async () => {
    const metadata = await service.enroll(intent.binding_id)
    expect(metadata).toMatchObject({
      state: 'active',
      revision: 2,
      remote_client_id: issued.client.client_id
    })
    expect(JSON.stringify(metadata)).not.toContain(issued.credential.access_token)
    expect(vault.resolve(intent.binding_id).accessToken).toBe(issued.credential.access_token)
    const [id, script, options] = open.mock.calls[0]
    expect(id).toBe(1)
    expect(options?.expectedIdentity).toEqual(intent.principal)
    expect(script.sha256).toBe(createHash('sha256').update(script.text).digest('hex'))
    expect(script.text).not.toContain('APPROVED_ASSETS = ()')
    expect(script.text).not.toContain(issued.credential.access_token)
    expect(requests[0]).toMatchObject({
      controller_id: intent.controller_id,
      manifest_sha256: intent.manifest_sha256,
      payload: { request_key: intent.binding_id }
    })
    expect(await service.enroll(intent.binding_id)).toEqual(metadata)
    expect(open).toHaveBeenCalledOnce()
  })
  it('preserves the same enrollment UUID after lost delivery and records replay without inventing a token', async () => {
    reply = (value) => value.emit('close', 1)
    await expect(service.enroll(intent.binding_id)).rejects.toThrow('CONTROLLER_ADMIN_FAILED')
    expect(vault.get(intent.binding_id).state).toBe('delivery_unknown')
    reply = (value) =>
      respond(value, {
        state: 'credential_delivery_unknown',
        controller_id: intent.controller_id,
        client_id: issued.client.client_id
      })
    expect(await service.enroll(intent.binding_id)).toMatchObject({
      state: 'delivery_unknown',
      remote_client_id: issued.client.client_id,
      client: null
    })
    expect(
      requests.map((request) => (request.payload as { request_key: string }).request_key)
    ).toEqual([intent.binding_id, intent.binding_id])
    expect(() => vault.resolve(intent.binding_id)).toThrow('BINDING_UNAVAILABLE')
  })
  it('can activate a pending retry when the earlier attempt never received a credential', async () => {
    open.mockRejectedValueOnce(new Error('unit-sensitive-remote-error'))
    const failed = service.enroll(intent.binding_id)
    await expect(failed).rejects.toThrow('CONTROLLER_ADMIN_FAILED')
    await expect(failed).rejects.not.toThrow('unit-sensitive-remote-error')
    expect((await service.enroll(intent.binding_id)).state).toBe('active')
    expect(vault.resolve(intent.binding_id).accessToken).toBe(issued.credential.access_token)
    expect((requests[0].payload as { request_key: string }).request_key).toBe(intent.binding_id)
  })
  it('cannot reactivate a binding disabled while the reply was in flight', async () => {
    reply = (value) => {
      vault.disable(intent.binding_id, 1)
      respond(value, issued)
    }
    await expect(service.enroll(intent.binding_id)).rejects.toThrow('BINDING_CHANGED')
    expect(vault.get(intent.binding_id).state).toBe('disabled')
    expect(() => vault.resolve(intent.binding_id)).toThrow('BINDING_UNAVAILABLE')
  })
  it('rejects foreign SSH identity before sending the admin payload', async () => {
    const value = channel()
    open.mockResolvedValueOnce({
      channel: value as unknown as ClientChannel,
      identity: { ...intent.principal, username: 'foreign' }
    })
    await expect(service.enroll(intent.binding_id)).rejects.toThrow('CONTROLLER_IDENTITY_MISMATCH')
    expect(value.end).not.toHaveBeenCalled()
    expect(value.destroy).toHaveBeenCalled()
  })
  it('rejects malformed/oversized output and consumes raw stderr without reflecting it', async () => {
    reply = (value) => {
      value.stderr.emit('data', Buffer.from('unit-sensitive-stderr'))
      value.emit('data', Buffer.alloc(65537, 120))
    }
    const failed = service.enroll(intent.binding_id)
    await expect(failed).rejects.toThrow('CONTROLLER_ADMIN_FAILED')
    await expect(failed).rejects.not.toThrow('unit-sensitive-stderr')
    expect(vault.get(intent.binding_id).state).toBe('delivery_unknown')
  })
  it('returns stable bundle/node verification errors without accepting a credential', async () => {
    for (const code of ['CONTROLLER_BUNDLE_VERIFICATION_FAILED', 'CONTROLLER_NODE_UNSUPPORTED']) {
      reply = (value) => {
        value.emit('data', Buffer.from(JSON.stringify({ ok: false, code })))
        value.emit('end')
        value.emit('close', 0)
      }
      await expect(service.enroll(intent.binding_id)).rejects.toThrow(code)
      expect(() => vault.resolve(intent.binding_id)).toThrow('BINDING_UNAVAILABLE')
    }
  })
  it('runs only the fixed source command with binding-derived bundle pins and strictly checks its reply', async () => {
    vault.activate(intent.binding_id, 1, issued)
    const sourceRequest = {
      format: 1 as const,
      controller_id: intent.controller_id,
      app_id: 7,
      expected_ownership_generation: 1,
      expected_source_generation: 1,
      expected_source_config_sha256: 'b'.repeat(64),
      expected_target_security_revision: 3
    }
    const sourceReply = {
      state: 'source_verified',
      controller_id: intent.controller_id,
      app_id: 7,
      ownership_generation: 1,
      source_generation: 1,
      source_config_sha256: 'b'.repeat(64),
      target_vps_id: 77,
      target_security_revision: 3,
      repository_url: 'https://github.com/example/api.git',
      production_ref: 'main',
      repository_root: '.',
      commit_sha: 'c'.repeat(40),
      observation_sequence: 1,
      framework: 'express',
      configured_container_port: 3000,
      detected_container_port: 3000,
      source_file_count: 12,
      source_bytes: 64000,
      auto_deploy_paused: true,
      deployment_started: false,
      runtime_preflight: 'required',
      verified_at: new Date().toISOString()
    }
    reply = (value) => respond(value, sourceReply)
    const result = await service.verifyProjectSource(intent.binding_id, sourceRequest)
    expect(result.commit_sha).toBe('c'.repeat(40))
    expect(requests[0]).toMatchObject({
      operation: 'verify-project-source',
      payload: {
        ...sourceRequest,
        artifact: intent.artifact_path,
        manifest_sha256: intent.manifest_sha256
      }
    })
    expect(JSON.stringify(requests)).not.toContain(issued.credential.access_token)
    reply = (value) => respond(value, { ...sourceReply, raw_secret: 'do-not-export' })
    await expect(service.verifyProjectSource(intent.binding_id, sourceRequest)).rejects.toThrow(
      'CONTROLLER_ADMIN_FAILED'
    )
    reply = (value) => {
      value.emit(
        'data',
        Buffer.from(JSON.stringify({ ok: false, code: 'PROJECT_SOURCE_UNSUPPORTED' }))
      )
      value.emit('end')
      value.emit('close', 0)
    }
    await expect(service.verifyProjectSource(intent.binding_id, sourceRequest)).rejects.toThrow(
      'PROJECT_SOURCE_UNSUPPORTED'
    )
  })
  it('gives source verification its own bounded deadline and preserves enrollment timeout limits', async () => {
    await expect(service.enroll(intent.binding_id, { timeoutMs: 60_001 })).rejects.toThrow(
      'REQUEST_INVALID'
    )
    vault.activate(intent.binding_id, 1, issued)
    reply = () => {}
    vi.useFakeTimers()
    try {
      const running = service.verifyProjectSource(intent.binding_id, {
        format: 1,
        controller_id: intent.controller_id,
        app_id: 7,
        expected_ownership_generation: 1,
        expected_source_generation: 1,
        expected_source_config_sha256: 'b'.repeat(64),
        expected_target_security_revision: 3
      })
      const failed = expect(running).rejects.toThrow('REQUEST_TIMEOUT')
      await vi.advanceTimersByTimeAsync(60_000)
      expect(open.mock.results).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(60_000)
      await failed
    } finally {
      vi.useRealTimers()
    }
  })
  it('bounds target enrollment at90s without changing the source or legacy admin limits', async () => {
    vault.activate(intent.binding_id, 1, issued)
    reply = () => {}
    vi.useFakeTimers()
    try {
      let settled = false
      const running = service.enrollProjectTarget(intent.binding_id, {
        format: 1,
        controller_id: intent.controller_id,
        app_id: 7,
        expected_ownership_generation: 1,
        expected_source_generation: 1,
        expected_source_config_sha256: 'b'.repeat(64),
        expected_target_security_revision: 3,
        target_root: '/private/reviewed'
      })
      void running.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        }
      )
      const rejected = expect(running).rejects.toThrow('REQUEST_TIMEOUT')
      await vi.advanceTimersByTimeAsync(60_000)
      expect(settled).toBe(false)
      expect(requests[0]).toMatchObject({
        operation: 'enroll-project-target',
        payload: {
          target_root: '/private/reviewed',
          artifact: intent.artifact_path,
          manifest_sha256: intent.manifest_sha256
        }
      })
      await vi.advanceTimersByTimeAsync(30_000)
      await rejected
      expect(settled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
  it('does not send for pre-aborted/invalid calls and closes a bootstrap delivered after the deadline', async () => {
    const stop = new AbortController()
    stop.abort()
    await expect(service.enroll(intent.binding_id, { signal: stop.signal })).rejects.toThrow(
      'REQUEST_ABORTED'
    )
    await expect(service.enroll(intent.binding_id, { timeoutMs: 0 })).rejects.toThrow(
      'REQUEST_INVALID'
    )
    expect(vault.get(intent.binding_id).state).toBe('pending')
    expect(open).not.toHaveBeenCalled()
    let release!: () => void
    const value = channel()
    open.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ channel: value as unknown as ClientChannel, identity: intent.principal })
        })
    )
    await expect(service.enroll(intent.binding_id, { timeoutMs: 20 })).rejects.toThrow(
      'REQUEST_TIMEOUT'
    )
    release()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(value.end).not.toHaveBeenCalled()
    expect(value.destroy).toHaveBeenCalled()
  })
})

describe('Pinned PostgreSQL admin transport', () => {
  const request =
    (): import('../../../../docs/contracts/product-postgres').ProductPostgresPrepareInput => ({
      format: 1 as const,
      request_key: randomUUID(),
      scope: {
        controller_id: intent.controller_id,
        app_id: 42,
        ownership_generation: 1,
        target: {
          vps_id: 77,
          host: 'target.test',
          port: 22,
          username: 'operator',
          auth_type: 'key' as const,
          host_fingerprint: 'SHA256:' + 'B'.repeat(43),
          ssh_security_revision: 1
        }
      },
      expected_source_generation: 1,
      expected_source_config_sha256: 'a'.repeat(64)
    })
  const metadata =
    (): import('../../../../docs/contracts/product-postgres').ProductPostgresMetadata => ({
      database_id: '11111111-1111-4111-8111-111111111111',
      controller_id: intent.controller_id,
      app_id: 42,
      ownership_generation: 1,
      framework: 'express' as const,
      engine: 'postgresql' as const,
      major: 16 as const,
      image: PRODUCT_POSTGRES_IMAGE,
      database_name: 'opspilot' as const,
      application_user: 'opspilot' as const,
      administrator_user: 'postgres' as const,
      created_at: new Date().toISOString(),
      provisioning: 'prepared' as const
    })
  const inspection = (): {
    request: import('../../../../docs/contracts/product-postgres-inspection').ProductPostgresInspectionRequest
    result: import('../../../../docs/contracts/product-postgres-inspection').ProductPostgresInspectionResult
  } => {
    const resource = metadata(),
      original = request()
    const input = {
      context: {
        format: 1 as const,
        controller_id: intent.controller_id,
        app_id: 42,
        expected_ownership_generation: 1,
        expected_source_generation: 1,
        expected_source_config_sha256: original.expected_source_config_sha256,
        expected_target_security_revision: 1,
        database_id: resource.database_id
      },
      read: { operation: 'inspect' as const }
    }
    return {
      request: input,
      result: {
        context: {
          state: 'configuration_verified',
          controller_id: intent.controller_id,
          app_id: 42,
          ownership_generation: 1,
          source_generation: 1,
          source_config_sha256: original.expected_source_config_sha256,
          target_security_revision: 1,
          database: resource,
          runtime_status: 'not_checked'
        },
        read: input.read,
        instance: {
          database_id: resource.database_id,
          container_id: 'b'.repeat(64),
          image_id: 'sha256:' + 'c'.repeat(64),
          volume: `opspilot-pg-${resource.database_id}-data`,
          volume_created_at: '2026-11-17T00:00:00Z',
          system_identifier: '1234567',
          state: 'ready',
          public_port: null
        },
        checked_at: new Date().toISOString(),
        data: null
      }
    }
  }
  it('uses the finite inspector operation with project-only input and validates runtime identity', async () => {
    await service.enroll(intent.binding_id)
    const f = inspection(),
      guard = vi.fn()
    reply = (channel) => respond(channel, f.result)
    expect(await service.inspectPostgres(intent.binding_id, f.request, guard)).toEqual(f.result)
    expect(guard).toHaveBeenCalledOnce()
    expect(requests.at(-1)).toMatchObject({
      operation: 'managed-postgres-inspection',
      payload: f.request
    })
    expect(requests.at(-1)?.payload).not.toHaveProperty('artifact')
  })
  it('rejects foreign controller or extra SQL before opening inspector transport', async () => {
    await service.enroll(intent.binding_id)
    open.mockClear()
    const f = inspection()
    await expect(
      service.inspectPostgres(intent.binding_id, {
        ...f.request,
        context: { ...f.request.context, controller_id: randomUUID() }
      })
    ).rejects.toThrow('POSTGRES_INSPECTION_INPUT_INVALID')
    await expect(
      service.inspectPostgres(intent.binding_id, {
        ...f.request,
        sql: 'SELECT 1'
      } as typeof f.request)
    ).rejects.toThrow('POSTGRES_INSPECTION_INPUT_INVALID')
    expect(open).not.toHaveBeenCalled()
  })
  it('rejects wrong source, instance and credential-bearing inspector replies', async () => {
    await service.enroll(intent.binding_id)
    const f = inspection()
    for (const bad of [
      { ...f.result, context: { ...f.result.context, source_generation: 2 } },
      { ...f.result, instance: { ...f.result.instance, database_id: randomUUID() } },
      { ...f.result, credential: 'SYNTHETIC_SECRET' }
    ]) {
      reply = (channel) => respond(channel, bad)
      await expect(service.inspectPostgres(intent.binding_id, f.request)).rejects.toThrow()
    }
  })
  it('keeps only safe inspector errors and supports reads finishing after the old15s admin budget', async () => {
    await service.enroll(intent.binding_id)
    const f = inspection()
    let waiting: FakeChannel | undefined
    reply = (channel) => {
      waiting = channel
    }
    vi.useFakeTimers()
    try {
      const pending = service.inspectPostgres(intent.binding_id, f.request)
      await vi.advanceTimersByTimeAsync(60000)
      expect(waiting!.destroy).not.toHaveBeenCalled()
      respond(waiting!, f.result)
      expect(await pending).toEqual(f.result)
    } finally {
      vi.useRealTimers()
    }
    reply = (channel) => {
      channel.emit(
        'data',
        Buffer.from(JSON.stringify({ ok: false, code: 'POSTGRES_INSPECTION_RELATION_UNAVAILABLE' }))
      )
      channel.emit('end')
      channel.emit('close', 0)
    }
    await expect(service.inspectPostgres(intent.binding_id, f.request)).rejects.toThrow(
      'POSTGRES_INSPECTION_RELATION_UNAVAILABLE'
    )
  })
  it('guards resource prepare and verifies returned scope, UUID and metadata', async () => {
    await service.enroll(intent.binding_id)
    const input = request(),
      resource = metadata(),
      guard = vi.fn()
    reply = (channel) =>
      respond(channel, { state: 'prepared', request_key: input.request_key, metadata: resource })
    expect(await service.preparePostgres(intent.binding_id, input, guard)).toEqual({
      state: 'prepared',
      request_key: input.request_key,
      metadata: resource
    })
    expect(guard).toHaveBeenCalledOnce()
    expect(requests.at(-1)).toMatchObject({ operation: 'prepare-managed-postgres', payload: input })
  })
  it('uses vault artifact/pin for review and preserves the longer bounded helper-probe timeout', async () => {
    await service.enroll(intent.binding_id)
    const input = { ...request(), database_id: metadata().database_id },
      resource = metadata()
    reply = (channel) =>
      respond(channel, {
        scope: input.scope,
        source_generation: 1,
        source_config_sha256: input.expected_source_config_sha256,
        metadata: resource,
        auto_deploy_paused: true,
        deployment_started: false
      })
    await service.reviewPostgres(intent.binding_id, input)
    expect(requests.at(-1)).toMatchObject({
      operation: 'managed-postgres-review',
      payload: {
        artifact: intent.artifact_path,
        manifest_sha256: intent.manifest_sha256,
        selection: input
      }
    })
    expect(open.mock.calls.at(-1)?.[2]?.timeoutMs).toBe(30000) // SSH open budget; operation has its own 90s deadline.
  })
  it('allows a PG helper review to finish after60s while keeping the operation deadline bounded', async () => {
    await service.enroll(intent.binding_id)
    const input = { ...request(), database_id: metadata().database_id },
      resource = metadata()
    let waiting: FakeChannel | undefined
    reply = (value) => {
      waiting = value
    }
    vi.useFakeTimers()
    try {
      const running = service.reviewPostgres(intent.binding_id, input)
      await vi.advanceTimersByTimeAsync(60000)
      expect(waiting).toBeDefined()
      expect(waiting!.destroy).not.toHaveBeenCalled()
      respond(waiting!, {
        scope: input.scope,
        source_generation: 1,
        source_config_sha256: input.expected_source_config_sha256,
        metadata: resource,
        auto_deploy_paused: true,
        deployment_started: false
      })
      expect((await running).metadata).toEqual(resource)
    } finally {
      vi.useRealTimers()
    }
  })
  it('reads prepared state without claiming selected or provisioned runtime', async () => {
    await service.enroll(intent.binding_id)
    const value = metadata()
    reply = (channel) => respond(channel, { metadata: value })
    expect(await service.postgresState(intent.binding_id, request().scope)).toEqual(value)
    expect(requests.at(-1)).toMatchObject({ operation: 'managed-postgres-state' })
  })
  it('sends selection once with its guard and uses a distinct lookup operation for uncertainty', async () => {
    await service.enroll(intent.binding_id)
    const input = { ...request(), database_id: metadata().database_id },
      guard = vi.fn()
    const selected = {
      state: 'selected',
      request_key: input.request_key,
      controller_id: intent.controller_id,
      app_id: 42,
      ownership_generation: 1,
      source_generation: 2,
      source_config_sha256: 'b'.repeat(64),
      database: {
        database_id: input.database_id,
        controller_id: intent.controller_id,
        ownership_generation: 1
      },
      auto_deploy_paused: true,
      deployment_started: false,
      execution: 'requires_postgres_runtime'
    }
    reply = (channel) => respond(channel, selected)
    await service.selectPostgres(intent.binding_id, input, guard)
    expect(guard).toHaveBeenCalledOnce()
    reply = (channel) =>
      respond(channel, { result: selected, is_current: true, definitively_unapplied: false })
    expect((await service.postgresSelectionState(intent.binding_id, input)).result).toEqual(
      selected
    )
    expect(requests.slice(-2).map((r) => r.operation)).toEqual([
      'select-managed-postgres',
      'managed-postgres-selection-state'
    ])
  })
  it('validates context scope and original registration basis without changing the binding', async () => {
    await service.enroll(intent.binding_id)
    const r = request(),
      before = vault.resolve(intent.binding_id)
    const input = {
      format: 1 as const,
      controller_id: intent.controller_id,
      app_id: 42,
      expected_ownership_generation: 1,
      expected_source_generation: 1,
      expected_source_config_sha256: r.expected_source_config_sha256,
      expected_target_security_revision: 1
    }
    const databaseMetadata = metadata()
    const result = {
      controller_id: intent.controller_id,
      scope: r.scope,
      basis_source_generation: 1,
      basis_source_config_sha256: r.expected_source_config_sha256,
      source_generation: 2,
      source_config_sha256: 'b'.repeat(64),
      environment: { latest: null, selected: null },
      database: { prepared: databaseMetadata, selected: databaseMetadata },
      auto_deploy_paused: true,
      deployment_started: false
    }
    reply = (channel) => respond(channel, result)
    expect(await service.postgresContext(intent.binding_id, input)).toEqual(result)
    expect(vault.resolve(intent.binding_id)).toEqual(before)
    reply = (channel) => respond(channel, { ...result, basis_source_config_sha256: '0'.repeat(64) })
    await expect(service.postgresContext(intent.binding_id, input)).rejects.toThrow(
      'CONTROLLER_ADMIN_FAILED'
    )
  })
  it.each(['foreign-app', 'credential-field', 'runtime-ready', 'wrong-image'])(
    'rejects %s metadata in a Root reply',
    async (variant) => {
      await service.enroll(intent.binding_id)
      const resource = {
        ...metadata(),
        ...(variant === 'foreign-app'
          ? { app_id: 43 }
          : variant === 'credential-field'
            ? { password: 'SYNTHETIC_DO_NOT_TRANSPORT' }
            : variant === 'runtime-ready'
              ? { provisioning: 'ready' }
              : { image: 'postgres:latest' })
      }
      reply = (channel) => respond(channel, { metadata: resource })
      await expect(service.postgresState(intent.binding_id, request().scope)).rejects.toThrow(
        'CONTROLLER_ADMIN_FAILED'
      )
    }
  )
  it('refuses foreign controller scope before opening a new channel', async () => {
    await service.enroll(intent.binding_id)
    const before = open.mock.calls.length,
      input = request()
    input.scope.controller_id = 'foreign-controller'
    await expect(service.preparePostgres(intent.binding_id, input, vi.fn())).rejects.toThrow(
      'PRODUCT_POSTGRES_AUTHORITY_CHANGED'
    )
    expect(open).toHaveBeenCalledTimes(before)
  })
  it('preserves only explicitly whitelisted PG error codes', async () => {
    await service.enroll(intent.binding_id)
    reply = (channel) => {
      channel.emit(
        'data',
        Buffer.from(JSON.stringify({ ok: false, code: 'PRODUCT_POSTGRES_HELPER_UPGRADE_REQUIRED' }))
      )
      channel.emit('end')
      channel.emit('close', 0)
    }
    await expect(service.postgresState(intent.binding_id, request().scope)).rejects.toThrow(
      'PRODUCT_POSTGRES_HELPER_UPGRADE_REQUIRED'
    )
  })
  it('looks up a lost prepare reply through its readonly operation instead of sending prepare again', async () => {
    await service.enroll(intent.binding_id)
    const input = request(),
      resource = metadata()
    reply = (value) =>
      respond(value, {
        result: { state: 'already_prepared', request_key: input.request_key, metadata: resource },
        definitively_unapplied: false
      })
    expect((await service.postgresPrepareState(intent.binding_id, input)).result?.metadata).toEqual(
      resource
    )
    expect(requests.at(-1)).toMatchObject({
      operation: 'managed-postgres-prepare-state',
      payload: input
    })
    expect(requests.filter((r) => r.operation === 'prepare-managed-postgres')).toHaveLength(0)
  })
})
