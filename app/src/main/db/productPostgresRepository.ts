import { randomBytes, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import type {
  ProductPostgresCredentials,
  ProductPostgresMetadata,
  ProductPostgresPrepareResult,
  ProductPostgresPrepareLookup
} from '../../../../docs/contracts/product-postgres'
import type { ProductEnvironmentScope } from '../../../../docs/contracts/product-environment'
import type { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { canonicalH2Json } from '../controlPlane/productH2Proof'
import { TargetEnrollmentRepository } from '../controlPlane/targetEnrollmentRepository'
import {
  PRODUCT_POSTGRES_IMAGE,
  postgresPrepareSchema,
  postgresStateSchema,
  ProductPostgresError
} from '../controlPlane/productPostgres'

const uuid = z.uuidv4().refine((value) => value === value.toLowerCase())
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const password = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const credentialsSchema = z.strictObject({
  administrator_password: password,
  application_password: password
})
const rowSchema = z.strictObject({
  database_id: uuid,
  controller_id: z.string(),
  app_id: positive,
  ownership_generation: positive,
  target_binding_json: z.string().max(4096),
  framework: z.enum(['express', 'nextjs']),
  image: z.string().regex(/^postgres:16-alpine@sha256:[a-f0-9]{64}$/),
  crypto_scheme: z.literal('aes_256_gcm'),
  encrypted_secret: z
    .instanceof(Buffer)
    .refine((value) => value.length > 0 && value.length <= 8192),
  iv: z.instanceof(Buffer).refine((value) => value.length === 12),
  auth_tag: z.instanceof(Buffer).refine((value) => value.length === 16),
  created_at: z.iso.datetime()
})
type Row = z.output<typeof rowSchema>
const purpose = 'opspilot-product-postgres-credentials-v1'

/** Prepared resource only. No SSH, volume creation, source selection or key initialization. */
export class ProductPostgresRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly cipher: AesGcmCredentialCipher
  ) {}

  prepare(
    input: unknown,
    controllerId: string,
    administrator: string
  ): ProductPostgresPrepareResult {
    return this.guarded(() => {
      const parsed = postgresPrepareSchema.safeParse(input)
      if (
        !parsed.success ||
        parsed.data.scope.controller_id !== controllerId ||
        !/^unix:(0|[1-9][0-9]{0,15})$/.test(administrator) ||
        this.db.inTransaction
      )
        throw new ProductPostgresError('PRODUCT_POSTGRES_INPUT_INVALID')
      const request = parsed.data
      return this.db
        .transaction(() => {
          const authority = this.authorize(request.scope, true)
          if (
            authority.source_generation !== request.expected_source_generation ||
            authority.source_config_sha256 !== request.expected_source_config_sha256
          )
            throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
          const receipt = this.db
            .prepare(
              `SELECT request_json,database_id FROM product_managed_postgres_request
          WHERE controller_id=? AND administrator_id=? AND request_key=?`
            )
            .get(controllerId, administrator, request.request_key) as
            { request_json: string; database_id: string } | undefined
          const body = canonicalH2Json(request)
          if (receipt && receipt.request_json !== body)
            throw new ProductPostgresError('PRODUCT_POSTGRES_REQUEST_CONFLICT')
          let row = this.row(request.scope)
          const existed = !!row
          if (receipt && (!row || row.database_id !== receipt.database_id))
            throw new ProductPostgresError('PRODUCT_POSTGRES_UNAVAILABLE')
          if (!row) {
            const metadata: ProductPostgresMetadata = {
              database_id: randomUUID(),
              controller_id: controllerId,
              app_id: request.scope.app_id,
              ownership_generation: request.scope.ownership_generation,
              framework: authority.framework,
              engine: 'postgresql',
              major: 16,
              image: PRODUCT_POSTGRES_IMAGE,
              database_name: 'opspilot',
              application_user: 'opspilot',
              administrator_user: 'postgres',
              created_at: new Date().toISOString(),
              provisioning: 'prepared'
            }
            const credentials = {
              administrator_password: randomBytes(32).toString('base64url'),
              application_password: randomBytes(32).toString('base64url')
            }
            const encoded = this.cipher.encrypt(
              canonicalH2Json({ purpose, metadata, target: request.scope.target, credentials })
            )
            // Cipher callbacks may run code; recheck authority before publishing the resource.
            if (canonicalH2Json(this.authorize(request.scope, true)) !== canonicalH2Json(authority))
              throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
            this.db
              .prepare(
                `INSERT INTO product_managed_postgres
            (database_id,controller_id,app_id,ownership_generation,target_binding_json,framework,image,
             crypto_scheme,encrypted_secret,iv,auth_tag,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
              )
              .run(
                metadata.database_id,
                controllerId,
                metadata.app_id,
                metadata.ownership_generation,
                canonicalH2Json(request.scope.target),
                metadata.framework,
                metadata.image,
                encoded.crypto_scheme,
                encoded.encrypted_secret,
                encoded.iv,
                encoded.auth_tag,
                metadata.created_at
              )
            row = this.row(request.scope)!
          }
          this.assertRow(row, request.scope, authority.framework)
          this.decrypt(row, request.scope)
          if (canonicalH2Json(this.authorize(request.scope, true)) !== canonicalH2Json(authority))
            throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
          if (!receipt)
            this.db
              .prepare(
                `INSERT INTO product_managed_postgres_request
          (controller_id,administrator_id,request_key,request_json,database_id,created_at) VALUES (?,?,?,?,?,?)`
              )
              .run(
                controllerId,
                administrator,
                request.request_key,
                body,
                row.database_id,
                new Date().toISOString()
              )
          return {
            state: existed ? ('already_prepared' as const) : ('prepared' as const),
            request_key: request.request_key,
            metadata: this.metadata(row)
          }
        })
        .immediate()
    })
  }

  /** Exact receipt lookup, including after desired-source changes. No prepare replay. */
  lookupPrepare(
    input: unknown,
    controllerId: string,
    administrator: string
  ): ProductPostgresPrepareLookup {
    if (this.db.inTransaction) throw new ProductPostgresError('PRODUCT_POSTGRES_INPUT_INVALID')
    return this.guarded(() => {
      const parsed = postgresPrepareSchema.safeParse(input)
      if (
        !parsed.success ||
        parsed.data.scope.controller_id !== controllerId ||
        !/^unix:(0|[1-9][0-9]{0,15})$/.test(administrator)
      )
        throw new ProductPostgresError('PRODUCT_POSTGRES_INPUT_INVALID')
      const request = parsed.data
      return this.db.transaction(() => {
        const authority = this.authorize(request.scope, false)
        const receipt = this.db
          .prepare(
            `SELECT request_json,database_id FROM product_managed_postgres_request
          WHERE controller_id=? AND administrator_id=? AND request_key=?`
          )
          .get(controllerId, administrator, request.request_key) as
          { request_json: string; database_id: string } | undefined
        if (!receipt)
          return {
            result: null,
            definitively_unapplied: authority.source_generation > request.expected_source_generation
          }
        if (receipt.request_json !== canonicalH2Json(request))
          throw new ProductPostgresError('PRODUCT_POSTGRES_REQUEST_CONFLICT')
        const row = this.row(request.scope)
        if (!row || row.database_id !== receipt.database_id)
          throw new ProductPostgresError('PRODUCT_POSTGRES_UNAVAILABLE')
        this.assertRow(row, request.scope, authority.framework)
        this.decrypt(row, request.scope)
        if (canonicalH2Json(this.authorize(request.scope, false)) !== canonicalH2Json(authority))
          throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
        return {
          result: {
            state: 'already_prepared' as const,
            request_key: request.request_key,
            metadata: this.metadata(row)
          },
          definitively_unapplied: false
        }
      })()
    })
  }

  state(input: unknown): ProductPostgresMetadata | null {
    return this.guarded(() => {
      const parsed = postgresStateSchema.safeParse(input)
      if (!parsed.success) throw new ProductPostgresError('PRODUCT_POSTGRES_INPUT_INVALID')
      return this.db.transaction(() => {
        const authority = this.authorize(parsed.data.scope, false),
          row = this.row(parsed.data.scope)
        if (!row) return null
        this.assertRow(row, parsed.data.scope, authority.framework)
        return this.metadata(row)
      })()
    })
  }

  /** Internal capability; runtime must separately fence the exact claimed source/lease. */
  readCredentials(scope: ProductEnvironmentScope, databaseId: string): ProductPostgresCredentials {
    return this.guarded(() => {
      const parsed = postgresStateSchema.safeParse({ format: 1, scope })
      if (!parsed.success || !uuid.safeParse(databaseId).success || this.db.inTransaction)
        throw new ProductPostgresError('PRODUCT_POSTGRES_INPUT_INVALID')
      const bound = parsed.data.scope
      return this.db.transaction(() => {
        const authority = this.authorize(bound, false),
          row = this.row(bound)
        if (!row || row.database_id !== databaseId)
          throw new ProductPostgresError('PRODUCT_POSTGRES_UNAVAILABLE')
        this.assertRow(row, bound, authority.framework)
        const credentials = this.decrypt(row, bound)
        if (canonicalH2Json(this.authorize(bound, false)) !== canonicalH2Json(authority))
          throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
        return credentials
      })()
    })
  }

  /** Selection transaction validates availability without returning credentials. */
  verifyAvailableInTransaction(
    scope: ProductEnvironmentScope,
    databaseId: string
  ): ProductPostgresMetadata {
    return this.guarded(() => {
      const parsed = postgresStateSchema.safeParse({ format: 1, scope })
      if (!parsed.success || !uuid.safeParse(databaseId).success || !this.db.inTransaction)
        throw new ProductPostgresError('PRODUCT_POSTGRES_INPUT_INVALID')
      const bound = parsed.data.scope,
        authority = this.authorize(bound, false),
        row = this.row(bound)
      if (!row || row.database_id !== databaseId)
        throw new ProductPostgresError('PRODUCT_POSTGRES_UNAVAILABLE')
      this.assertRow(row, bound, authority.framework)
      this.decrypt(row, bound)
      if (canonicalH2Json(this.authorize(bound, false)) !== canonicalH2Json(authority))
        throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
      return this.metadata(row)
    })
  }

  private row(scope: ProductEnvironmentScope): Row | undefined {
    const value = this.db
      .prepare(
        `SELECT * FROM product_managed_postgres
      WHERE controller_id=? AND app_id=? AND ownership_generation=?`
      )
      .get(scope.controller_id, scope.app_id, scope.ownership_generation)
    return value ? rowSchema.parse(value) : undefined
  }
  private metadata(row: Row): ProductPostgresMetadata {
    return {
      database_id: row.database_id,
      controller_id: row.controller_id,
      app_id: row.app_id,
      ownership_generation: row.ownership_generation,
      framework: row.framework,
      engine: 'postgresql',
      major: 16,
      image: row.image,
      database_name: 'opspilot',
      application_user: 'opspilot',
      administrator_user: 'postgres',
      created_at: row.created_at,
      provisioning: 'prepared'
    }
  }
  private assertRow(row: Row, scope: ProductEnvironmentScope, framework: string): void {
    if (row.target_binding_json !== canonicalH2Json(scope.target) || row.framework !== framework)
      throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
  }
  private decrypt(row: Row, scope: ProductEnvironmentScope): ProductPostgresCredentials {
    const payload = z
      .strictObject({
        purpose: z.literal(purpose),
        metadata: z.unknown(),
        target: z.unknown(),
        credentials: credentialsSchema
      })
      .parse(JSON.parse(this.cipher.decrypt(row)))
    if (
      canonicalH2Json(payload.metadata) !== canonicalH2Json(this.metadata(row)) ||
      canonicalH2Json(payload.target) !== canonicalH2Json(scope.target) ||
      payload.credentials.administrator_password === payload.credentials.application_password
    )
      throw new ProductPostgresError('PRODUCT_POSTGRES_UNAVAILABLE')
    return payload.credentials
  }
  private authorize(
    scope: ProductEnvironmentScope,
    paused: boolean
  ): { framework: 'express' | 'nextjs'; source_generation: number; source_config_sha256: string } {
    let target
    try {
      target = new TargetEnrollmentRepository(this.db).target(
        scope.controller_id,
        scope.app_id,
        scope.ownership_generation,
        paused
      )
    } catch {
      throw new ProductPostgresError(
        paused ? 'PRODUCT_POSTGRES_REQUIRES_QUIESCENCE' : 'PRODUCT_POSTGRES_AUTHORITY_CHANGED'
      )
    }
    if (canonicalH2Json(target) !== canonicalH2Json(scope.target))
      throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
    const context = this.db
      .prepare(
        `SELECT a.framework,c.source_generation,c.source_config_sha256
      FROM app a JOIN product_app_control c ON c.app_id=a.id WHERE a.id=?`
      )
      .get(scope.app_id) as {
      framework: string
      source_generation: number
      source_config_sha256: string
    }
    if (!['express', 'nextjs'].includes(context.framework))
      throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
    if (
      paused &&
      this.db
        .prepare(
          `SELECT 1 FROM product_worker_lease w JOIN product_deploy_job j ON j.job_id=w.job_id
      WHERE j.app_id=? AND w.released_at IS NULL UNION ALL
      SELECT 1 FROM product_deploy_attempt a JOIN product_deploy_job j ON j.job_id=a.job_id
      WHERE j.app_id=? AND (a.remote_outcome='unknown' OR a.state='uncertain') UNION ALL
      SELECT 1 FROM product_runtime_execution r JOIN product_deploy_attempt a ON a.attempt_id=r.attempt_id
      JOIN product_deploy_job j ON j.job_id=a.job_id LEFT JOIN product_runtime_terminal t ON t.attempt_id=r.attempt_id
      WHERE j.app_id=? AND (t.attempt_id IS NULL OR t.settled_at IS NULL OR t.leases_released_at IS NULL) LIMIT 1`
        )
        .get(scope.app_id, scope.app_id, scope.app_id)
    )
      throw new ProductPostgresError('PRODUCT_POSTGRES_REQUIRES_QUIESCENCE')
    return { ...context, framework: context.framework as 'express' | 'nextjs' }
  }
  private guarded<T>(run: () => T): T {
    try {
      return run()
    } catch (error) {
      if (error instanceof ProductPostgresError) throw error
      throw new ProductPostgresError('PRODUCT_POSTGRES_UNAVAILABLE')
    }
  }
}
