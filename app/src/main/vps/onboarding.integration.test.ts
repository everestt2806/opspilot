import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase, closeDatabase } from '../db'
import { VpsRepository } from '../db/vpsRepository'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { VpsService } from './service'
import { VpsOnboarding } from './onboarding'

let directory: string | undefined
afterEach(() => {
  closeDatabase()
  if (directory) rmSync(directory, { recursive: true })
  directory = undefined
})

function fixture(): { repository: VpsRepository; service: VpsService } {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-onboarding-'))
  const repository = new VpsRepository(initializeDatabase(directory))
  return {
    repository,
    service: new VpsService(repository, new AesGcmCredentialCipher(randomBytes(32)))
  }
}
const pin = 'SHA256:' + 'A'.repeat(43)
const input = {
  name: 'Demo',
  host: 'test.invalid',
  port: 22,
  username: 'root',
  auth_type: 'password' as const,
  secret: 'synthetic-test-credential'
}

describe('saved and archived VPS trust', () => {
  it('reconnects an archived VPS with its original id and pin without a new observation', async () => {
    const { repository, service } = fixture()
    const observe = vi.fn(async () => pin)
    const first = await new VpsOnboarding(repository, service, observe).create(input)
    repository.delete(first.id)
    expect(repository.list()).toEqual([])
    expect(repository.getEndpointFingerprint('TEST.INVALID', 22)).toBe(pin)
    const restored = await new VpsOnboarding(repository, service, observe).create({
      ...input,
      name: 'Restored'
    })
    expect(restored.id).toBe(first.id)
    expect(restored.host_fingerprint).toBe(pin)
    expect(observe).toHaveBeenCalledTimes(1)
    expect(repository.list()).toHaveLength(1)
  })
  it('rejects ambiguous legacy profiles before observing or authenticating', async () => {
    const { repository, service } = fixture()
    service.create({ ...input, host_fingerprint: pin })
    service.create({
      ...input,
      name: 'Conflicting profile',
      host_fingerprint: 'SHA256:' + 'B'.repeat(43)
    })
    const observe = vi.fn()
    const check = vi.fn()
    await expect(
      new VpsOnboarding(repository, service, observe, check).test(input)
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(observe).not.toHaveBeenCalled()
    expect(check).not.toHaveBeenCalled()
  })
})
