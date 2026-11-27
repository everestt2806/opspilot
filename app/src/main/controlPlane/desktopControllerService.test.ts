import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import type { ClientChannel } from 'ssh2'
import type { SshManager } from '../ssh/manager'
import { initializeDatabase, closeDatabase } from '../db'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { DesktopControllerService } from './desktopControllerService'
import { ControllerHttpClientError, type ControllerHttpClient } from './controllerHttpClient'
import type { DesktopControllerRegisterInput } from '@shared/desktopController'
import type { ControllerInstallerResources } from './controllerInstallerCatalog'
let directory: string,
  db: ReturnType<typeof initializeDatabase>,
  service: DesktopControllerService,
  input: DesktopControllerRegisterInput,
  token: string,
  open: ReturnType<typeof vi.fn<SshManager['openProductBootstrapChannel']>>,
  call: ReturnType<typeof vi.fn<ControllerHttpClient['call']>>,
  payloads: Array<Record<string, unknown>>
const now = new Date().toISOString()
const identity = (): unknown => ({
  state: 'response_received',
  response: {
    controller_id: 'remote-controller',
    service_state: 'ready',
    sampled_at: now,
    data_freshness: 'current'
  }
})
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-controller-service-'))
  db = initializeDatabase(directory)
  db.prepare(
    "INSERT INTO vps(id,name,host,host_fingerprint,username,auth_type,encrypted_secret) VALUES(1,'unit','controller.test',?,'operator','key',X'0102')"
  ).run('SHA256:' + 'A'.repeat(43))
  input = {
    binding_id: randomUUID(),
    controller_id: 'remote-controller',
    vps_id: 1,
    artifact_path: '/opt/opspilot/payload/control-plane.cjs',
    data_directory: '/var/lib/opspilot',
    node_path: '/opt/opspilot/node',
    manifest_sha256: 'a'.repeat(64),
    display_name: 'UI connection'
  }
  token = 'opspilot_' + randomBytes(32).toString('base64url')
  payloads = []
  const remoteClientId = randomUUID(),
    expires = new Date(Date.now() + 86400000).toISOString()
  open = vi.fn<SshManager['openProductBootstrapChannel']>(async (_vps, _script, options) => {
    const channel = Object.assign(new EventEmitter(), {
      stderr: new PassThrough(),
      destroy: vi.fn(),
      end: vi.fn()
    })
    channel.end.mockImplementation((body: string) => {
      const request = JSON.parse(body)
      payloads.push(request)
      const data =
        request.operation === 'revoke-desktop-client'
          ? { client_id: remoteClientId, revoked_at: now }
          : {
              state: 'issued_once',
              controller_id: input.controller_id,
              client: {
                client_id: remoteClientId,
                controller_id: input.controller_id,
                display_name: input.display_name,
                scopes: request.payload.requested_scopes,
                created_at: now,
                revoked_at: null,
                token_expires_at: expires
              },
              credential: { access_token: token, token_type: 'Bearer', expires_at: expires }
            }
      queueMicrotask(() => {
        channel.emit('data', Buffer.from(JSON.stringify({ ok: true, data })))
        channel.emit('end')
        channel.emit('close', 0)
      })
    })
    return { channel: channel as unknown as ClientChannel, identity: options!.expectedIdentity! }
  })
  call = vi.fn<ControllerHttpClient['call']>(
    async (operation) =>
      (operation === 'capabilities'
        ? {
            state: 'response_received',
            response: {
              controller_id: input.controller_id,
              sampled_at: now,
              data_freshness: 'current',
              manual_redeploy: { state: 'available' },
              pause_auto_deploy: { state: 'available' },
              resume_auto_deploy: { state: 'available' }
            }
          }
        : operation === 'identity'
          ? identity()
          : {
              state: 'response_received',
              response: {
                controller_id: input.controller_id,
                sampled_at: now,
                data_freshness: 'current',
                items: [
                  {
                    app_id: 7,
                    ownership_generation: 1,
                    source_generation: 1,
                    app_name: 'remote-app',
                    production_ref: 'main',
                    desired_sha: 'b'.repeat(40),
                    auto_deploy_paused: true,
                    reconciliation_state: 'paused',
                    observed_at: null,
                    env_json: token
                  }
                ],
                next_cursor: null,
                has_more: false
              }
            }) as never
  )
  service = new DesktopControllerService(
    db,
    new AesGcmCredentialCipher(randomBytes(32)),
    { openProductBootstrapChannel: open } as unknown as SshManager,
    () => ({ call })
  )
})
afterEach(() => {
  closeDatabase()
  rmSync(directory, { recursive: true })
})
describe('Metadata-only Desktop controller service', () => {
  it.each(['historical', 'unlisted'])(
    'không lên kế hoạch nâng release %s đã rút khỏi danh sách được hỗ trợ',
    async (releaseId) => {
      const catalog = {
        list: () => [{ release_id: 'historical', state: 'available' }]
      } as unknown as ControllerInstallerResources
      const guarded = new DesktopControllerService(
        db,
        new AesGcmCredentialCipher(randomBytes(32)),
        { openProductBootstrapChannel: open } as unknown as SshManager,
        undefined,
        [],
        catalog
      )
      await expect(
        guarded.reviewUpgrade({ installation_request_key: randomUUID(), release_id: releaseId })
      ).rejects.toMatchObject({ context: { cause: { message: 'UPGRADE_UNAVAILABLE' } } })
      expect(open).not.toHaveBeenCalled()
    }
  )
  it('grants write scopes only on explicit opt-in and exposes public scope metadata', async () => {
    const row = await service.register({ ...input, allow_write: true })
    expect(payloads[0]).toMatchObject({
      payload: { requested_scopes: ['read', 'deploy:manual', 'policy:write'] }
    })
    expect(row.scopes).toEqual(['read', 'deploy:manual', 'policy:write'])
    expect(JSON.stringify(row)).not.toContain(token)
    await expect(service.register({ ...input, allow_write: 'yes' } as never)).rejects.toMatchObject(
      { context: { cause: { message: 'REQUEST_INVALID' } } }
    )
  })
  it('projects current controller job/deployment status and rejects a mismatched application', async () => {
    await service.register(input)
    call.mockResolvedValueOnce({
      state: 'response_received',
      response: {
        controller_id: input.controller_id,
        app_id: 7,
        ownership_generation: 2,
        source_generation: 3,
        current_deployment_id: null,
        current_deployment_sha: null,
        current_deployment_state: null,
        latest_job_id: 'job7',
        latest_job_state: 'queued',
        sampled_at: now,
        data_freshness: 'current',
        env_json: token
      }
    } as never)
    const status = await service.appStatus({ binding_id: input.binding_id, app_id: 7 })
    expect(status).toMatchObject({
      latest_job_state: 'queued',
      current_deployment_state: null,
      ownership_generation: 2,
      source_generation: 3
    })
    expect(JSON.stringify(status)).not.toContain(token)
    call.mockResolvedValueOnce({
      state: 'response_received',
      response: { controller_id: input.controller_id, app_id: 8 }
    } as never)
    await expect(
      service.appStatus({ binding_id: input.binding_id, app_id: 7 })
    ).rejects.toMatchObject({ context: { cause: { message: 'PROTOCOL_INVALID' } } })
  })
  it('keeps IPC shared DTO exactly equal to the reviewed standalone contract', () => {
    const read = (path: string): string =>
      readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
    expect(read('../../shared/desktopController.ts')).toBe(
      read('../../../../docs/contracts/desktop-controller-ipc.ts')
    )
  })
  it('derives the principal from current VPS and grants read-only UI access without secret DTOs', async () => {
    const row = await service.register(input)
    expect(row).toMatchObject({
      state: 'active',
      controller_id: input.controller_id,
      display_name: input.display_name
    })
    expect(payloads[0]).toMatchObject({
      payload: { request_key: input.binding_id, requested_scopes: ['read'] }
    })
    expect(open.mock.calls[0][2]?.expectedIdentity?.username).toBe('operator')
    expect(JSON.stringify(row)).not.toContain(token)
    expect(JSON.stringify(await service.list())).not.toContain(token)
    expect(JSON.stringify(await service.list())).not.toContain('encrypted_secret')
  })
  it('rejects credential/principal/URL injection and absent fingerprint before any SSH', async () => {
    await expect(
      service.register({ ...input, access_token: token } as never)
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      context: { cause: { message: 'REQUEST_INVALID' } }
    })
    db.exec('UPDATE vps SET host_fingerprint=NULL WHERE id=1')
    await expect(service.register(input)).rejects.toMatchObject({
      code: 'VALIDATION',
      context: { cause: { message: 'BINDING_UNAVAILABLE' } }
    })
    expect(open).not.toHaveBeenCalled()
  })
  it('reads controller apps via the HTTP client, projects only allowed fields and passes cursor', async () => {
    await service.register(input)
    const snapshot = await service.apps({ binding_id: input.binding_id, cursor: 'unit-cursor' })
    expect(snapshot).toMatchObject({
      binding_id: input.binding_id,
      service_state: 'ready',
      items: [{ app_id: 7, app_name: 'remote-app' }]
    })
    expect(JSON.stringify(snapshot)).not.toContain(token)
    expect(call).toHaveBeenCalledWith('apps', { query: { limit: 50, cursor: 'unit-cursor' } })
    expect(db.prepare('SELECT COUNT(*) AS n FROM app').get()).toEqual({ n: 0 })
  })
  it('does not return cached/local data when HTTP rejects or binding changes in flight', async () => {
    await service.register(input)
    call.mockRejectedValueOnce(new ControllerHttpClientError('CLIENT_REVOKED', 401))
    await expect(service.apps({ binding_id: input.binding_id })).rejects.toMatchObject({
      context: { cause: { message: 'CLIENT_REVOKED' } }
    })
    call.mockImplementation(async () => {
      await service.disconnect(input.binding_id)
      return identity() as never
    })
    await expect(service.apps({ binding_id: input.binding_id })).rejects.toMatchObject({
      code: 'VALIDATION'
    })
  })
  it('revokes through verified admin SSH with a stable request key and clears the local token', async () => {
    const enrolled = await service.register(input),
      revoked = await service.revoke(input.binding_id)
    expect(revoked.state).toBe('disabled')
    expect(payloads[1]).toMatchObject({
      operation: 'revoke-desktop-client',
      payload: { client_id: enrolled.remote_client_id }
    })
    expect(payloads[1].payload).not.toHaveProperty('access_token')
    expect(db.prepare('SELECT encrypted_secret FROM desktop_controller_binding').get()).toEqual({
      encrypted_secret: null
    })
  })
  it('distinguishes local disconnect from revocation and redacts arbitrary upstream errors', async () => {
    await service.register(input)
    await service.disconnect(input.binding_id)
    expect(payloads).toHaveLength(1)
    open.mockRejectedValueOnce(new Error(token))
    const task = service.register({ ...input, binding_id: randomUUID() })
    await expect(task).rejects.not.toThrow(token)
    await expect(task).rejects.toMatchObject({
      code: 'VALIDATION',
      context: { cause: { message: 'CONTROLLER_ADMIN_FAILED' } }
    })
  })
})
