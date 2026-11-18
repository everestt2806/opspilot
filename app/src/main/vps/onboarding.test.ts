import { describe, expect, it, vi } from 'vitest'
import type { Vps, VpsInput, VpsConnectionCheck } from '@shared/ipc'
import { VpsOnboarding } from './onboarding'

const pin = 'SHA256:' + 'A'.repeat(43)
const other = 'SHA256:' + 'B'.repeat(43)
const input: VpsInput = {
  name: 'Demo',
  host: 'test.invalid',
  port: 22,
  username: 'root',
  auth_type: 'password',
  secret: 'synthetic-test-credential'
}
const result: VpsConnectionCheck = {
  ssh_ok: true,
  docker_installed: false,
  docker_version: null,
  workdir_writable: false,
  steps: []
}

function fixture(known?: string): {
  onboarding: VpsOnboarding
  repository: {
    getEndpointFingerprint: ReturnType<typeof vi.fn>
    getById: ReturnType<typeof vi.fn<(id: number) => Vps>>
  }
  service: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
  observe: ReturnType<typeof vi.fn>
  check: ReturnType<typeof vi.fn>
} {
  const profile: Vps = {
    id: 1,
    name: input.name,
    host: input.host,
    port: input.port,
    username: input.username,
    auth_type: input.auth_type,
    host_fingerprint: known ?? null,
    provider: null,
    region: null,
    docker_version: null,
    last_status: 'unknown',
    last_seen_at: null,
    created_at: '2026-11-18T00:00:00Z'
  }
  const repository = {
    getEndpointFingerprint: vi.fn(() => known),
    getById: vi.fn<(id: number) => Vps>(() => profile)
  }
  const service = {
    create: vi.fn((value: VpsInput) => ({
      ...profile,
      name: value.name,
      host_fingerprint: value.host_fingerprint ?? null
    })),
    update: vi.fn((_id: number, value: Partial<VpsInput>) => ({
      ...profile,
      name: value.name ?? profile.name,
      host_fingerprint: value.host_fingerprint ?? profile.host_fingerprint
    }))
  }
  const observe = vi.fn(async () => pin)
  const check = vi.fn(async () => result)
  return {
    onboarding: new VpsOnboarding(repository, service, observe, check),
    repository,
    service,
    observe,
    check
  }
}

describe('IP/password VPS onboarding', () => {
  it('observes once, passes the pin to strict auth, and preserves it on save', async () => {
    const f = fixture()
    expect((await f.onboarding.test(input)).host_fingerprint).toBe(pin)
    expect(f.check).toHaveBeenCalledWith(
      expect.objectContaining({ hostFingerprint: pin, secret: input.secret })
    )
    await f.onboarding.create(input)
    expect(f.observe).toHaveBeenCalledExactlyOnceWith(input.host, input.port)
    expect(f.service.create).toHaveBeenCalledWith({ ...input, host_fingerprint: pin })
  })
  it('supports save directly without a manual pin or a preceding check', async () => {
    const f = fixture()
    await f.onboarding.create({ ...input, host_fingerprint: '' })
    expect(f.service.create).toHaveBeenCalledWith({ ...input, host_fingerprint: pin })
    expect(f.check).not.toHaveBeenCalled()
  })
  it('uses saved or archived identity without learning a new key', async () => {
    const f = fixture(other)
    await f.onboarding.test(input)
    expect(f.observe).not.toHaveBeenCalled()
    expect(f.check).toHaveBeenCalledWith(expect.objectContaining({ hostFingerprint: other }))
  })
  it('rejects an explicit conflicting key before auth or writes', async () => {
    const f = fixture(other)
    await expect(f.onboarding.test({ ...input, host_fingerprint: pin })).rejects.toMatchObject({
      code: 'VALIDATION'
    })
    expect(f.check).not.toHaveBeenCalled()
    expect(f.observe).not.toHaveBeenCalled()
    expect(f.service.create).not.toHaveBeenCalled()
  })
  it('cannot replace the first observed pin between test and save', async () => {
    const f = fixture()
    await f.onboarding.test(input)
    await expect(f.onboarding.create({ ...input, host_fingerprint: other })).rejects.toMatchObject({
      code: 'VALIDATION'
    })
    expect(f.service.create).not.toHaveBeenCalled()
  })
  it('shares first contact across concurrent checks', async () => {
    const f = fixture()
    await Promise.all([f.onboarding.test(input), f.onboarding.test(input)])
    expect(f.observe).toHaveBeenCalledTimes(1)
  })
  it('keeps a pin after bad credentials, but permits retry after transport failure', async () => {
    const f = fixture()
    f.check.mockRejectedValueOnce(Error('authentication failed'))
    await expect(f.onboarding.test(input)).rejects.toThrow('authentication failed')
    await f.onboarding.test(input)
    expect(f.observe).toHaveBeenCalledTimes(1)
    const g = fixture()
    g.observe.mockRejectedValueOnce(Error('unreachable'))
    await expect(g.onboarding.create(input)).rejects.toThrow('unreachable')
    await g.onboarding.create(input)
    expect(g.observe).toHaveBeenCalledTimes(2)
  })
  it('rejects a profile pin that changes while first contact is pending', async () => {
    const f = fixture()
    f.repository.getEndpointFingerprint.mockReturnValueOnce(undefined).mockReturnValue(other)
    await expect(f.onboarding.test(input)).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(f.check).not.toHaveBeenCalled()
  })
  it('preserves existing pin for rename and observes a genuinely different endpoint', async () => {
    const f = fixture(other)
    await f.onboarding.update(1, { name: 'Renamed' })
    expect(f.service.update).toHaveBeenCalledWith(1, { name: 'Renamed', host_fingerprint: other })
    f.repository.getEndpointFingerprint.mockReturnValue(undefined)
    await f.onboarding.update(1, { host: 'new.invalid' })
    expect(f.observe).toHaveBeenCalledExactlyOnceWith('new.invalid', 22)
    expect(f.service.update).toHaveBeenLastCalledWith(1, {
      host: 'new.invalid',
      host_fingerprint: pin
    })
  })
  it('validates input before any network or write', async () => {
    const f = fixture()
    await expect(f.onboarding.create({ ...input, port: 0 })).rejects.toMatchObject({
      code: 'VALIDATION'
    })
    await expect(
      f.onboarding.test({ ...input, host_fingerprint: 'invalid' })
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(f.observe).not.toHaveBeenCalled()
    expect(f.check).not.toHaveBeenCalled()
    expect(f.service.create).not.toHaveBeenCalled()
  })

  it('refuses a concurrent endpoint edit before writing a pin resolved for the old profile', async () => {
    const f = fixture()
    const original = f.repository.getById(1)
    f.repository.getById
      .mockReturnValueOnce(original)
      .mockReturnValue({ ...original, host: 'changed.invalid' })
    await expect(f.onboarding.update(1, { name: 'Renamed' })).rejects.toMatchObject({
      code: 'VALIDATION'
    })
    expect(f.service.update).not.toHaveBeenCalled()
  })
})
