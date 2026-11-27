import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import type { ProductClaimToken } from '../../../../docs/contracts/product-auto-deploy'
import { canonicalH2Json } from './productH2Proof'
import {
  loadControllerCredentialCipher,
  resolveControllerSecretDirectory
} from './controllerSecrets'

export type ControllerRuntimeKeyIdentity = Pick<
  ProductClaimToken,
  'controller_id' | 'app_id' | 'ownership_generation'
>
const PURPOSE = 'product-h2-runtime'

/** Explicit provisioning only; an existing record, even a damaged one, is never replaced. */
export function createControllerRuntimeKey(
  directory: string,
  input: ControllerRuntimeKeyIdentity
): Buffer {
  const identity = validateIdentity(input)
  const root = resolveControllerSecretDirectory(directory)
  const cipher = loadControllerCredentialCipher(root)
  const key = randomBytes(32)
  let fd: number | undefined
  try {
    const encrypted = cipher.encrypt(
      JSON.stringify({ format: 1, purpose: PURPOSE, identity, key: key.toString('base64') })
    )
    const serialized = JSON.stringify({
      format: 1,
      crypto_scheme: encrypted.crypto_scheme,
      encrypted_secret: encrypted.encrypted_secret.toString('base64'),
      iv: encrypted.iv.toString('base64'),
      auth_tag: encrypted.auth_tag.toString('base64')
    })
    fd = openSync(
      join(root, recordName(identity)),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    )
    writeFileSync(fd, serialized)
    fsyncSync(fd)
    const parent = openSync(root, constants.O_RDONLY)
    try {
      fsyncSync(parent)
    } finally {
      closeSync(parent)
    }
    return Buffer.from(key)
  } catch {
    throw new Error('CONTROLLER_RUNTIME_KEY_CREATION_FAILED')
  } finally {
    key.fill(0)
    if (fd !== undefined) closeSync(fd)
  }
}

/** Recovery reads exact historical material. Missing/corrupt records never generate a new key. */
export function loadControllerRuntimeKey(
  directory: string,
  input: ControllerRuntimeKeyIdentity
): Buffer {
  const identity = validateIdentity(input)
  const root = resolveControllerSecretDirectory(directory)
  let fd: number | undefined
  let key: Buffer | undefined
  try {
    const cipher = loadControllerCredentialCipher(root)
    fd = openSync(join(root, recordName(identity)), constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = fstatSync(fd)
    if (
      !info.isFile() ||
      info.uid !== process.getuid?.() ||
      info.nlink !== 1 ||
      info.size < 1 ||
      info.size > 8192 ||
      (info.mode & 0o077) !== 0
    )
      throw new Error('INVALID_KEY_FILE')
    const contents = readFileSync(fd)
    if (contents.length > 8192) throw new Error('INVALID_KEY_FILE')
    const record = JSON.parse(contents.toString('utf8'))
    if (
      !record ||
      Object.keys(record).sort().join(',') !==
        'auth_tag,crypto_scheme,encrypted_secret,format,iv' ||
      record.format !== 1 ||
      record.crypto_scheme !== 'aes_256_gcm'
    )
      throw new Error('INVALID_KEY_ENVELOPE')
    const payload = JSON.parse(
      cipher.decrypt({
        crypto_scheme: 'aes_256_gcm',
        encrypted_secret: decodeBase64(record.encrypted_secret, 4096),
        iv: decodeBase64(record.iv, 12, 12),
        auth_tag: decodeBase64(record.auth_tag, 16, 16)
      })
    )
    if (
      !payload ||
      Object.keys(payload).sort().join(',') !== 'format,identity,key,purpose' ||
      payload.format !== 1 ||
      payload.purpose !== PURPOSE ||
      canonicalH2Json(payload.identity) !== canonicalH2Json(identity)
    )
      throw new Error('INVALID_KEY_BINDING')
    key = decodeBase64(payload.key, 32, 32)
    return key
  } catch {
    key?.fill(0)
    throw new Error('CONTROLLER_RUNTIME_KEY_UNAVAILABLE')
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function validateIdentity(input: ControllerRuntimeKeyIdentity): ControllerRuntimeKeyIdentity {
  if (
    !input ||
    typeof input.controller_id !== 'string' ||
    input.controller_id.length > 128 ||
    !/^[A-Za-z0-9]/.test(input.controller_id) ||
    /[^A-Za-z0-9_.:-]/.test(input.controller_id) ||
    !Number.isSafeInteger(input.app_id) ||
    input.app_id < 1 ||
    !Number.isSafeInteger(input.ownership_generation) ||
    input.ownership_generation < 1
  )
    throw new Error('CONTROLLER_RUNTIME_KEY_IDENTITY_INVALID')
  return {
    controller_id: input.controller_id,
    app_id: input.app_id,
    ownership_generation: input.ownership_generation
  }
}

function recordName(identity: ControllerRuntimeKeyIdentity): string {
  const controller = createHash('sha256').update(identity.controller_id).digest('hex')
  return `h2-${controller}-app-${identity.app_id}-g-${identity.ownership_generation}.json`
}

function decodeBase64(value: unknown, maximum: number, exact?: number): Buffer {
  if (typeof value !== 'string' || value.length > Math.ceil(maximum / 3) * 4)
    throw new Error('INVALID_KEY_ENCODING')
  const buffer = Buffer.from(value, 'base64')
  if (
    buffer.length > maximum ||
    (exact !== undefined && buffer.length !== exact) ||
    buffer.toString('base64') !== value
  )
    throw new Error('INVALID_KEY_ENCODING')
  return buffer
}
