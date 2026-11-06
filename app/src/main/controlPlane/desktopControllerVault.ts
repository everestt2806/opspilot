import type Database from 'better-sqlite3'
import { z } from 'zod'
import type { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import type {
  ProductDesktopClientIdentity,
  ProductDesktopControllerBindingIntent,
  ProductDesktopControllerBindingMetadata,
  ProductDesktopEnrollmentResponse
} from '../../../../docs/contracts/product-controller-api'
import type { ControllerDesktopBinding } from './controllerHttpClient'
import { canonicalH2Json } from './productH2Proof'

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const clean = (value: string): boolean =>
  [...value].every((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127)
const safePath = z
  .string()
  .regex(/^\/[A-Za-z0-9_./-]{1,511}$/)
  .refine((value) =>
    value.split('/').every((part, i) => i === 0 || (part !== '' && part !== '.' && part !== '..'))
  )
export const desktopBindingIntentSchema = z
  .strictObject({
    binding_id: z.uuid().transform((value) => value.toLowerCase()),
    controller_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/),
    vps_id: positive,
    ssh_security_revision: positive,
    principal: z.strictObject({
      vpsId: positive,
      host: z.string().min(1).max(253).refine(clean),
      port: positive.max(65535),
      hostFingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/),
      username: z.string().min(1).max(128).refine(clean),
      authType: z.enum(['key', 'password'])
    }),
    artifact_path: safePath.refine((value) => value.endsWith('.cjs')),
    data_directory: safePath,
    node_path: safePath,
    manifest_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    display_name: z.string().min(1).max(128).refine(clean),
    requested_scopes: z
      .tuple([z.literal('read')])
      .rest(z.enum(['read', 'deploy:manual', 'policy:write']))
      .refine((value) => value.length <= 3 && new Set(value).size === value.length)
  })
  .refine((value) => value.principal.vpsId === value.vps_id)
