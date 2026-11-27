import { describe, expect, it, vi } from 'vitest'
import type { Vps } from '@shared/ipc'
import type { SshManager } from '../ssh/manager'
import { VpsRuntimePreparationService, PREPARE_RUNTIME_COMMAND } from './runtimePreparation'

const vps: Vps = {
  id: 1,
  name: 'Demo',
  host: 'test.invalid',
  port: 22,
  host_fingerprint: 'SHA256:' + 'A'.repeat(43),
  username: 'root',
  auth_type: 'password',
  provider: null,
  region: null,
  docker_version: null,
  last_status: 'unknown',
  last_seen_at: null,
  created_at: '2026-11-18T00:00:00Z'
}
const output =
  'DOCKER_VERSION=Docker version 29.5.3, build fixture\nCOMPOSE_VERSION=2.40.3\nINSTALLED_DOCKER=0\n'
function fixture(): {
  exec: ReturnType<typeof vi.fn<SshManager['execWithHostIdentity']>>
  repository: { getById: ReturnType<typeof vi.fn<() => Vps>> }
  service: { recordDockerInstalled: ReturnType<typeof vi.fn<() => Vps>> }
  subject: VpsRuntimePreparationService
} {
  const exec = vi.fn<SshManager['execWithHostIdentity']>(async () => ({
    identity: { vpsId: 1, host: vps.host, port: 22, hostFingerprint: vps.host_fingerprint! },
    result: { code: 0, stdout: output, stderr: '' }
  }))
  const repository = { getById: vi.fn(() => ({ ...vps })) }
  const service = { recordDockerInstalled: vi.fn(() => vps) }
  return {
    exec,
    repository,
    service,
    subject: new VpsRuntimePreparationService({ execWithHostIdentity: exec }, repository, service)
  }
}
describe('VPS runtime preparation', () => {
  it('requires explicit consent before any connection', () => {
    const f = fixture()
    expect(() =>
      f.subject.prepare({ vps_id: 1, consent: false } as unknown as {
        vps_id: number
        consent: true
      })
    ).toThrow('VALIDATION')
    expect(f.exec).not.toHaveBeenCalled()
  })
  it('sends only a fixed command fenced to the saved host and principal, without reconnect replay', async () => {
    const f = fixture()
    expect(await f.subject.prepare({ vps_id: 1, consent: true })).toMatchObject({
      vps_id: 1,
      installed_docker: false,
      workdir_ready: true,
      docker_version: '29.5.3, build fixture',
      compose_version: '2.40.3'
    })
    expect(f.exec).toHaveBeenCalledWith(
      1,
      PREPARE_RUNTIME_COMMAND,
      expect.objectContaining({ retryOnReconnect: false, logCommand: false, timeoutMs: 660000 }),
      expect.objectContaining({
        hostFingerprint: vps.host_fingerprint,
        username: 'root',
        authType: 'password'
      })
    )
    expect(f.service.recordDockerInstalled).toHaveBeenCalledExactlyOnceWith(
      1,
      '29.5.3, build fixture'
    )
  })
  it('coalesces concurrent requests and permits a new verified check after completion', async () => {
    const f = fixture()
    const a = f.subject.prepare({ vps_id: 1, consent: true })
    const b = f.subject.prepare({ vps_id: 1, consent: true })
    expect(a).toBe(b)
    await a
    await f.subject.prepare({ vps_id: 1, consent: true })
    expect(f.exec).toHaveBeenCalledTimes(2)
  })
  it('refuses a different profile while preparation is in flight', async () => {
    const f = fixture()
    const a = f.subject.prepare({ vps_id: 1, consent: true })
    f.repository.getById.mockReturnValue({ ...vps, host: 'changed.invalid' })
    expect(() => f.subject.prepare({ vps_id: 1, consent: true })).toThrow('VALIDATION')
    await expect(a).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(f.service.recordDockerInstalled).not.toHaveBeenCalled()
  })
  it.each([41, 43, 44, 45, 46, 47, 48, 49, 50, 51])(
    'maps exit %s without leaking raw installer output',
    async (code) => {
      const f = fixture()
      f.exec.mockResolvedValueOnce({
        identity: { vpsId: 1, host: vps.host, port: 22, hostFingerprint: vps.host_fingerprint! },
        result: { code, stdout: 'synthetic-sensitive-output', stderr: 'synthetic-sensitive-output' }
      })
      const error = await f.subject.prepare({ vps_id: 1, consent: true }).catch((e) => e)
      expect(error.code).toBe('DOCKER_MISSING')
      expect(JSON.stringify(error)).not.toContain('synthetic-sensitive-output')
      expect(f.service.recordDockerInstalled).not.toHaveBeenCalled()
    }
  )
  it('does not record ready when SSH delivery is unknown and allows a fresh inspection later', async () => {
    const f = fixture()
    f.exec.mockRejectedValueOnce(Error('transport lost'))
    await expect(f.subject.prepare({ vps_id: 1, consent: true })).rejects.toThrow('transport lost')
    expect(f.service.recordDockerInstalled).not.toHaveBeenCalled()
    await f.subject.prepare({ vps_id: 1, consent: true })
    expect(f.exec).toHaveBeenCalledTimes(2)
  })
  it('rejects malformed success and profile drift after a response', async () => {
    const f = fixture()
    f.exec.mockResolvedValueOnce({
      identity: { vpsId: 1, host: vps.host, port: 22, hostFingerprint: vps.host_fingerprint! },
      result: { code: 0, stdout: 'unstructured', stderr: '' }
    })
    await expect(f.subject.prepare({ vps_id: 1, consent: true })).rejects.toMatchObject({
      code: 'VALIDATION'
    })
    f.repository.getById.mockReturnValueOnce(vps).mockReturnValue({ ...vps, username: 'different' })
    await expect(f.subject.prepare({ vps_id: 1, consent: true })).rejects.toMatchObject({
      code: 'VALIDATION'
    })
    expect(f.service.recordDockerInstalled).not.toHaveBeenCalled()
  })
})
