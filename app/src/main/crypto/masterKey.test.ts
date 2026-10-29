import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  available: true,
  failDecrypt: false,
  isEncryptionAvailable: vi.fn(() => storage.available),
  encryptString: vi.fn((value: string) => Buffer.from(value)),
  decryptString: vi.fn((value: Buffer) => {
    if (storage.failDecrypt) throw new Error('fixture decrypt failure')
    return value.toString('utf8')
  })
}))

vi.mock('electron', () => ({ safeStorage: storage }))

import { loadExistingCredentialCipher } from './masterKey'

let directory: string | null = null

afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = null
  storage.available = true
  storage.failDecrypt = false
  vi.clearAllMocks()
})

function makeProfile(key = randomBytes(32)): { path: string; key: Buffer } {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-existing-key-'))
  const keyPath = join(directory, 'credential-master-key.protected')
  const protectedValue = Buffer.from(key.toString('base64')).toString('base64')
  writeFileSync(keyPath, protectedValue, 'utf8')
  return { path: directory, key }
}

describe('loadExistingCredentialCipher', () => {
  it('mở khóa key đang có', () => {
    const profile = makeProfile()
    const cipher = loadExistingCredentialCipher(profile.path)
    const encrypted = cipher.encrypt('credential fixture')
    expect(cipher.decrypt(encrypted)).toBe('credential fixture')
    expect(readFileSync(join(profile.path, 'credential-master-key.protected'), 'utf8')).toBe(
      Buffer.from(profile.key.toString('base64')).toString('base64')
    )
  })

  it('từ chối file key không giải mã được mà không thay file', () => {
    const profile = makeProfile()
    const keyPath = join(profile.path, 'credential-master-key.protected')
    const before = readFileSync(keyPath)
    storage.failDecrypt = true
    expect(() => loadExistingCredentialCipher(profile.path)).toThrow('DB_ERROR')
    expect(readFileSync(keyPath)).toEqual(before)
  })

  it('dừng khi thiếu key, không tự sinh key mới', () => {
    directory = mkdtempSync(join(tmpdir(), 'opspilot-no-key-'))
    expect(() => loadExistingCredentialCipher(directory!)).toThrow('DB_ERROR')
    expect(existsSync(join(directory!, 'credential-master-key.protected'))).toBe(false)
  })
})
