import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import type {
  ProductEnvironmentMetadata,
  ProductEnvironmentScope,
  ProductEnvironmentWriteInput,
  ProductEnvironmentStageResult,
  ProductEnvironmentState,
  ProductEnvironmentValues
} from '../../../../docs/contracts/product-environment'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { canonicalH2Json } from '../controlPlane/productH2Proof'
import {
  environmentScopeSchema,
  environmentWriteSchema,
  environmentStageSchema,
  environmentStateSchema,
  environmentContextSchema,
  ProductEnvironmentError,
  validateEnvironmentValues
} from '../controlPlane/productEnvironment'

type Authority = {
  framework: 'express' | 'static-spa' | 'nextjs'
  source_generation: number
  source_config_sha256: string
}
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const rowSchema = z.strictObject({
  controller_id: z.string(),
  app_id: positive,
  ownership_generation: positive,
  revision: positive,
  basis_source_generation: positive,
  basis_source_config_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  target_binding_json: z.string().max(4096),
  framework: z.enum(['express', 'static-spa', 'nextjs']),
  runtime_keys_json: z.string().max(32768),
  public_build_keys_json: z.string().max(32768),
  crypto_scheme: z.literal('aes_256_gcm'),
  encrypted_secret: z.instanceof(Buffer).refine((b) => b.length > 0 && b.length <= 131072),
  iv: z.instanceof(Buffer).refine((b) => b.length === 12),
  auth_tag: z.instanceof(Buffer).refine((b) => b.length === 16),
  created_at: z.iso.datetime()
})
type Row = z.output<typeof rowSchema>
const purpose = 'opspilot-product-environment-v1'
const requestPurpose = 'opspilot-product-environment-request-v1'
const receiptSchema = rowSchema
  .pick({
    controller_id: true,
    app_id: true,
    ownership_generation: true,
    revision: true,
    crypto_scheme: true,
    encrypted_secret: true,
    iv: true,
    auth_tag: true,
    created_at: true
  })
  .extend({
    administrator_id: z.string().regex(/^unix:(0|[1-9][0-9]{0,9})$/),
    request_key: environmentStageSchema.shape.request_key
  })

