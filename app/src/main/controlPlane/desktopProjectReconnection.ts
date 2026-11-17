import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import type { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import type {
  DesktopProjectReconnection,
  DesktopProjectReconnectionReview,
  DesktopProjectReconnectionReviewInput,
  DesktopProjectReconnectionConfirmInput
} from '../../../../docs/contracts/desktop-project-reconnection'
import type { DesktopControllerVault } from './desktopControllerVault'
import type { DesktopControllerEnrollment } from './desktopControllerEnrollment'
import { projectReconnectionContextSchema } from './projectReconnection'
import { canonicalH2Json } from './productH2Proof'

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const uuid = z.uuidv4()
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const reviewInput = z.strictObject({
  binding_id: uuid,
  app_id: positive
}) satisfies z.ZodType<DesktopProjectReconnectionReviewInput>
const confirmInput = z.strictObject({
  plan_id: uuid,
  consent: z.literal(true)
}) satisfies z.ZodType<DesktopProjectReconnectionConfirmInput>
const bindingSchema = z.strictObject({
  request_key: uuid,
  provenance: z.literal('explicit_reconnection_v1'),
  binding_id: uuid,
  binding_revision: positive,
  controller_id: z.string().min(1).max(128),
  app_id: positive,
  snapshot_sha256: hash,
  confirmed_at: z.iso.datetime()
})
const authoritySchema = z.strictObject({
  binding_id: uuid,
  revision: positive,
  controller_id: z.string().min(1).max(128),
  intent_sha256: hash,
  token_sha256: hash,
  client_id: uuid,
  scopes: z.array(z.string().min(1).max(128)).max(32)
})
const rowSchema = bindingSchema.extend({
  crypto_scheme: z.literal('aes_256_gcm'),
  encrypted_secret: z.instanceof(Buffer).refine((v) => v.length >= 1 && v.length <= 65536),
  iv: z.instanceof(Buffer).refine((v) => v.length === 12),
  auth_tag: z.instanceof(Buffer).refine((v) => v.length === 16)
})
const purpose = 'opspilot-desktop-project-reconnection-v1'
const envelopeSchema = z.strictObject({
  purpose: z.literal(purpose),
  binding: bindingSchema,
  authority: authoritySchema,
  context: projectReconnectionContextSchema
})
type Row = z.infer<typeof rowSchema>
type Authority = z.infer<typeof authoritySchema>
type Context = z.infer<typeof projectReconnectionContextSchema>
type Plan = { expires: number; authority: Authority; context: Context }
const digest = (value: unknown): string =>
  createHash('sha256').update(canonicalH2Json(value)).digest('hex')

export class DesktopProjectReconnectionError extends Error {
  constructor(
    readonly code:
      | 'RECONNECTION_REQUEST_INVALID'
      | 'RECONNECTION_CHANGED'
      | 'RECONNECTION_REVIEW_EXPIRED'
      | 'RECONNECTION_BUSY'
      | 'RECONNECTION_UNAVAILABLE'
  ) {
    super(code)
  }
}

/** Consent mới, độc lập với các receipt đăng ký/chọn ENV/PG cũ. Admin là
 * dependency Main tin cậy; bản production xác minh installed authority trước SSH.
 */
export class DesktopProjectReconnections {
  private readonly plans = new Map<string, Plan>()
  private readonly busy = new Set<string>()
  constructor(
    private readonly db: Database.Database,
    private readonly cipher: AesGcmCredentialCipher,
    private readonly vault: Pick<DesktopControllerVault, 'resolve' | 'get' | 'intent'>,
    private readonly admin: Pick<DesktopControllerEnrollment, 'reconnectionContext'>,
    private readonly now: () => number = Date.now
  ) {}

  async review(
    input: DesktopProjectReconnectionReviewInput
  ): Promise<DesktopProjectReconnectionReview> {
    this.outsideTransaction()
    const value = reviewInput.safeParse(input)
    if (!value.success) throw new DesktopProjectReconnectionError('RECONNECTION_REQUEST_INVALID')
    this.expire()
    if (this.plans.size >= 64) throw new DesktopProjectReconnectionError('RECONNECTION_BUSY')
    const before = this.authority(value.data.binding_id)
    const context = await this.remote(before, value.data.app_id)
    this.guard(before)
    // Hai review hoàn thành đồng thời vẫn phải tôn trọng giới hạn cache.
    this.expire()
    if (this.plans.size >= 64) throw new DesktopProjectReconnectionError('RECONNECTION_BUSY')
    const id = randomUUID(),
      expires = this.now() + 60000
    this.plans.set(id, { expires, authority: before, context })
    return {
      plan_id: id,
      expires_at: new Date(expires).toISOString(),
      binding_id: before.binding_id,
      binding_revision: before.revision,
      context: structuredClone(context)
    }
  }

  async confirm(
    input: DesktopProjectReconnectionConfirmInput
  ): Promise<DesktopProjectReconnection> {
    this.outsideTransaction()
    const value = confirmInput.safeParse(input)
    if (!value.success) throw new DesktopProjectReconnectionError('RECONNECTION_REQUEST_INVALID')
    const key = value.data.plan_id,
      plan = this.plan(key)
    if (this.busy.has(key)) throw new DesktopProjectReconnectionError('RECONNECTION_BUSY')
    this.busy.add(key)
    try {
      this.guard(plan.authority)
      const current = await this.remote(
        plan.authority,
        plan.context.app_id,
        plan.context.snapshot_sha256
      )
      this.plan(key)
      this.guard(plan.authority)
      if (canonicalH2Json(current) !== canonicalH2Json(plan.context))
        throw new DesktopProjectReconnectionError('RECONNECTION_CHANGED')
      return this.db
        .transaction(() => {
          this.plan(key)
          this.guard(plan.authority)
          const a = plan.authority
          const old = this.db
            .prepare(
              `SELECT * FROM desktop_project_reconnection
          WHERE binding_id=? AND binding_revision=? AND controller_id=? AND app_id=? AND snapshot_sha256=?`
            )
            .get(a.binding_id, a.revision, a.controller_id, current.app_id, current.snapshot_sha256)
          if (old) return this.decode(old)
          const binding = {
            request_key: randomUUID(),
            provenance: 'explicit_reconnection_v1' as const,
            binding_id: a.binding_id,
            binding_revision: a.revision,
            controller_id: a.controller_id,
            app_id: current.app_id,
            snapshot_sha256: current.snapshot_sha256,
            confirmed_at: new Date(this.now()).toISOString()
          }
          const payload = canonicalH2Json({ purpose, binding, authority: a, context: current })
          if (Buffer.byteLength(payload) > 65536)
            throw new DesktopProjectReconnectionError('RECONNECTION_UNAVAILABLE')
          const encrypted = this.cipher.encrypt(payload)
          this.db
            .prepare(
              `INSERT INTO desktop_project_reconnection
          (request_key,provenance,binding_id,binding_revision,controller_id,app_id,snapshot_sha256,
          crypto_scheme,encrypted_secret,iv,auth_tag,confirmed_at) VALUES(?,?,?,?,?,?,?,'aes_256_gcm',?,?,?,?)`
            )
            .run(
              binding.request_key,
              binding.provenance,
              binding.binding_id,
              binding.binding_revision,
              binding.controller_id,
              binding.app_id,
              binding.snapshot_sha256,
              encrypted.encrypted_secret,
              encrypted.iv,
              encrypted.auth_tag,
              binding.confirmed_at
            )
          return this.get(binding.request_key)
        })
        .immediate()
    } finally {
      this.busy.delete(key)
    }
  }

  /** Lịch sử xác nhận local đã xác thực, chưa phải quyền chạy tác vụ. */
  get(key: string): DesktopProjectReconnection {
    if (!uuid.safeParse(key).success)
      throw new DesktopProjectReconnectionError('RECONNECTION_REQUEST_INVALID')
    return this.decode(
      this.db.prepare('SELECT * FROM desktop_project_reconnection WHERE request_key=?').get(key)
    )
  }

  latest(bindingId: string, appId: number): DesktopProjectReconnection | null {
    const input = reviewInput.safeParse({ binding_id: bindingId, app_id: appId })
    if (!input.success) throw new DesktopProjectReconnectionError('RECONNECTION_REQUEST_INVALID')
    const a = this.authority(bindingId)
    const row = this.db
      .prepare(
        `SELECT * FROM desktop_project_reconnection
      WHERE binding_id=? AND binding_revision=? AND controller_id=? AND app_id=?
      ORDER BY rowid DESC LIMIT 1`
      )
      .get(bindingId, a.revision, a.controller_id, appId)
    return row ? this.decode(row) : null
  }
  /** Luôn kiểm lại remote trước khi dùng cấu hình của dự án đã nhận lại. */
  async current(key: string): Promise<DesktopProjectReconnection> {
    this.outsideTransaction()
    const record = this.get(key),
      authority = this.authority(record.binding_id)
    const remote = await this.remote(authority, record.app_id, record.snapshot_sha256)
    this.guard(authority)
    if (
      canonicalH2Json(this.get(key)) !== canonicalH2Json(record) ||
      canonicalH2Json(remote) !== canonicalH2Json(record.context)
    )
      throw new DesktopProjectReconnectionError('RECONNECTION_CHANGED')
    return record
  }

  private async remote(a: Authority, appId: number, expected?: string): Promise<Context> {
    try {
      const context = projectReconnectionContextSchema.parse(
        await this.admin.reconnectionContext(
          a.binding_id,
          {
            format: 1,
            controller_id: a.controller_id,
            app_id: appId,
            ...(expected ? { expected_snapshot_sha256: expected } : {})
          },
          () => this.guard(a)
        )
      )
      this.guard(a)
      if (
        context.controller_id !== a.controller_id ||
        context.app_id !== appId ||
        (expected !== undefined && context.snapshot_sha256 !== expected)
      )
        throw new DesktopProjectReconnectionError('RECONNECTION_CHANGED')
      return context
    } catch (error) {
      this.guard(a)
      if (error instanceof DesktopProjectReconnectionError) throw error
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'PROJECT_RECONNECTION_AUTHORITY_CHANGED'
      )
        throw new DesktopProjectReconnectionError('RECONNECTION_CHANGED')
      throw new DesktopProjectReconnectionError('RECONNECTION_UNAVAILABLE')
    }
  }
  private authority(id: string): Authority {
    try {
      const value = this.vault.resolve(id),
        metadata = this.vault.get(id),
        intent = this.vault.intent(id)
      const scopes = [...(metadata.client?.scopes ?? [])].sort()
      if (
        !metadata.client ||
        !(['read', 'deploy:manual', 'policy:write'] as const).every((scope) =>
          scopes.includes(scope)
        )
      )
        throw Error()
      return authoritySchema.parse({
        binding_id: id,
        revision: value.revision,
        controller_id: value.controllerId,
        intent_sha256: digest(intent),
        token_sha256: createHash('sha256').update(value.accessToken).digest('hex'),
        client_id: metadata.client.client_id,
        scopes
      })
    } catch {
      throw new DesktopProjectReconnectionError('RECONNECTION_CHANGED')
    }
  }
  private guard(expected: Authority): void {
    if (canonicalH2Json(this.authority(expected.binding_id)) !== canonicalH2Json(expected))
      throw new DesktopProjectReconnectionError('RECONNECTION_CHANGED')
  }
  private decode(input: unknown): DesktopProjectReconnection {
    try {
      const row: Row = rowSchema.parse(input)
      const binding = bindingSchema.strip().parse(row)
      const packet = envelopeSchema.parse(JSON.parse(this.cipher.decrypt(row)))
      if (
        canonicalH2Json(packet.binding) !== canonicalH2Json(binding) ||
        packet.context.controller_id !== row.controller_id ||
        packet.context.app_id !== row.app_id ||
        packet.context.snapshot_sha256 !== row.snapshot_sha256 ||
        packet.authority.binding_id !== row.binding_id ||
        packet.authority.revision !== row.binding_revision ||
        packet.authority.controller_id !== row.controller_id
      )
        throw Error()
      this.guard(packet.authority)
      return { ...binding, context: packet.context, execution: 'fresh_review_required' }
    } catch {
      throw new DesktopProjectReconnectionError('RECONNECTION_UNAVAILABLE')
    }
  }
  private plan(id: string): Plan {
    const value = this.plans.get(id)
    if (!value || this.now() >= value.expires) {
      this.plans.delete(id)
      throw new DesktopProjectReconnectionError('RECONNECTION_REVIEW_EXPIRED')
    }
    return value
  }
  private expire(): void {
    for (const [key, value] of this.plans) if (this.now() >= value.expires) this.plans.delete(key)
  }
  private outsideTransaction(): void {
    if (this.db.inTransaction)
      throw new DesktopProjectReconnectionError('RECONNECTION_REQUEST_INVALID')
  }
}
