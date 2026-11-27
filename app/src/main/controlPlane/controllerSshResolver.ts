import type Database from 'better-sqlite3'
import type { ProductDispatchTargetBinding } from '../../../../docs/contracts/product-auto-deploy'
import type { SshConfigResolver } from '../ssh/manager'
import { decryptControllerCredential, loadControllerCredentialCipher } from './controllerSecrets'

type ControllerSshRow = ProductDispatchTargetBinding & {
  archived_at: string | null
  crypto_scheme: string
  encrypted_secret: Buffer
  iv: Buffer | null
  auth_tag: Buffer | null
}

/** Controller database only. Never accepts Desktop safeStorage or unbound legacy credentials. */
export function createControllerSshResolver(
  database: Database.Database,
  controllerId: string,
  secretDirectory: string
): SshConfigResolver {
  if (
    typeof controllerId !== 'string' ||
    !/^[A-Za-z0-9]/.test(controllerId) ||
    /[^A-Za-z0-9_.-]/.test(controllerId) ||
    controllerId.length > 128
  )
    throw new Error('CONTROLLER_SSH_IDENTITY_INVALID')

  return (vpsId) => {
    if (!Number.isSafeInteger(vpsId) || vpsId < 1)
      throw new Error('CONTROLLER_SSH_IDENTITY_INVALID')
    let row: ControllerSshRow | undefined
    try {
      row = database
        .prepare(
          `SELECT id AS vps_id, host, port, username, auth_type, host_fingerprint,
                  ssh_security_revision, archived_at, crypto_scheme, encrypted_secret, iv, auth_tag
             FROM vps WHERE id = ?`
        )
        .get(vpsId) as ControllerSshRow | undefined
    } catch {
      throw new Error('CONTROLLER_SSH_PROFILE_UNAVAILABLE')
    }
    if (!row || row.archived_at !== null) throw new Error('CONTROLLER_SSH_PROFILE_UNAVAILABLE')
    if (
      !validPrincipal(row.host, 253) ||
      !validPrincipal(row.username, 128) ||
      !Number.isSafeInteger(row.port) ||
      row.port < 1 ||
      row.port > 65535 ||
      !Number.isSafeInteger(row.ssh_security_revision) ||
      row.ssh_security_revision < 1 ||
      (row.auth_type !== 'key' && row.auth_type !== 'password') ||
      typeof row.host_fingerprint !== 'string' ||
      row.host_fingerprint.length !== 50 ||
      !/^SHA256:[A-Za-z0-9+/]{43}$/.test(row.host_fingerprint)
    )
      throw new Error('CONTROLLER_SSH_IDENTITY_INVALID')

    const target: ProductDispatchTargetBinding = {
      vps_id: row.vps_id,
      host: row.host,
      port: row.port,
      username: row.username,
      auth_type: row.auth_type,
      host_fingerprint: row.host_fingerprint,
      ssh_security_revision: row.ssh_security_revision
    }
    try {
      if (
        row.crypto_scheme !== 'aes_256_gcm' ||
        !Buffer.isBuffer(row.encrypted_secret) ||
        row.encrypted_secret.length === 0 ||
        !Buffer.isBuffer(row.iv) ||
        !Buffer.isBuffer(row.auth_tag)
      )
        throw new Error('INVALID_CREDENTIAL_ENVELOPE')
      const secret = decryptControllerCredential(
        loadControllerCredentialCipher(secretDirectory),
        { controller_id: controllerId, target },
        {
          crypto_scheme: 'aes_256_gcm',
          encrypted_secret: row.encrypted_secret,
          iv: row.iv,
          auth_tag: row.auth_tag
        }
      )
      return {
        host: target.host,
        port: target.port,
        hostFingerprint: target.host_fingerprint,
        username: target.username,
        authType: target.auth_type,
        secret
      }
    } catch {
      throw new Error('CONTROLLER_SSH_CREDENTIAL_UNAVAILABLE')
    }
  }
}

function validPrincipal(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/\s/.test(value) &&
    [...value].every((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127)
  )
}