/** Staged-only vault; caller không được dùng readValues như quyền kích hoạt deploy. */
export class ProductEnvironmentRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly cipher: AesGcmCredentialCipher
  ) {}

  append(input: unknown): ProductEnvironmentMetadata {
    return this.guarded(() => {
      const parsed = environmentWriteSchema.safeParse(input)
      if (!parsed.success) throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_INPUT_INVALID')
      return this.db.transaction(() => this.appendRevision(parsed.data)).immediate()
    })
  }

  /** CLI cùng UID; receipt và revision commit chung, không lưu hash của secret. */
  context(input: unknown, controllerId: string, administratorId: string): ProductEnvironmentState {
    return this.guarded(() => {
      const parsed = environmentContextSchema.safeParse(input)
      if (!parsed.success) throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_INPUT_INVALID')
      const request = parsed.data
      if (request.controller_id !== controllerId)
        throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED')
      const target = this.db
        .prepare(
          `SELECT v.id AS vps_id,v.host,v.port,v.username,v.auth_type,
        v.host_fingerprint,v.ssh_security_revision FROM app a JOIN vps v ON v.id=a.vps_id WHERE a.id=?`
        )
        .get(request.app_id) as ProductEnvironmentScope['target'] | undefined
      if (!target || target.ssh_security_revision !== request.expected_target_security_revision)
        throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED')
      return this.state(
        {
          format: 1,
          scope: {
            controller_id: controllerId,
            app_id: request.app_id,
            ownership_generation: request.expected_ownership_generation,
            target
          },
          expected_source_generation: request.expected_source_generation,
          expected_source_config_sha256: request.expected_source_config_sha256,
          request_key: null
        },
        controllerId,
        administratorId
      )
    })
  }

  stage(
    input: unknown,
    controllerId: string,
    administratorId: string
  ): ProductEnvironmentStageResult {
    return this.guarded(() => {
      const parsed = environmentStageSchema.safeParse(input)
      if (!parsed.success) throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_INPUT_INVALID')
      const request = parsed.data
      return this.db
        .transaction(() => {
          this.adminAuthority(request, controllerId, administratorId)
          validateEnvironmentValues(request.values, this.authorize(request.scope).framework)
          const previous = this.receipt(request.request_key, administratorId, request.scope)
          if (previous) {
            if (canonicalH2Json(previous.request) !== canonicalH2Json(request))
              throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_IDEMPOTENCY_CONFLICT')
            this.adminAuthority(request, controllerId, administratorId)
            return {
              state: 'already_staged' as const,
              request_key: request.request_key,
              metadata: previous.metadata
            }
          }
          const { request_key } = request
          const metadata = this.appendRevision(request)
          const binding = {
            controller_id: controllerId,
            administrator_id: administratorId,
            request_key,
            app_id: metadata.app_id,
            ownership_generation: metadata.ownership_generation,
            revision: metadata.revision,
            created_at: metadata.created_at
          }
          let encrypted
          try {
            encrypted = this.cipher.encrypt(
              canonicalH2Json({ purpose: requestPurpose, binding, request })
            )
          } catch {
            throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_UNAVAILABLE')
          }
          this.adminAuthority(request, controllerId, administratorId)
          if (
            canonicalH2Json(this.read(request.scope, metadata.revision).metadata) !==
            canonicalH2Json(metadata)
          )
            throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_UNAVAILABLE')
          this.db
            .prepare(
              `INSERT INTO product_environment_request
          (controller_id,administrator_id,request_key,app_id,ownership_generation,revision,created_at,
          crypto_scheme,encrypted_secret,iv,auth_tag) VALUES(?,?,?,?,?,?,?,?,?,?,?)`
            )
            .run(
              controllerId,
              administratorId,
              request_key,
              metadata.app_id,
              metadata.ownership_generation,
              metadata.revision,
              metadata.created_at,
              encrypted.crypto_scheme,
              encrypted.encrypted_secret,
              encrypted.iv,
              encrypted.auth_tag
            )
          const persisted = this.receipt(request_key, administratorId, request.scope)
          if (
            !persisted ||
            canonicalH2Json(persisted.request) !== canonicalH2Json(request) ||
            canonicalH2Json(persisted.metadata) !== canonicalH2Json(metadata)
          )
            throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_UNAVAILABLE')
          this.adminAuthority(request, controllerId, administratorId)
          return { state: 'staged' as const, request_key, metadata }
        })
        .immediate()
    })
  }

  /** Chỉ metadata; lost reply có thể tra request UUID mà không gửi lại values. */
  state(input: unknown, controllerId: string, administratorId: string): ProductEnvironmentState {
    return this.guarded(() => {
      const parsed = environmentStateSchema.safeParse(input)
      if (!parsed.success) throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_INPUT_INVALID')
      const request = parsed.data
      return this.db
        .transaction(() => {
          this.adminAuthority(request, controllerId, administratorId)
          const latest = this.db
            .prepare(
              `SELECT MAX(revision) AS revision FROM product_environment_revision
          WHERE app_id=? AND ownership_generation=?`
            )
            .get(request.scope.app_id, request.scope.ownership_generation) as {
            revision: number | null
          }
          const requested =
            request.request_key === null
              ? null
              : this.receipt(request.request_key, administratorId, request.scope)
          const metadata =
            latest.revision === null ? null : this.read(request.scope, latest.revision).metadata
          this.adminAuthority(request, controllerId, administratorId)
          return {
            scope: request.scope,
            source_generation: request.expected_source_generation,
            source_config_sha256: request.expected_source_config_sha256,
            latest: metadata,
            request_key: request.request_key,
            requested: requested?.metadata ?? null
          }
        })
        .deferred()
    })
  }

  private adminAuthority(
    request: Pick<
      ProductEnvironmentWriteInput,
      'scope' | 'expected_source_generation' | 'expected_source_config_sha256'
    >,
    controllerId: string,
    administratorId: string
  ): void {
    if (
      !/^unix:(0|[1-9][0-9]{0,9})$/.test(administratorId) ||
      request.scope.controller_id !== controllerId
    )
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED')
    const controllers = this.db
      .prepare('SELECT controller_id,status FROM product_controller')
      .all() as { controller_id: string; status: string }[]
    if (
      controllers.length !== 1 ||
      controllers[0].controller_id !== controllerId ||
      controllers[0].status !== 'active'
    )
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED')
    const current = this.authorize(request.scope)
    if (
      current.source_generation !== request.expected_source_generation ||
      current.source_config_sha256 !== request.expected_source_config_sha256
    )
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_SOURCE_CHANGED')
  }

  private receipt(
    key: string,
    administratorId: string,
    scope: ProductEnvironmentScope
  ): {
    request: z.output<typeof environmentStageSchema>
    metadata: ProductEnvironmentMetadata
  } | null {
    const found = this.db
      .prepare(
        `SELECT * FROM product_environment_request
      WHERE controller_id=? AND administrator_id=? AND request_key=?`
      )
      .get(scope.controller_id, administratorId, key)
    if (!found) return null
    try {
      const row = receiptSchema.parse(found)
      const binding = {
        controller_id: row.controller_id,
        administrator_id: row.administrator_id,
        request_key: row.request_key,
        app_id: row.app_id,
        ownership_generation: row.ownership_generation,
        revision: row.revision,
        created_at: row.created_at
      }
      const decoded = JSON.parse(this.cipher.decrypt(row))
      if (
        !decoded ||
        Object.keys(decoded).sort().join(',') !== 'binding,purpose,request' ||
        decoded.purpose !== requestPurpose ||
        canonicalH2Json(decoded.binding) !== canonicalH2Json(binding)
      )
        throw Error()
      const request = environmentStageSchema.parse(decoded.request)
      if (
        request.request_key !== key ||
        canonicalH2Json(request.scope) !== canonicalH2Json(scope) ||
        row.app_id !== scope.app_id ||
        row.ownership_generation !== scope.ownership_generation
      )
        throw Error()
      const stored = this.read(scope, row.revision)
      if (
        stored.metadata.created_at !== row.created_at ||
        stored.metadata.basis_source_generation !== request.expected_source_generation ||
        stored.metadata.basis_source_config_sha256 !== request.expected_source_config_sha256 ||
        canonicalH2Json(stored.values) !== canonicalH2Json(request.values)
      )
        throw Error()
      return { request, metadata: stored.metadata }
    } catch {
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_UNAVAILABLE')
    }
  }

  private appendRevision(request: ProductEnvironmentWriteInput): ProductEnvironmentMetadata {
    const authority = this.authorize(request.scope)
    if (
      authority.source_generation !== request.expected_source_generation ||
      authority.source_config_sha256 !== request.expected_source_config_sha256
    )
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_SOURCE_CHANGED')
    const values = validateEnvironmentValues(request.values, authority.framework)
    const latest = this.db
      .prepare(
        'SELECT MAX(revision) AS revision FROM product_environment_revision WHERE app_id=? AND ownership_generation=?'
      )
      .get(request.scope.app_id, request.scope.ownership_generation) as {
      revision: number | null
    }
    if (
      latest.revision !== request.expected_latest_revision ||
      latest.revision === Number.MAX_SAFE_INTEGER
    )
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_REVISION_CONFLICT')
    const metadata: ProductEnvironmentMetadata = {
      controller_id: request.scope.controller_id,
      app_id: request.scope.app_id,
      ownership_generation: request.scope.ownership_generation,
      revision: (latest.revision ?? 0) + 1,
      basis_source_generation: authority.source_generation,
      basis_source_config_sha256: authority.source_config_sha256,
      framework: authority.framework,
      runtime_keys: Object.keys(values.runtime_env).sort(),
      public_build_keys: Object.keys(values.public_build_args).sort(),
      created_at: new Date().toISOString(),
      activation: 'staged'
    }
    let encrypted
    try {
      encrypted = this.cipher.encrypt(
        canonicalH2Json({ purpose, scope: request.scope, metadata, values })
      )
    } catch {
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_UNAVAILABLE')
    }
    // Crypto thành công chưa đủ: callbacks/custom cipher không được vượt authority CAS.
    if (canonicalH2Json(this.authorize(request.scope)) !== canonicalH2Json(authority))
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_SOURCE_CHANGED')
    this.db
      .prepare(
        `INSERT INTO product_environment_revision
    (controller_id,app_id,ownership_generation,revision,basis_source_generation,basis_source_config_sha256,
     target_binding_json,framework,runtime_keys_json,public_build_keys_json,crypto_scheme,encrypted_secret,iv,auth_tag,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        metadata.controller_id,
        metadata.app_id,
        metadata.ownership_generation,
        metadata.revision,
        metadata.basis_source_generation,
        metadata.basis_source_config_sha256,
        canonicalH2Json(request.scope.target),
        metadata.framework,
        JSON.stringify(metadata.runtime_keys),
        JSON.stringify(metadata.public_build_keys),
        encrypted.crypto_scheme,
        encrypted.encrypted_secret,
        encrypted.iv,
        encrypted.auth_tag,
        metadata.created_at
      )
    return metadata
  }

  metadata(scope: ProductEnvironmentScope, revision: number): ProductEnvironmentMetadata {
    return this.guarded(() => this.read(scope, revision).metadata)
  }

  /** Main-only. Future executor phải bind revision với source claim trước và sau decrypt. */
  readValues(scope: ProductEnvironmentScope, revision: number): ProductEnvironmentValues {
    return this.guarded(() => this.read(scope, revision).values)
  }

  private read(
    input: ProductEnvironmentScope,
    revision: number
  ): { metadata: ProductEnvironmentMetadata; values: ProductEnvironmentValues } {
    const scope = environmentScopeSchema.safeParse(input)
    if (!scope.success || !positive.safeParse(revision).success)
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_INPUT_INVALID')
    const authority = this.authorize(scope.data)
    const found = this.db
      .prepare(
        'SELECT * FROM product_environment_revision WHERE app_id=? AND ownership_generation=? AND revision=?'
      )
      .get(scope.data.app_id, scope.data.ownership_generation, revision)
    if (!found) throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_UNAVAILABLE')
    try {
      const row = rowSchema.parse(found)
      if (
        row.controller_id !== scope.data.controller_id ||
        row.framework !== authority.framework ||
        row.target_binding_json !== canonicalH2Json(scope.data.target)
      )
        throw Error()
      const decoded = JSON.parse(this.cipher.decrypt(row))
      if (
        !decoded ||
        Object.keys(decoded).sort().join(',') !== 'metadata,purpose,scope,values' ||
        decoded.purpose !== purpose ||
        canonicalH2Json(decoded.scope) !== canonicalH2Json(scope.data)
      )
        throw Error()
      const values = validateEnvironmentValues(decoded.values, row.framework)
      const metadata = this.rowMetadata(row, values)
      if (canonicalH2Json(decoded.metadata) !== canonicalH2Json(metadata)) throw Error()
      if (this.authorize(scope.data).framework !== row.framework) throw Error()
      return { metadata, values }
    } catch {
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_UNAVAILABLE')
    }
  }

  private rowMetadata(row: Row, values: ProductEnvironmentValues): ProductEnvironmentMetadata {
    const runtime = Object.keys(values.runtime_env).sort(),
      build = Object.keys(values.public_build_args).sort()
    if (
      row.runtime_keys_json !== JSON.stringify(runtime) ||
      row.public_build_keys_json !== JSON.stringify(build)
    )
      throw Error()
    return {
      controller_id: row.controller_id,
      app_id: row.app_id,
      ownership_generation: row.ownership_generation,
      revision: row.revision,
      basis_source_generation: row.basis_source_generation,
      basis_source_config_sha256: row.basis_source_config_sha256,
      framework: row.framework,
      runtime_keys: runtime,
      public_build_keys: build,
      created_at: row.created_at,
      activation: 'staged'
    }
  }

  private authorize(scope: ProductEnvironmentScope): Authority {
    const row = this.db
      .prepare(
        `SELECT p.controller_id,p.ownership_generation,p.source_generation,p.source_config_sha256,p.mode,c.status,
      a.framework,a.vps_id,v.host,v.port,v.username,v.auth_type,v.host_fingerprint,v.ssh_security_revision,v.archived_at,
      s.config_sha256,s.deploy_config_json FROM product_app_control p JOIN product_controller c ON c.controller_id=p.controller_id
      JOIN app a ON a.id=p.app_id JOIN vps v ON v.id=a.vps_id
      JOIN product_source_config s ON s.app_id=p.app_id AND s.source_generation=p.source_generation WHERE p.app_id=?`
      )
      .get(scope.app_id) as
      | (Authority & {
          controller_id: string
          ownership_generation: number
          mode: string
          status: string
          vps_id: number
          host: string
          port: number
          username: string
          auth_type: string
          host_fingerprint: string
          ssh_security_revision: number
          archived_at: string | null
          config_sha256: string
          deploy_config_json: string
        })
      | undefined
    if (
      !row ||
      row.mode !== 'product' ||
      row.status !== 'active' ||
      row.archived_at !== null ||
      row.controller_id !== scope.controller_id ||
      row.ownership_generation !== scope.ownership_generation ||
      row.config_sha256 !== row.source_config_sha256 ||
      !['nextjs', 'express', 'static-spa'].includes(row.framework) ||
      canonicalH2Json(scope.target) !==
        canonicalH2Json({
          vps_id: row.vps_id,
          host: row.host,
          port: row.port,
          username: row.username,
          auth_type: row.auth_type,
          host_fingerprint: row.host_fingerprint,
          ssh_security_revision: row.ssh_security_revision
        })
    )
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED')
    try {
      const config = JSON.parse(row.deploy_config_json)
      if (
        Buffer.byteLength(row.deploy_config_json) > 65536 ||
        !config ||
        typeof config !== 'object' ||
        Array.isArray(config) ||
        (config.framework === undefined
          ? row.framework !== 'express'
          : config.framework !== row.framework) ||
        createHash('sha256').update(canonicalH2Json(config)).digest('hex') !==
          row.source_config_sha256
      )
        throw Error()
    } catch {
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED')
    }
    return {
      framework: row.framework,
      source_generation: row.source_generation,
      source_config_sha256: row.source_config_sha256
    }
  }

  private guarded<T>(operation: () => T): T {
    if (this.db.inTransaction)
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_INPUT_INVALID')
    try {
      return operation()
    } catch (error) {
      if (error instanceof ProductEnvironmentError) throw error
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_STORAGE_UNAVAILABLE')
    }
  }
}
