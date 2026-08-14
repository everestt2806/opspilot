import type Database from 'better-sqlite3'

import { AppError } from '../errors'
import type { AesGcmCredentialCipher, EncryptedCredential } from './credentialCipher'

interface VpsCredentialRow {
  crypto_scheme: string
  encrypted_secret: Buffer
  iv: Buffer
  auth_tag: Buffer
}

/** Nửa "đọc" của M2: giải mã credential của một VPS, chỉ gọi trong main process,
 *  bản rõ nằm trong RAM ngắn hạn, không bao giờ đưa vào renderer hay log. */
export function loadSecret(
  database: Database.Database,
  cipher: AesGcmCredentialCipher,
  vpsId: number
): string {
  const row = database
    .prepare('SELECT crypto_scheme, encrypted_secret, iv, auth_tag FROM vps WHERE id = ?')
    .get(vpsId) as VpsCredentialRow | undefined

  if (!row) {
    throw new AppError('VALIDATION', 'Không tìm thấy VPS. Hãy tải lại danh sách rồi thử lại.')
  }

  if (row.crypto_scheme !== 'aes_256_gcm') {
    throw new AppError(
      'DB_ERROR',
      `Dữ liệu VPS đang dùng khoá lạ: ${row.crypto_scheme}. Hãy nhập lại credential rồi lưu.`
    )
  }

  try {
    return cipher.decrypt(toEncryptedCredential(row))
  } catch (cause) {
    throw new AppError(
      'SSH_AUTH_FAILED',
      'Không giải mã được credential của VPS. Hãy nhập lại credential rồi lưu và thử lại.',
      { cause }
    )
  }
}

function toEncryptedCredential(row: VpsCredentialRow): EncryptedCredential {
  return {
    crypto_scheme: 'aes_256_gcm',
    encrypted_secret: row.encrypted_secret,
    iv: row.iv,
    auth_tag: row.auth_tag
  }
}
