import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const MASTER_KEY_LENGTH = 32

export interface EncryptedCredential {
  crypto_scheme: 'aes_256_gcm'
  encrypted_secret: Buffer
  iv: Buffer
  auth_tag: Buffer
}

export interface CredentialCipher {
  encrypt(secret: string): EncryptedCredential
}

export class AesGcmCredentialCipher implements CredentialCipher {
  private readonly masterKey: Buffer

  constructor(masterKey: Buffer) {
    if (masterKey.length !== MASTER_KEY_LENGTH) {
      throw new Error('Master key AES-256-GCM phải dài đúng 32 byte.')
    }

    this.masterKey = Buffer.from(masterKey)
  }

  encrypt(secret: string): EncryptedCredential {
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv, {
      authTagLength: AUTH_TAG_LENGTH
    })
    const encryptedSecret = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])

    return {
      crypto_scheme: 'aes_256_gcm',
      encrypted_secret: encryptedSecret,
      iv,
      auth_tag: cipher.getAuthTag()
    }
  }

  decrypt(credential: EncryptedCredential): string {
    const decipher = createDecipheriv(ALGORITHM, this.masterKey, credential.iv, {
      authTagLength: AUTH_TAG_LENGTH
    })
    decipher.setAuthTag(credential.auth_tag)

    return Buffer.concat([decipher.update(credential.encrypted_secret), decipher.final()]).toString(
      'utf8'
    )
  }
}
