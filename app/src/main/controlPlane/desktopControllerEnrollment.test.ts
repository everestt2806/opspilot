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
