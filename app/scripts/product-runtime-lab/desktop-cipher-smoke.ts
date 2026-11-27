import { app } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import {
  createCredentialCipher,
  loadExistingCredentialCipher
} from '../../src/main/crypto/masterKey'
import type { EncryptedCredential } from '../../src/main/crypto/credentialCipher'

void app.whenReady().then(() => {
  const [operation, directory] = process.argv.slice(2)
  if (
    !['create', 'cold'].includes(operation) ||
    !isAbsolute(directory) ||
    !/^opspilot-cipher-[a-f0-9]{32}$/.test(basename(directory))
  ) {
    app.exit(2)
    return
  }
  try {
    if (operation === 'create') {
      mkdirSync(directory, { recursive: true })
      const cipher = createCredentialCipher(directory),
        secret = randomBytes(32).toString('base64url'),
        encrypted = cipher.encrypt(secret)
      writeFileSync(
        join(directory, 'cipher-fixture.json'),
        JSON.stringify({
          encrypted_secret: encrypted.encrypted_secret.toString('base64'),
          iv: encrypted.iv.toString('base64'),
          auth_tag: encrypted.auth_tag.toString('base64'),
          digest: createHash('sha256').update(secret).digest('hex')
        })
      )
    } else {
      const stored = JSON.parse(
        readFileSync(join(directory, 'cipher-fixture.json'), 'utf8')
      ) as Record<string, string>
      const credential: EncryptedCredential = {
        crypto_scheme: 'aes_256_gcm',
        encrypted_secret: Buffer.from(stored.encrypted_secret, 'base64'),
        iv: Buffer.from(stored.iv, 'base64'),
        auth_tag: Buffer.from(stored.auth_tag, 'base64')
      }
      const value = loadExistingCredentialCipher(directory).decrypt(credential)
      if (createHash('sha256').update(value).digest('hex') !== stored.digest)
        throw new Error('CIPHER_MISMATCH')
    }
    writeFileSync(
      join(directory, operation + '-result.json'),
      JSON.stringify({ status: 'PASS', operation, electron_safe_storage: true })
    )
    app.exit(0)
  } catch {
    writeFileSync(
      join(directory, operation + '-result.json'),
      JSON.stringify({ status: 'FAIL', operation, code: 'ELECTRON_CIPHER_FAILED' })
    )
    app.exit(1)
  }
})
