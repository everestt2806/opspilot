import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { AesGcmCredentialCipher, type EncryptedCredential } from '../crypto/credentialCipher'
import type { ProductDispatchTargetBinding } from '../../../../docs/contracts/product-auto-deploy'
import { canonicalH2Json } from './productH2Proof'

const KEY_FILE = '.controller-runtime-key'
export type ControllerCredentialBinding = Readonly<{
  controller_id: string
  target: ProductDispatchTargetBinding
}>

/** Explicit initialization only. A missing key is never silently regenerated on load. */
export function initializeControllerSecretKey(directory: string): void {
  const root = resolveControllerSecretDirectory(directory)
  const key = randomBytes(32)
  let fd: number | undefined
  try {
    fd = openSync(
      join(root, KEY_FILE),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    )
    writeFileSync(fd, key)
    fsyncSync(fd)
    const parent = openSync(root, constants.O_RDONLY)
    try {
      fsyncSync(parent)
    } finally {
      closeSync(parent)
    }
  } catch {
    throw new Error('CONTROLLER_SECRET_KEY_INITIALIZATION_FAILED')
  } finally {
    key.fill(0)
    if (fd !== undefined) closeSync(fd)
  }
}

export function loadControllerCredentialCipher(directory: string): AesGcmCredentialCipher {
  const root = resolveControllerSecretDirectory(directory)
  let fd: number | undefined
  let key: Buffer | undefined
  try {
    fd = openSync(join(root, KEY_FILE), constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = fstatSync(fd)
    if (
      !info.isFile() ||
      info.uid !== process.getuid?.() ||
      info.nlink !== 1 ||
      info.size !== 32 ||
      (info.mode & 0o077) !== 0
    )
      throw new Error('INVALID_PRIVATE_KEY_FILE')
    key = readFileSync(fd)
    if (key.length !== 32) throw new Error('INVALID_PRIVATE_KEY_FILE')
    return new AesGcmCredentialCipher(key)
  } catch {
    throw new Error('CONTROLLER_SECRET_KEY_UNAVAILABLE')
  } finally {
    key?.fill(0)
    if (fd !== undefined) closeSync(fd)
  }
}

/** The SSH identity is authenticated inside ciphertext; swapping DB rows cannot rebind a secret. */
export function encryptControllerCredential(
  cipher: AesGcmCredentialCipher,
  binding: ControllerCredentialBinding,
  secret: string
): EncryptedCredential {
  if (typeof secret !== 'string' || !secret.length || Buffer.byteLength(secret) > 256 * 1024)
    throw new Error('CONTROLLER_CREDENTIAL_INVALID')
  return cipher.encrypt(JSON.stringify({ format: 1, binding, secret }))
}

export function decryptControllerCredential(
  cipher: AesGcmCredentialCipher,
  binding: ControllerCredentialBinding,
  encrypted: EncryptedCredential
): string {
  try {
    if (
      encrypted.crypto_scheme !== 'aes_256_gcm' ||
      encrypted.iv.length !== 12 ||
      encrypted.auth_tag.length !== 16 ||
      encrypted.encrypted_secret.length > 512 * 1024
    )
      throw new Error('INVALID_CREDENTIAL_ENVELOPE')
    const payload = JSON.parse(cipher.decrypt(encrypted))
    if (
      !payload ||
      Object.keys(payload).sort().join(',') !== 'binding,format,secret' ||
      payload.format !== 1 ||
      typeof payload.secret !== 'string' ||
      !payload.secret.length ||
      canonicalH2Json(payload.binding) !== canonicalH2Json(binding)
    )
      throw new Error('INVALID_CREDENTIAL_BINDING')
    return payload.secret
  } catch {
    // Never include decrypted content, key bytes, paths or crypto-library messages.
    throw new Error('CONTROLLER_CREDENTIAL_UNAVAILABLE')
  }
}

/** Internal shared check for the Linux controller's protected material directory. */
export function resolveControllerSecretDirectory(input: string): string {
  if (process.platform !== 'linux') throw new Error('CONTROLLER_SECRET_STORE_REQUIRES_LINUX')
  try {
    if (typeof input !== 'string' || !input.trim()) throw new Error('MISSING_DIRECTORY')
    const root = resolve(input)
    const info = lstatSync(root)
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o077) !== 0
    )
      throw new Error('INVALID_PRIVATE_DIRECTORY')
    return realpathSync(root)
  } catch {
    throw new Error('CONTROLLER_SECRET_DIRECTORY_INVALID')
  }
}
