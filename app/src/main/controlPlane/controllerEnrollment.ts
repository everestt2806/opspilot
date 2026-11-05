import type Database from 'better-sqlite3'
import { createHash, timingSafeEqual } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { z } from 'zod'
import {
  PRODUCT_CONTROLLER_ENROLLMENT_MAX_SECRET_BYTES,
  type ProductControllerVpsEnrollmentResult
} from '../../../../docs/contracts/product-controller-bootstrap'
import { SshManager, matchesSshHostFingerprint } from '../ssh/manager'
import {
  encryptControllerCredential,
  initializeControllerSecretKey,
  loadControllerCredentialCipher,
  resolveControllerSecretDirectory
} from './controllerSecrets'
import { createControllerSshResolver } from './controllerSshResolver'

const noControl = (value: string): boolean =>
  [...value].every((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127)
const principal = z
  .string()
  .min(1)
  .max(253)
  .refine((value) => noControl(value) && !/\s/.test(value))
const enrollmentSchema = z.strictObject({
  format: z.literal(1),
  controller_id: z
    .string()
    .min(1)
    .max(128)
    .refine((value) => /^[A-Za-z0-9]/.test(value) && !/[^A-Za-z0-9_.-]/.test(value)),
  profile: z.strictObject({
    name: z
      .string()
      .min(1)
      .max(128)
      .refine((value) => noControl(value) && value.trim() === value),
    host: principal,
    port: z.number().int().min(1).max(65535),
    username: principal.max(128),
    auth_type: z.enum(['key', 'password']),
    host_fingerprint: z
      .string()
      .length(50)
      .regex(/^SHA256:[A-Za-z0-9+/]{43}$/)
  }),
  secret: z
    .string()
    .min(1)
    .refine((value) => Buffer.byteLength(value) <= PRODUCT_CONTROLLER_ENROLLMENT_MAX_SECRET_BYTES)
})

class EnrollmentError extends Error {}

function assertController(database: Database.Database, controllerId: string): void {
  const rows = database.prepare('SELECT controller_id, status FROM product_controller').all() as {
    controller_id: string
    status: string
  }[]
  if (rows.length !== 1 || rows[0].controller_id !== controllerId || rows[0].status !== 'active')
    throw new EnrollmentError('CONTROLLER_VPS_CONTROLLER_MISMATCH')
}

/** Chỉ khởi tạo tường minh; không thay khóa còn cần để đọc dữ liệu đã lưu. */
export function initializeControllerSecrets(
  database: Database.Database,
  controllerId: string,
  directory: string
): void {
  try {
    if (database.inTransaction) throw new EnrollmentError('CONTROLLER_BOOTSTRAP_TRANSACTION_ACTIVE')
    const root = resolveControllerSecretDirectory(directory)
    database
      .transaction(() => {
        assertController(database, controllerId)
        const retained = database
          .prepare(
            `SELECT (SELECT COUNT(*) FROM vps) + (SELECT COUNT(*) FROM product_app_control) AS n`
          )
          .get() as { n: number }
        if (retained.n || readdirSync(root).some((name) => name.startsWith('h2-')))
          throw new EnrollmentError('CONTROLLER_SECRET_MATERIAL_REQUIRES_RECOVERY')
        initializeControllerSecretKey(root)
      })
      .immediate()
  } catch (error) {
    if (error instanceof EnrollmentError) throw error
    throw new Error('CONTROLLER_SECRET_INITIALIZATION_UNAVAILABLE')
  }
}

/** Xác thực SSH có pin rồi ghi local nguyên tử; không chạy lệnh hoặc enroll app trên target. */
export async function enrollControllerVps(
  database: Database.Database,
  controllerId: string,
  directory: string,
  input: unknown,
  signal?: AbortSignal
): Promise<ProductControllerVpsEnrollmentResult> {
  try {
    const parsed = enrollmentSchema.safeParse(input)
    if (!parsed.success) throw new EnrollmentError('CONTROLLER_VPS_INPUT_INVALID')
    const request = parsed.data
    if (request.controller_id !== controllerId)
      throw new EnrollmentError('CONTROLLER_VPS_CONTROLLER_MISMATCH')
    if (database.inTransaction) throw new EnrollmentError('CONTROLLER_BOOTSTRAP_TRANSACTION_ACTIVE')
    const assertNotAborted = (): void => {
      if (signal?.aborted) throw new EnrollmentError('CONTROLLER_VPS_ENROLLMENT_ABORTED')
    }
    const existing = (): number | undefined => {
      const rows = database
        .prepare(
          `SELECT id, name, host, port, username, auth_type, host_fingerprint, archived_at FROM vps
           WHERE name=? OR (lower(host)=lower(?) AND port=?) ORDER BY id`
        )
        .all(request.profile.name, request.profile.host, request.profile.port) as Array<
        typeof request.profile & { id: number; archived_at: string | null }
      >
      if (!rows.length) return undefined
      const row = rows[0]
      if (
        rows.length !== 1 ||
        row.archived_at !== null ||
        !Object.entries(request.profile).every(([field, value]) => row[field] === value)
      )
        throw new EnrollmentError('CONTROLLER_VPS_ENROLLMENT_CONFLICT')
      try {
        const resolved = createControllerSshResolver(database, controllerId, directory)(row.id)
        // Resolver đồng bộ; không có await/network bên trong transaction ghi.
        if ('then' in resolved) throw new Error('ASYNC_RESOLVER_NOT_SUPPORTED')
        const left = createHash('sha256').update(resolved.secret).digest()
        const right = createHash('sha256').update(request.secret).digest()
        try {
          if (!timingSafeEqual(left, right)) throw new Error('CREDENTIAL_CHANGED')
        } finally {
          left.fill(0)
          right.fill(0)
        }
      } catch {
        throw new EnrollmentError('CONTROLLER_VPS_ENROLLMENT_CONFLICT')
      }
      return row.id
    }
    assertNotAborted()
    assertController(database, controllerId)
    try {
      loadControllerCredentialCipher(directory)
    } catch {
      throw new EnrollmentError('CONTROLLER_VPS_CREDENTIAL_STORE_UNAVAILABLE')
    }
    existing()
    const profile = request.profile
    const ssh = new SshManager(() => ({
      host: profile.host,
      port: profile.port,
      hostFingerprint: profile.host_fingerprint,
      username: profile.username,
      authType: profile.auth_type,
      secret: request.secret
    }))
    const abort = (): void => {
      void ssh.disconnectAll().catch(() => {})
    }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      assertNotAborted()
      await ssh.connect(1)
      const key = ssh.getVerifiedHostKey(1)
      if (!key || !matchesSshHostFingerprint(key, profile.host_fingerprint))
        throw new Error('SSH_UNVERIFIED')
    } catch {
      assertNotAborted()
      throw new EnrollmentError('CONTROLLER_VPS_SSH_VERIFICATION_FAILED')
    } finally {
      signal?.removeEventListener('abort', abort)
      await ssh.disconnectAll()
    }
    assertNotAborted()
    return database
      .transaction((): ProductControllerVpsEnrollmentResult => {
        assertNotAborted()
        assertController(database, controllerId)
        const previous = existing()
        if (previous !== undefined)
          return {
            state: 'already_enrolled',
            controller_id: controllerId,
            vps_id: previous,
            host_fingerprint: profile.host_fingerprint
          }
        const inserted = database
          .prepare(
            `INSERT INTO vps (name,host,port,username,auth_type,host_fingerprint,
           crypto_scheme,encrypted_secret,ssh_security_revision,last_status,last_seen_at)
         VALUES (?,?,?,?,?,?,'aes_256_gcm',X'',1,'online',?)`
          )
          .run(
            profile.name,
            profile.host,
            profile.port,
            profile.username,
            profile.auth_type,
            profile.host_fingerprint,
            new Date().toISOString()
          )
        const id = Number(inserted.lastInsertRowid)
        if (!Number.isSafeInteger(id) || id < 1) throw new Error('INVALID_VPS_ID')
        const encrypted = encryptControllerCredential(
          loadControllerCredentialCipher(directory),
          {
            controller_id: controllerId,
            target: {
              vps_id: id,
              host: profile.host,
              port: profile.port,
              username: profile.username,
              auth_type: profile.auth_type,
              host_fingerprint: profile.host_fingerprint,
              ssh_security_revision: 1
            }
          },
          request.secret
        )
        database
          .prepare('UPDATE vps SET encrypted_secret=?, iv=?, auth_tag=? WHERE id=?')
          .run(encrypted.encrypted_secret, encrypted.iv, encrypted.auth_tag, id)
        return {
          state: 'enrolled',
          controller_id: controllerId,
          vps_id: id,
          host_fingerprint: profile.host_fingerprint
        }
      })
      .immediate()
  } catch (error) {
    if (error instanceof EnrollmentError) throw error
    throw new Error('CONTROLLER_VPS_ENROLLMENT_UNAVAILABLE')
  }
}
