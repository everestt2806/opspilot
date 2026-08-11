import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

import { safeStorage } from 'electron'

import { AppError } from '../errors'
import { AesGcmCredentialCipher } from './credentialCipher'

const MASTER_KEY_FILE = 'credential-master-key.protected'
const MASTER_KEY_LENGTH = 32

export function createCredentialCipher(userDataPath: string): AesGcmCredentialCipher {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new AppError(
      'DB_ERROR',
      'Không thể mở khoá bảo mật của hệ điều hành. Hãy đăng nhập lại Windows rồi mở OpsPilot.'
    )
  }

  const keyPath = join(userDataPath, MASTER_KEY_FILE)
  const masterKey = existsSync(keyPath) ? readMasterKey(keyPath) : createMasterKey(keyPath)

  if (masterKey.length !== MASTER_KEY_LENGTH) {
    throw new AppError(
      'DB_ERROR',
      'Khoá bảo mật OpsPilot không hợp lệ. Hãy khôi phục file khoá hoặc nhập lại VPS credential.'
    )
  }

  return new AesGcmCredentialCipher(masterKey)
}

function readMasterKey(keyPath: string): Buffer {
  try {
    const protectedKey = Buffer.from(readFileSync(keyPath, 'utf8'), 'base64')
    const keyBase64 = safeStorage.decryptString(protectedKey)
    return Buffer.from(keyBase64, 'base64')
  } catch (error) {
    throw new AppError(
      'DB_ERROR',
      'Không giải mã được khoá bảo mật OpsPilot. Hãy kiểm tra Windows profile đang sử dụng.',
      { cause: error }
    )
  }
}

function createMasterKey(keyPath: string): Buffer {
  const masterKey = randomBytes(MASTER_KEY_LENGTH)
  const protectedKey = safeStorage.encryptString(masterKey.toString('base64')).toString('base64')
  const temporaryPath = `${keyPath}.tmp`

  mkdirSync(dirname(keyPath), { recursive: true })
  writeFileSync(temporaryPath, protectedKey, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporaryPath, keyPath)

  return masterKey
}
