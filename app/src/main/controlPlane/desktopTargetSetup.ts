import type Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type {
  DesktopTargetPrepareInput,
  DesktopTargetSendInput,
  DesktopTargetSetup
} from '@shared/desktopTargetRegistration'
import type { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { loadSecret } from '../crypto/credentials'
import type { DesktopControllerEnrollment } from './desktopControllerEnrollment'
import type { DesktopControllerVault } from './desktopControllerVault'
import { controllerVpsEnrollmentSchema } from './controllerEnrollment'
import { vpsRegistrationResultSchema } from './vpsRegistration'
import { canonicalH2Json } from './productH2Proof'
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const inputSchema = z.strictObject({ binding_id: z.uuid(), local_vps_id: positive })
const rowSchema = z.strictObject({
  request_key: z.uuid(),
  binding_id: z.uuid(),
  binding_revision: positive,
  controller_id: z.string(),
  local_vps_id: positive,
  local_security_revision: positive,
  profile_json: z.string().min(1).max(4096),
  credential_digest: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['prepared', 'in_flight', 'outcome_unknown', 'registered', 'cancelled']),
  remote_vps_id: positive.nullable(),
  remote_security_revision: positive.nullable(),
  result_json: z.string().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime()
})
type Row = z.output<typeof rowSchema>
type Local = {
  profile: z.output<typeof controllerVpsEnrollmentSchema.shape.profile>
  revision: number
  digest: string
}
export class DesktopTargetSetupError extends Error {
  constructor(
    readonly code:
      | 'TARGET_SETUP_REQUEST_INVALID'
      | 'TARGET_SETUP_UNAVAILABLE'
      | 'TARGET_SETUP_CHANGED'
      | 'TARGET_SETUP_CONFLICT'
      | 'TARGET_SETUP_BUSY'
      | 'TARGET_SETUP_RESPONSE_INVALID'
      | 'TARGET_CREDENTIAL_UNAVAILABLE'
  ) {
    super(code)
  }
}
/** Journal chỉ có public profile và ciphertext digest, không có secret hoặc password hash. */
export class DesktopTargetSetups {
  private readonly busy = new Set<string>()
  constructor(
    private readonly db: Database.Database,
    private readonly cipher: AesGcmCredentialCipher,
    private readonly vault: Pick<DesktopControllerVault, 'resolve' | 'get'>,
    private readonly admin: Pick<DesktopControllerEnrollment, 'registerVps'>
  ) {}
  prepare(input: DesktopTargetPrepareInput): DesktopTargetSetup {
    const parsed = inputSchema.safeParse(input)
    if (!parsed.success) throw new DesktopTargetSetupError('TARGET_SETUP_REQUEST_INVALID')
    return this.mutate(() => {
      const { binding_id, local_vps_id } = parsed.data,
        binding = this.authorize(binding_id),
        local = this.local(local_vps_id),
        profile = canonicalH2Json(local.profile)
      const pending = this.db
        .prepare(
          "SELECT * FROM desktop_target_setup WHERE controller_id=? AND local_vps_id=? AND state IN ('prepared','in_flight','outcome_unknown')"
        )
        .get(binding.controllerId, local_vps_id)
      if (pending) {
        const row = this.valid(pending)
        if (
          row.binding_id !== binding_id ||
          row.binding_revision !== binding.revision ||
          row.local_security_revision !== local.revision ||
          row.credential_digest !== local.digest ||
          row.profile_json !== profile
        )
          throw new DesktopTargetSetupError('TARGET_SETUP_CONFLICT')
        return this.metadata(this.recover(row))
      }
      const done = this.db
        .prepare(
          "SELECT * FROM desktop_target_setup WHERE binding_id=? AND binding_revision=? AND local_vps_id=? AND local_security_revision=? AND credential_digest=? AND profile_json=? AND state='registered' ORDER BY created_at DESC LIMIT 1"
        )
        .get(binding_id, binding.revision, local_vps_id, local.revision, local.digest, profile)
      if (done) return this.metadata(this.valid(done))
      const key = randomUUID(),
        stamp = new Date().toISOString()
      this.db
        .prepare(
          "INSERT INTO desktop_target_setup(request_key,binding_id,binding_revision,controller_id,local_vps_id,local_security_revision,profile_json,credential_digest,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'prepared',?,?)"
        )
        .run(
          key,
          binding_id,
          binding.revision,
          binding.controllerId,
          local_vps_id,
          local.revision,
          profile,
          local.digest,
          stamp,
          stamp
        )
      return this.metadata(this.row(key))
    })
  }
  list(bindingId: string): DesktopTargetSetup[] {
    if (!z.uuid().safeParse(bindingId).success)
      throw new DesktopTargetSetupError('TARGET_SETUP_REQUEST_INVALID')
    return this.mutate(() =>
      this.db
        .prepare(
          "SELECT * FROM desktop_target_setup WHERE binding_id=? ORDER BY CASE WHEN state IN ('prepared','in_flight','outcome_unknown') THEN 0 ELSE 1 END,created_at DESC,request_key LIMIT 100"
        )
        .all(bindingId)
        .map((value) => this.metadata(this.recover(this.valid(value))))
    )
  }
  cancel(key: string): DesktopTargetSetup {
    return this.mutate(() => {
      const row = this.row(key)
      if (!['prepared', 'cancelled'].includes(row.state))
        throw new DesktopTargetSetupError('TARGET_SETUP_CONFLICT')
      this.db
        .prepare(
          "UPDATE desktop_target_setup SET state='cancelled',updated_at=? WHERE request_key=?"
        )
        .run(new Date().toISOString(), row.request_key)
      return this.metadata(this.row(key))
    })
  }
  async send(input: DesktopTargetSendInput): Promise<DesktopTargetSetup> {
    const parsed = z
      .strictObject({ request_key: z.uuid(), confirm_transfer: z.literal(true) })
      .safeParse(input)
    if (!parsed.success) throw new DesktopTargetSetupError('TARGET_SETUP_REQUEST_INVALID')
    const initial = this.row(parsed.data.request_key)
    if (['registered', 'cancelled'].includes(initial.state)) return this.metadata(initial)
    if (this.busy.has(initial.request_key)) throw new DesktopTargetSetupError('TARGET_SETUP_BUSY')
    this.busy.add(initial.request_key)
    try {
      const claimed = this.mutate(() => {
        const row = this.row(initial.request_key)
        if (['registered', 'cancelled'].includes(row.state)) return null
        this.current(row)
        let secret: string
        try {
          secret = loadSecret(this.db, this.cipher, row.local_vps_id)
        } catch {
          throw new DesktopTargetSetupError('TARGET_CREDENTIAL_UNAVAILABLE')
        }
        this.db
          .prepare(
            "UPDATE desktop_target_setup SET state='in_flight',updated_at=? WHERE request_key=?"
          )
          .run(new Date().toISOString(), row.request_key)
        return { row, secret }
      })
      if (!claimed) return this.metadata(this.row(initial.request_key))
      const guard = (): void => this.current(claimed.row)
      const reply = vpsRegistrationResultSchema.safeParse(
        await this.admin.registerVps(
          initial.binding_id,
          {
            format: 1,
            controller_id: initial.controller_id,
            request_key: initial.request_key,
            profile: controllerVpsEnrollmentSchema.shape.profile.parse(
              JSON.parse(initial.profile_json)
            ),
            secret: claimed.secret
          },
          guard
        )
      )
      guard()
      if (
        !reply.success ||
        reply.data.controller_id !== initial.controller_id ||
        reply.data.request_key !== initial.request_key ||
        canonicalH2Json(reply.data.profile) !== initial.profile_json
      )
        throw new DesktopTargetSetupError('TARGET_SETUP_RESPONSE_INVALID')
      const result = reply.data
      return this.mutate(() => {
        guard()
        const row = this.row(initial.request_key)
        if (row.state === 'registered') {
          if (
            row.remote_vps_id !== result.vps_id ||
            row.remote_security_revision !== result.ssh_security_revision
          )
            throw new DesktopTargetSetupError('TARGET_SETUP_RESPONSE_INVALID')
          return this.metadata(row)
        }
        if (!['in_flight', 'outcome_unknown'].includes(row.state))
          throw new DesktopTargetSetupError('TARGET_SETUP_CONFLICT')
        this.db
          .prepare(
            "UPDATE desktop_target_setup SET state='registered',remote_vps_id=?,remote_security_revision=?,result_json=?,updated_at=? WHERE request_key=?"
          )
          .run(
            result.vps_id,
            result.ssh_security_revision,
            canonicalH2Json(result),
            new Date().toISOString(),
            row.request_key
          )
        return this.metadata(this.row(row.request_key))
      })
    } catch (error) {
      this.mutate(() => {
        const row = this.row(initial.request_key)
        if (row.state === 'in_flight')
          this.db
            .prepare(
              "UPDATE desktop_target_setup SET state='outcome_unknown',updated_at=? WHERE request_key=?"
            )
            .run(new Date().toISOString(), row.request_key)
      })
      throw error
    } finally {
      this.busy.delete(initial.request_key)
    }
  }
  private authorize(
    id: string,
    revision?: number,
    controller?: string
  ): ReturnType<DesktopControllerVault['resolve']> {
    const value = this.vault.resolve(id)
    const scopes = this.vault.get(id).client?.scopes ?? []
    if (
      !scopes.includes('deploy:manual') ||
      !scopes.includes('policy:write') ||
      (revision !== undefined && revision !== value.revision) ||
      (controller !== undefined && controller !== value.controllerId)
    )
      throw new DesktopTargetSetupError('TARGET_SETUP_CHANGED')
    return value
  }
  private current(row: Row): void {
    this.authorize(row.binding_id, row.binding_revision, row.controller_id)
    const local = this.local(row.local_vps_id)
    if (
      local.revision !== row.local_security_revision ||
      local.digest !== row.credential_digest ||
      canonicalH2Json(local.profile) !== row.profile_json
    )
      throw new DesktopTargetSetupError('TARGET_SETUP_CHANGED')
  }
  private local(id: number): Local {
    const row = this.db
      .prepare(
        'SELECT name,host,port,username,auth_type,host_fingerprint,ssh_security_revision,crypto_scheme,encrypted_secret,iv,auth_tag,archived_at FROM vps WHERE id=?'
      )
      .get(id) as Record<string, unknown> | undefined
    if (
      !row ||
      row.archived_at !== null ||
      row.crypto_scheme !== 'aes_256_gcm' ||
      !Buffer.isBuffer(row.encrypted_secret) ||
      row.encrypted_secret.length < 1 ||
      row.encrypted_secret.length > 512 * 1024 ||
      !Buffer.isBuffer(row.iv) ||
      row.iv.length !== 12 ||
      !Buffer.isBuffer(row.auth_tag) ||
      row.auth_tag.length !== 16
    )
      throw new DesktopTargetSetupError('TARGET_CREDENTIAL_UNAVAILABLE')
    const profile = controllerVpsEnrollmentSchema.shape.profile.safeParse({
        name: row.name,
        host: row.host,
        port: row.port,
        username: row.username,
        auth_type: row.auth_type,
        host_fingerprint: row.host_fingerprint
      }),
      revision = positive.safeParse(row.ssh_security_revision)
    if (!profile.success || !revision.success)
      throw new DesktopTargetSetupError('TARGET_SETUP_CHANGED')
    const digest = createHash('sha256')
      .update(
        canonicalH2Json({
          crypto_scheme: row.crypto_scheme,
          ciphertext: row.encrypted_secret.toString('base64'),
          iv: row.iv.toString('base64'),
          tag: row.auth_tag.toString('base64')
        })
      )
      .digest('hex')
    return { profile: profile.data, revision: revision.data, digest }
  }
  private valid(value: unknown): Row {
    const parsed = rowSchema.safeParse(value)
    if (!parsed.success) throw new DesktopTargetSetupError('TARGET_SETUP_UNAVAILABLE')
    const row = parsed.data,
      profile = controllerVpsEnrollmentSchema.shape.profile.safeParse(JSON.parse(row.profile_json))
    if (!profile.success || canonicalH2Json(profile.data) !== row.profile_json)
      throw new DesktopTargetSetupError('TARGET_SETUP_UNAVAILABLE')
    if (row.state === 'registered') {
      const result = vpsRegistrationResultSchema.safeParse(JSON.parse(row.result_json ?? 'null'))
      if (
        !result.success ||
        result.data.vps_id !== row.remote_vps_id ||
        result.data.ssh_security_revision !== row.remote_security_revision ||
        result.data.controller_id !== row.controller_id ||
        result.data.request_key !== row.request_key ||
        canonicalH2Json(result.data.profile) !== row.profile_json
      )
        throw new DesktopTargetSetupError('TARGET_SETUP_UNAVAILABLE')
    } else if (
      row.remote_vps_id !== null ||
      row.remote_security_revision !== null ||
      row.result_json !== null
    )
      throw new DesktopTargetSetupError('TARGET_SETUP_UNAVAILABLE')
    return row
  }
  private row(key: string): Row {
    if (!z.uuid().safeParse(key).success)
      throw new DesktopTargetSetupError('TARGET_SETUP_REQUEST_INVALID')
    return this.valid(
      this.db.prepare('SELECT * FROM desktop_target_setup WHERE request_key=?').get(key)
    )
  }
  private recover(row: Row): Row {
    if (row.state === 'in_flight' && !this.busy.has(row.request_key)) {
      this.db
        .prepare(
          "UPDATE desktop_target_setup SET state='outcome_unknown',updated_at=? WHERE request_key=? AND state='in_flight'"
        )
        .run(new Date().toISOString(), row.request_key)
      return this.row(row.request_key)
    }
    return row
  }
  private metadata(row: Row): DesktopTargetSetup {
    return {
      request_key: row.request_key,
      binding_id: row.binding_id,
      binding_revision: row.binding_revision,
      controller_id: row.controller_id,
      local_vps_id: row.local_vps_id,
      local_security_revision: row.local_security_revision,
      profile: controllerVpsEnrollmentSchema.shape.profile.parse(JSON.parse(row.profile_json)),
      state: row.state,
      remote_vps_id: row.remote_vps_id,
      remote_security_revision: row.remote_security_revision,
      created_at: row.created_at,
      updated_at: row.updated_at
    }
  }
  private mutate<T>(work: () => T): T {
    if (this.db.inTransaction) throw new DesktopTargetSetupError('TARGET_SETUP_REQUEST_INVALID')
    return this.db.transaction(work).immediate()
  }
}