export const desktopClientIdentitySchema = z.strictObject({
  client_id: z.uuid(),
  controller_id: z.string(),
  display_name: z.string().min(1).max(128).refine(clean),
  scopes: z
    .array(z.enum(['read', 'deploy:manual', 'policy:write']))
    .min(1)
    .max(3)
    .refine((value) => value.includes('read') && new Set(value).size === value.length),
  created_at: z.iso.datetime(),
  revoked_at: z.iso.datetime().nullable(),
  token_expires_at: z.iso.datetime()
}) satisfies z.ZodType<ProductDesktopClientIdentity>
export const desktopEnrollmentResponseSchema = z.strictObject({
  state: z.literal('issued_once'),
  controller_id: z.string(),
  client: desktopClientIdentitySchema,
  credential: z.strictObject({
    access_token: z.string().regex(/^opspilot_[A-Za-z0-9_-]{43}$/),
    token_type: z.literal('Bearer'),
    expires_at: z.iso.datetime()
  })
}) satisfies z.ZodType<ProductDesktopEnrollmentResponse>
interface Row {
  binding_id: string
  controller_id: string
  vps_id: number
  revision: number
  state: ProductDesktopControllerBindingMetadata['state']
  intent_json: string
  remote_client_id: string | null
  client_json: string | null
  encrypted_secret: Buffer | null
  iv: Buffer | null
  auth_tag: Buffer | null
  created_at: string
  updated_at: string
}
export class DesktopControllerVaultError extends Error {
  constructor(
    readonly code:
      | 'REQUEST_INVALID'
      | 'BINDING_UNAVAILABLE'
      | 'BINDING_CHANGED'
      | 'IDEMPOTENCY_CONFLICT'
      | 'CREDENTIAL_EXPIRED'
  ) {
    super(code)
  }
}
/** SQLite chỉ giữ public intent/metadata + AES envelope bằng cipher của profile Desktop. */
export class DesktopControllerVault {
  constructor(
    private readonly db: Database.Database,
    private readonly cipher: AesGcmCredentialCipher,
    private readonly now: () => number = Date.now
  ) {}
  prepare(input: ProductDesktopControllerBindingIntent): ProductDesktopControllerBindingMetadata {
    const parsed = desktopBindingIntentSchema.safeParse(input)
    if (!parsed.success) throw new DesktopControllerVaultError('REQUEST_INVALID')
    return this.mutate(() => {
      const intent = parsed.data
      this.currentVps(intent)
      const existing = this.row(intent.binding_id)
      if (existing) {
        if (existing.intent_json !== canonicalH2Json(intent))
          throw new DesktopControllerVaultError('IDEMPOTENCY_CONFLICT')
        return this.metadata(existing)
      }
      const stamp = this.timestamp()
      this.db
        .prepare(
          `INSERT INTO desktop_controller_binding(binding_id,controller_id,vps_id,revision,state,intent_json,created_at,updated_at)
        VALUES(?,?,?,1,'pending',?,?,?)`
        )
        .run(
          intent.binding_id,
          intent.controller_id,
          intent.vps_id,
          canonicalH2Json(intent),
          stamp,
          stamp
        )
      return this.get(intent.binding_id)
    })
  }
  get(bindingId: string): ProductDesktopControllerBindingMetadata {
    return this.metadata(this.required(bindingId))
  }
  intent(bindingId: string): ProductDesktopControllerBindingIntent {
    const row = this.required(bindingId),
      intent = this.parseIntent(row)
    this.currentVps(intent)
    return intent as ProductDesktopControllerBindingIntent
  }
  activate(
    bindingId: string,
    expectedRevision: number,
    input: ProductDesktopEnrollmentResponse
  ): ProductDesktopControllerBindingMetadata {
    const parsed = desktopEnrollmentResponseSchema.safeParse(input)
    if (!parsed.success) throw new DesktopControllerVaultError('REQUEST_INVALID')
    return this.mutate(() => {
      const row = this.required(bindingId),
        intent = this.parseIntent(row),
        response = parsed.data
      this.currentVps(intent)
      this.assertRevision(row, expectedRevision)
      if (!['pending', 'delivery_unknown'].includes(row.state))
        throw new DesktopControllerVaultError('BINDING_CHANGED')
      if (
        response.controller_id !== row.controller_id ||
        response.client.controller_id !== row.controller_id ||
        response.client.revoked_at !== null ||
        response.client.display_name !== intent.display_name ||
        response.client.token_expires_at !== response.credential.expires_at ||
        canonicalH2Json([...response.client.scopes].sort()) !==
          canonicalH2Json([...intent.requested_scopes].sort()) ||
        (row.remote_client_id !== null && row.remote_client_id !== response.client.client_id)
      )
        throw new DesktopControllerVaultError('BINDING_CHANGED')
      if (Date.parse(response.credential.expires_at) <= this.now())
        throw new DesktopControllerVaultError('CREDENTIAL_EXPIRED')
      const revision = row.revision + 1,
        client = response.client
      const secret = this.cipher.encrypt(
        canonicalH2Json({
          purpose: 'desktop-controller-client-v1',
          intent,
          binding_revision: revision,
          client,
          access_token: response.credential.access_token
        })
      )
      const changed = this.db
        .prepare(
          `UPDATE desktop_controller_binding SET revision=?,state='active',remote_client_id=?,client_json=?,encrypted_secret=?,iv=?,auth_tag=?,updated_at=?
        WHERE binding_id=? AND revision=?`
        )
        .run(
          revision,
          client.client_id,
          canonicalH2Json(client),
          secret.encrypted_secret,
          secret.iv,
          secret.auth_tag,
          this.timestamp(),
          bindingId,
          expectedRevision
        )
      if (changed.changes !== 1) throw new DesktopControllerVaultError('BINDING_CHANGED')
      return this.get(bindingId)
    })
  }
  deliveryUnknown(
    bindingId: string,
    expectedRevision: number,
    clientId?: string
  ): ProductDesktopControllerBindingMetadata {
    return this.mutate(() => {
      const row = this.required(bindingId)
      this.assertRevision(row, expectedRevision)
      if (!['pending', 'delivery_unknown'].includes(row.state))
        throw new DesktopControllerVaultError('BINDING_CHANGED')
      if (clientId) {
        if (
          !z.uuid().safeParse(clientId).success ||
          (row.remote_client_id !== null && row.remote_client_id !== clientId)
        )
          throw new DesktopControllerVaultError('REQUEST_INVALID')
      }
      this.db
        .prepare(
          `UPDATE desktop_controller_binding SET state='delivery_unknown',revision=revision+1,remote_client_id=COALESCE(?,remote_client_id),updated_at=? WHERE binding_id=? AND revision=?`
        )
        .run(clientId ?? null, this.timestamp(), bindingId, expectedRevision)
      return this.get(bindingId)
    })
  }
  disable(bindingId: string, expectedRevision: number): ProductDesktopControllerBindingMetadata {
    return this.mutate(() => {
      const row = this.required(bindingId)
      this.assertRevision(row, expectedRevision)
      this.db
        .prepare(
          `UPDATE desktop_controller_binding SET state='disabled',revision=revision+1,encrypted_secret=NULL,iv=NULL,auth_tag=NULL,updated_at=? WHERE binding_id=? AND revision=?`
        )
        .run(this.timestamp(), bindingId, expectedRevision)
      return this.get(bindingId)
    })
  }
  resolve(bindingId: string): ControllerDesktopBinding {
    try {
      const row = this.required(bindingId),
        intent = this.parseIntent(row),
        client = this.client(row)
      if (
        row.state !== 'active' ||
        !row.encrypted_secret ||
        !row.iv ||
        !row.auth_tag ||
        client.revoked_at
      )
        throw new Error()
      this.currentVps(intent)
      if (Date.parse(client.token_expires_at) <= this.now())
        throw new DesktopControllerVaultError('CREDENTIAL_EXPIRED')
      const plain: unknown = JSON.parse(
        this.cipher.decrypt({
          crypto_scheme: 'aes_256_gcm',
          encrypted_secret: row.encrypted_secret,
          iv: row.iv,
          auth_tag: row.auth_tag
        })
      )
      const checked = z
        .strictObject({
          purpose: z.literal('desktop-controller-client-v1'),
          intent: desktopBindingIntentSchema,
          binding_revision: positive,
          client: desktopClientIdentitySchema,
          access_token: z.string().regex(/^opspilot_[A-Za-z0-9_-]{43}$/)
        })
        .safeParse(plain)
      if (
        !checked.success ||
        checked.data.binding_revision !== row.revision ||
        canonicalH2Json(checked.data.intent) !== canonicalH2Json(intent) ||
        canonicalH2Json(checked.data.client) !== canonicalH2Json(client)
      )
        throw new Error()
      return {
        controllerId: row.controller_id,
        revision: row.revision,
        principal: { ...intent.principal },
        accessToken: checked.data.access_token
      }
    } catch (error) {
      if (error instanceof DesktopControllerVaultError && error.code === 'CREDENTIAL_EXPIRED')
        throw error
      throw new DesktopControllerVaultError('BINDING_UNAVAILABLE')
    }
  }
  private currentVps(intent: z.output<typeof desktopBindingIntentSchema>): void {
    const vps = this.db
      .prepare(
        `SELECT host,port,host_fingerprint,username,auth_type,ssh_security_revision,archived_at FROM vps WHERE id=?`
      )
      .get(intent.vps_id) as
      | {
          host: string
          port: number
          host_fingerprint: string
          username: string
          auth_type: string
          ssh_security_revision: number
          archived_at: string | null
        }
      | undefined
    if (
      !vps ||
      vps.archived_at !== null ||
      vps.ssh_security_revision !== intent.ssh_security_revision ||
      vps.host !== intent.principal.host ||
      vps.port !== intent.principal.port ||
      vps.host_fingerprint !== intent.principal.hostFingerprint ||
      vps.username !== intent.principal.username ||
      vps.auth_type !== intent.principal.authType
    )
      throw new DesktopControllerVaultError('BINDING_CHANGED')
  }
  private parseIntent(row: Row): z.output<typeof desktopBindingIntentSchema> {
    try {
      const intent = desktopBindingIntentSchema.parse(JSON.parse(row.intent_json))
      if (
        intent.binding_id !== row.binding_id ||
        intent.controller_id !== row.controller_id ||
        intent.vps_id !== row.vps_id
      )
        throw new Error()
      return intent
    } catch {
      throw new DesktopControllerVaultError('BINDING_UNAVAILABLE')
    }
  }
  private client(row: Row): ProductDesktopClientIdentity {
    try {
      const client = desktopClientIdentitySchema.parse(JSON.parse(row.client_json!))
      if (client.controller_id !== row.controller_id || client.client_id !== row.remote_client_id)
        throw new Error()
      return client
    } catch {
      throw new DesktopControllerVaultError('BINDING_UNAVAILABLE')
    }
  }
  private metadata(row: Row): ProductDesktopControllerBindingMetadata {
    this.parseIntent(row)
    if (row.remote_client_id !== null && !z.uuid().safeParse(row.remote_client_id).success)
      throw new DesktopControllerVaultError('BINDING_UNAVAILABLE')
    return {
      binding_id: row.binding_id,
      controller_id: row.controller_id,
      vps_id: row.vps_id,
      revision: row.revision,
      state: row.state,
      remote_client_id: row.remote_client_id,
      client: row.client_json === null ? null : this.client(row),
      created_at: row.created_at,
      updated_at: row.updated_at
    }
  }
  private row(bindingId: string): Row | undefined {
    if (!z.uuid().safeParse(bindingId).success)
      throw new DesktopControllerVaultError('REQUEST_INVALID')
    return this.db
      .prepare('SELECT * FROM desktop_controller_binding WHERE binding_id=?')
      .get(bindingId) as Row | undefined
  }
  private required(bindingId: string): Row {
    const row = this.row(bindingId)
    if (!row) throw new DesktopControllerVaultError('BINDING_UNAVAILABLE')
    return row
  }
  private assertRevision(row: Row, revision: number): void {
    if (row.revision !== revision) throw new DesktopControllerVaultError('BINDING_CHANGED')
  }
  private timestamp(): string {
    return new Date(this.now()).toISOString()
  }
  private mutate<T>(operation: () => T): T {
    if (this.db.inTransaction) throw new DesktopControllerVaultError('REQUEST_INVALID')
    return this.db.transaction(operation).immediate()
  }
}
