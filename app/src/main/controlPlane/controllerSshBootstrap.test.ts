import { EventEmitter } from 'node:events'
import type { ClientChannel } from 'ssh2'
import { describe, expect, it, vi } from 'vitest'
import type { SshManager, SshVerifiedConnectionIdentity } from '../ssh/manager'
import type { InstalledControllerAdminRequest } from '../../../../docs/contracts/product-installed-controller-admin'
import {
  callControllerBootstrap,
  controllerBootstrapScript,
  transferControllerRelease,
  discoverControllerBootstrap,
  administerInstalledController
} from './controllerSshBootstrap'
import { createHash } from 'node:crypto'

const identity: SshVerifiedConnectionIdentity = {
  vpsId: 1,
  host: '127.0.0.1',
  port: 22,
  hostFingerprint: 'SHA256:SYNTHETIC',
  username: 'fixture',
  authType: 'key'
}
const locator = {
  request_key: '11111111-1111-4111-8111-111111111111',
  release_sha256: 'a'.repeat(64),
  installer_sha256: 'b'.repeat(64)
}
function fixture(
  kind:
    | 'good'
    | 'close'
    | 'large'
    | 'stderr'
    | 'raw'
    | 'mismatch'
    | 'error'
    | 'inconsistent'
    | 'silent'
    | 'discover-absent'
    | 'discover-existing'
    | 'discover-extra'
    | 'admin'
    | 'admin-wrong-key' = 'good'
): {
  ssh: {
    openProductBootstrapChannel: ReturnType<typeof vi.fn<SshManager['openProductBootstrapChannel']>>
  }
  channel: EventEmitter & { writes: Buffer[]; destroy: ReturnType<typeof vi.fn<() => void>> }
} {
  const channel = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    writes: [] as Buffer[],
    destroy: vi.fn<() => void>(),
    write: vi.fn((value: Buffer) => {
      channel.writes.push(value)
      return true
    }),
    end: vi.fn(() => {
      queueMicrotask(() => {
        if (kind === 'silent') return
        if (kind === 'close') {
          channel.emit('close')
          return
        }
        if (kind === 'stderr') {
          channel.stderr.emit('data', Buffer.alloc(4097))
          return
        }
        if (kind === 'large') {
          channel.emit('data', Buffer.alloc(20000))
          return
        }
        const body = Buffer.from(
          JSON.stringify(
            kind === 'admin' || kind === 'admin-wrong-key'
              ? {
                  state: 'admin_result',
                  request_key:
                    kind === 'admin' ? locator.request_key : '22222222-2222-4222-8222-222222222222',
                  result: { ok: true, data: { value: 'x'.repeat(32768) } }
                }
              : kind === 'discover-absent'
                ? { state: 'absent' }
                : kind === 'discover-existing' || kind === 'discover-extra'
                  ? {
                      state: 'discovered',
                      ...locator,
                      ...(kind === 'discover-extra' ? { path: '/untrusted' } : {})
                    }
                  : kind === 'error'
                    ? { state: 'error', code: 'SYNTHETIC_RAW_REMOTE_DATA' }
                    : kind === 'inconsistent'
                      ? {
                          state: 'installation_result',
                          request_key: locator.request_key,
                          installation: {
                            format: 1,
                            request_key: locator.request_key,
                            phase: 'installed',
                            controller_id: null,
                            service_state: 'running',
                            runtime_uid: null,
                            service_enabled: true,
                            artifact_path: '/opt/controller/payload/control-plane.cjs',
                            node_path: '/opt/controller/node',
                            data_directory: '/var/lib/controller',
                            payload_sha256: 'c'.repeat(64)
                          }
                        }
                      : {
                          ...locator,
                          state: 'absent',
                          completed_files: 0,
                          total_files: 0,
                          ...(kind === 'raw' ? { secret: 'SYNTHETIC_RAW_REMOTE_DATA' } : {}),
                          ...(kind === 'mismatch'
                            ? { request_key: '22222222-2222-4222-8222-222222222222' }
                            : {})
                        }
          )
        )
        const header = Buffer.alloc(4)
        header.writeUInt32BE(body.length)
        channel.emit('data', Buffer.concat([header, body]))
        channel.emit('close')
      })
    })
  })
  const open = vi.fn<SshManager['openProductBootstrapChannel']>(async () => ({
    channel: channel as unknown as ClientChannel,
    identity
  }))
  return { ssh: { openProductBootstrapChannel: open }, channel }
}
describe('Fixed pinned SSH controller bootstrap client', () => {
  const adminRequest = (): InstalledControllerAdminRequest => ({
    format: 1 as const,
    operation: 'admin' as const,
    authority: {
      ...locator,
      controller_id: '33333333-3333-4333-8333-333333333333',
      runtime_uid: 1001,
      payload_sha256: 'c'.repeat(64)
    },
    command: { operation: 'status' as const, payload: {} }
  })
  it('admin accepts bounded 32KiB replies while keeping a 4KiB header and immutable request bytes', async () => {
    const { ssh, channel } = fixture('admin'),
      request = adminRequest()
    const input = {
      ssh,
      vpsId: 1,
      expectedIdentity: identity,
      locator,
      assertCurrent: () => {},
      request
    }
    const pending = administerInstalledController(input)
    request.authority.runtime_uid = 0
    await expect(pending).resolves.toMatchObject({ ok: true, data: { value: 'x'.repeat(32768) } })
    const bytes = Buffer.concat(channel.writes),
      headerSize = bytes.readUInt32BE(0)
    const header = JSON.parse(bytes.subarray(4, 4 + headerSize).toString())
    expect(header).toMatchObject({ operation: 'admin', ...locator })
    expect(headerSize).toBeLessThan(4096)
    const body = bytes.subarray(4 + headerSize)
    expect(header.request_size).toBe(body.length)
    expect(JSON.parse(body.toString()).authority.runtime_uid).toBe(1001)
  })
  it('rejects a mismatched admin reply key and does not replay the command', async () => {
    const { ssh } = fixture('admin-wrong-key')
    await expect(
      administerInstalledController({
        ssh,
        vpsId: 1,
        expectedIdentity: identity,
        locator,
        assertCurrent: () => {},
        request: adminRequest()
      })
    ).rejects.toMatchObject({ code: 'BOOTSTRAP_OUTCOME_UNKNOWN' })
    expect(ssh.openProductBootstrapChannel).toHaveBeenCalledTimes(1)
  })
  it.each(['root-uid', 'foreign-path', 'unknown-command', 'wrong-pin', 'large'] as const)(
    'rejects admin %s before opening SSH',
    async (kind) => {
      const { ssh } = fixture('admin')
      const request = adminRequest() as unknown as Record<string, unknown>
      if (kind === 'root-uid') (request.authority as Record<string, unknown>).runtime_uid = 0
      if (kind === 'foreign-path') request.artifact_path = '/foreign'
      if (kind === 'unknown-command') request.command = { operation: 'exec', payload: {} }
      if (kind === 'wrong-pin')
        (request.authority as Record<string, unknown>).installer_sha256 = 'f'.repeat(64)
      if (kind === 'large')
        request.command = { operation: 'register-vps', payload: { value: 'x'.repeat(512 * 1024) } }
      await expect(
        administerInstalledController({
          ssh,
          vpsId: 1,
          expectedIdentity: identity,
          locator,
          assertCurrent: () => {},
          request: request as unknown as ReturnType<typeof adminRequest>
        })
      ).rejects.toMatchObject({ code: 'BOOTSTRAP_INPUT_INVALID' })
      expect(ssh.openProductBootstrapChannel).not.toHaveBeenCalled()
    }
  )
  it.each(['discover-absent', 'discover-existing'] as const)(
    'readonly %s has no caller locator or consent',
    async (kind) => {
      const { ssh, channel } = fixture(kind)
      const response = await discoverControllerBootstrap({
        ssh,
        vpsId: 1,
        expectedIdentity: identity,
        assertCurrent: () => {}
      })
      expect(response.state).toBe(kind === 'discover-absent' ? 'absent' : 'discovered')
      expect(JSON.parse(Buffer.concat(channel.writes).subarray(4).toString())).toEqual({
        format: 1,
        operation: 'discover'
      })
    }
  )
  it('rejects extra remote discovery fields without executing anything else', async () => {
    const { ssh } = fixture('discover-extra')
    await expect(
      discoverControllerBootstrap({
        ssh,
        vpsId: 1,
        expectedIdentity: identity,
        assertCurrent: () => {}
      })
    ).rejects.toMatchObject({ code: 'BOOTSTRAP_UNAVAILABLE', remote_effects_possible: false })
    expect(ssh.openProductBootstrapChannel).toHaveBeenCalledTimes(1)
  })
  it('renders only compiled policy constants and exact script digest', () => {
    const code = controllerBootstrapScript()
    expect(code.text).not.toContain('APPROVED_LOCK_SHA = ""')
    expect(code.text).toContain('better-sqlite3')
    expect(code.text).toContain('/var/lib/opspilot-controller-transfer')
    expect(Buffer.byteLength(code.text)).toBeLessThan(64 * 1024)
    expect(code.sha256).toBe(createHash('sha256').update(code.text).digest('hex'))
  })
  it('sends bounded readonly locator with mandatory exact pinned identity', async () => {
    const { ssh, channel } = fixture()
    await expect(
      callControllerBootstrap({
        ssh,
        vpsId: 1,
        expectedIdentity: identity,
        locator,
        assertCurrent: () => {},
        operation: 'status'
      })
    ).resolves.toMatchObject({ state: 'absent' })
    expect(ssh.openProductBootstrapChannel.mock.calls[0][2]?.expectedIdentity).toEqual(identity)
    const wire = Buffer.concat(channel.writes)
    expect(JSON.parse(wire.subarray(4).toString())).toEqual({
      format: 1,
      operation: 'status',
      ...locator
    })
    expect(channel.destroy).toHaveBeenCalled()
  })
  it.each(['install', 'recover'] as const)(
    'requires consent for %s before opening SSH',
    async (operation) => {
      const { ssh } = fixture()
      await expect(
        callControllerBootstrap({
          ssh,
          vpsId: 1,
          expectedIdentity: identity,
          locator,
          assertCurrent: () => {},
          operation
        })
      ).rejects.toMatchObject({ code: 'BOOTSTRAP_INPUT_INVALID', remote_effects_possible: false })
      expect(ssh.openProductBootstrapChannel).not.toHaveBeenCalled()
    }
  )
  it('rejects bad local artifacts before authenticating or sending anything', async () => {
    const { ssh } = fixture()
    await expect(
      transferControllerRelease({
        ssh,
        vpsId: 1,
        expectedIdentity: identity,
        locator,
        assertCurrent: () => {},
        consent: true,
        artifacts: { release_directory: 'missing', installer_path: 'missing' }
      })
    ).rejects.toMatchObject({ code: 'BOOTSTRAP_ARTIFACT_CHANGED', remote_effects_possible: false })
    expect(ssh.openProductBootstrapChannel).not.toHaveBeenCalled()
  })
  it('fences authority both before SSH and after asynchronous channel open', async () => {
    const { ssh, channel } = fixture()
    let calls = 0
    await expect(
      callControllerBootstrap({
        ssh,
        vpsId: 1,
        expectedIdentity: identity,
        locator,
        assertCurrent: () => {
          if (++calls === 2) throw Error('SYNTHETIC')
        },
        operation: 'status'
      })
    ).rejects.toMatchObject({ code: 'BOOTSTRAP_AUTHORITY_CHANGED', remote_effects_possible: false })
    expect(channel.writes).toHaveLength(0)
  })
  it.each(['large', 'stderr', 'raw', 'mismatch', 'error', 'close'] as const)(
    'rejects unsafe/missing response without reflecting remote bytes: %s',
    async (kind) => {
      const { ssh } = fixture(kind)
      await expect(
        callControllerBootstrap({
          ssh,
          vpsId: 1,
          expectedIdentity: identity,
          locator,
          assertCurrent: () => {},
          operation: 'status'
        })
      ).rejects.toThrow(/^BOOTSTRAP_[A-Z_]+$/)
    }
  )
  it('marks a lost install response unknown and never automatically opens another channel', async () => {
    const { ssh } = fixture('close')
    await expect(
      callControllerBootstrap({
        ssh,
        vpsId: 1,
        expectedIdentity: identity,
        locator,
        assertCurrent: () => {},
        operation: 'install',
        consent: true
      })
    ).rejects.toMatchObject({ code: 'BOOTSTRAP_OUTCOME_UNKNOWN', remote_effects_possible: true })
    expect(ssh.openProductBootstrapChannel).toHaveBeenCalledTimes(1)
  })
  it('sanitizes errors during channel opening and refuses pre-aborted requests', async () => {
    const { ssh } = fixture()
    ssh.openProductBootstrapChannel.mockRejectedValueOnce(Error('SYNTHETIC_SECRET_STDERR'))
    await expect(
      callControllerBootstrap({
        ssh,
        vpsId: 1,
        expectedIdentity: identity,
        locator,
        assertCurrent: () => {},
        operation: 'status'
      })
    ).rejects.toThrow(/^BOOTSTRAP_UNAVAILABLE$/)
    const abort = new AbortController()
    abort.abort()
    ssh.openProductBootstrapChannel.mockClear()
    await expect(
      callControllerBootstrap({
        ssh,
        vpsId: 1,
        expectedIdentity: identity,
        locator,
        assertCurrent: () => {},
        operation: 'status',
        signal: abort.signal
      })
    ).rejects.toMatchObject({ code: 'BOOTSTRAP_ABORTED' })
    expect(ssh.openProductBootstrapChannel).not.toHaveBeenCalled()
  })
  it('keeps locator immutable when caller edits its object during channel open', async () => {
    const { ssh, channel } = fixture()
    const alias = { ...locator }
    const result = callControllerBootstrap({
      ssh,
      vpsId: 1,
      expectedIdentity: identity,
      locator: alias,
      assertCurrent: () => {},
      operation: 'status'
    })
    alias.request_key = '22222222-2222-4222-8222-222222222222'
    await expect(result).resolves.toMatchObject({ request_key: locator.request_key })
    expect(JSON.parse(Buffer.concat(channel.writes).subarray(4).toString()).request_key).toBe(
      locator.request_key
    )
  })
  it('does not accept an installed/running claim without controller identity and service UID', async () => {
    const { ssh } = fixture('inconsistent')
    await expect(
      callControllerBootstrap({
        ssh,
        vpsId: 1,
        expectedIdentity: identity,
        locator,
        assertCurrent: () => {},
        operation: 'inspect'
      })
    ).rejects.toMatchObject({ code: 'BOOTSTRAP_UNAVAILABLE' })
  })
  it('destroys a silent channel at the hard overall deadline', async () => {
    vi.useFakeTimers()
    try {
      const { ssh, channel } = fixture('silent')
      const result = callControllerBootstrap({
        ssh,
        vpsId: 1,
        expectedIdentity: identity,
        locator,
        assertCurrent: () => {},
        operation: 'status'
      })
      const rejected = expect(result).rejects.toMatchObject({
        code: 'BOOTSTRAP_OUTCOME_UNKNOWN',
        remote_effects_possible: false
      })
      await vi.advanceTimersByTimeAsync(20 * 60 * 1000)
      await rejected
      expect(channel.destroy).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
