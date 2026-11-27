import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import type { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import type {
  ProductPostgresInspectionContext,
  ProductPostgresInspectionResult
} from '../../../../docs/contracts/product-postgres-inspection'
import inspectionSource from './target_postgres_inspection.py?raw'
import {
  postgresInspectionInputSchema,
  reviewPostgresInspection
} from './productPostgresInspection'
import { canonicalH2Json } from './productH2Proof'
import { postgresMetadataSchema } from './productPostgres'
import type { ProductPostgresInspectionRequest } from '../../../../docs/contracts/product-postgres-inspection'
import { ProductPostgresRepository } from '../db/productPostgresRepository'
import { readVerifiedControllerBundleFile, type VerifiedControllerBundle } from './controllerBundle'
import { assertProductPostgresTargetManifest } from './productPostgresCommands'
import { TargetEnrollmentRepository } from './targetEnrollmentRepository'
import { readEnrolledProductTarget, exchangeProductBootstrapJson } from './targetEnrollment'
import { loadControllerRuntimeKey } from './controllerRuntimeKeys'
import { createControllerSshResolver } from './controllerSshResolver'
import { observeProductTarget } from './controllerTargetProbe'
import { SshManager } from '../ssh/manager'

const identifier = z
  .string()
  .min(1)
  .refine(
    (value) =>
      Buffer.byteLength(value, 'utf8') <= 63 &&
      [...value].every(
        (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127
      )
  )
export const postgresInspectionOperationSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('inspect') }),
  z.strictObject({ operation: z.literal('tables') }),
  z.strictObject({
    operation: z.literal('rows'),
    schema: identifier.refine((s) => !s.startsWith('pg_') && s !== 'information_schema'),
    table: identifier,
    limit: z.number().int().min(1).max(100)
  })
])
export const postgresInspectionRequestSchema = z.strictObject({
  context: postgresInspectionInputSchema,
  read: postgresInspectionOperationSchema
})
export const postgresInspectionCommandSchema = z.strictObject({
  artifact: z.string().min(1).max(4096),
  manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  inspection: postgresInspectionRequestSchema
})
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const runtimeSchema = z.strictObject({
  database_id: z.uuidv4(),
  container_id: hash,
  image_id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  volume: z.string().min(1).max(128),
  volume_created_at: z.string().min(1).max(64),
  system_identifier: z.string().regex(/^[0-9]{1,20}$/),
  state: z.literal('ready'),
  public_port: z.null()
})
const column = z.strictObject({
  name: identifier,
  data_type: z.string().min(1).max(512),
  nullable: z.boolean()
})
const tables = z
  .array(
    z.strictObject({ schema: identifier, name: identifier, columns: z.array(column).max(128) })
  )
  .max(200)
const rows = z.array(z.record(identifier, z.unknown())).max(100)
const resultSchema = z.strictObject({
  format: z.literal(1),
  operation: postgresInspectionOperationSchema,
  instance: runtimeSchema,
  data: z.unknown()
})
export const postgresInspectionErrorCodes = [
  'POSTGRES_INSPECTION_INPUT_INVALID',
  'POSTGRES_INSPECTION_UNAVAILABLE',
  'POSTGRES_INSPECTION_NOT_READY',
  'POSTGRES_INSPECTION_TIMEOUT',
  'POSTGRES_INSPECTION_RESULT_LIMIT',
  'POSTGRES_INSPECTION_RELATION_UNAVAILABLE',
  'POSTGRES_INSPECTION_AUTHORITY_CHANGED'
] as const
const safeCodes = postgresInspectionErrorCodes
export class ProductPostgresInspectionError extends Error {
  constructor(readonly code: (typeof safeCodes)[number]) {
    super(code)
  }
}
const wireSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), data: resultSchema }),
  z.strictObject({ ok: z.literal(false), code: z.enum(safeCodes) })
])

/** Revalidate metadata-only DTOs at the admin/Main boundary. No caller may
 * replace scope/operation/instance or append credentials to a response.
 */
export const postgresInspectionResultSchema = z.strictObject({
  context: z.strictObject({
    state: z.literal('configuration_verified'),
    controller_id: z.string().min(1).max(128),
    app_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    ownership_generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    source_generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    source_config_sha256: hash,
    target_security_revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    database: postgresMetadataSchema,
    runtime_status: z.literal('not_checked')
  }),
  read: postgresInspectionOperationSchema,
  instance: runtimeSchema,
  checked_at: z.iso.datetime(),
  data: z.unknown()
})
export function validatePostgresInspectionResult(
  input: unknown,
  request: ProductPostgresInspectionRequest
): ProductPostgresInspectionResult {
  const parsed = postgresInspectionResultSchema.safeParse(input)
  if (!parsed.success) throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_UNAVAILABLE')
  const value = parsed.data,
    c = value.context,
    expected = request.context
  if (
    c.controller_id !== expected.controller_id ||
    c.app_id !== expected.app_id ||
    c.ownership_generation !== expected.expected_ownership_generation ||
    c.source_generation !== expected.expected_source_generation ||
    c.source_config_sha256 !== expected.expected_source_config_sha256 ||
    c.target_security_revision !== expected.expected_target_security_revision ||
    c.database.database_id !== expected.database_id ||
    c.database.controller_id !== expected.controller_id ||
    c.database.app_id !== expected.app_id ||
    c.database.ownership_generation !== expected.expected_ownership_generation ||
    value.instance.database_id !== expected.database_id ||
    value.instance.volume !== `opspilot-pg-${expected.database_id}-data` ||
    canonicalH2Json(value.read) !== canonicalH2Json(request.read)
  )
    throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_AUTHORITY_CHANGED')
  if (value.read.operation === 'inspect') {
    if (value.data !== null)
      throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_UNAVAILABLE')
    return { ...value, data: null }
  }
  const data =
    value.read.operation === 'tables' ? tables.safeParse(value.data) : rows.safeParse(value.data)
  if (!data.success) throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_UNAVAILABLE')
  if (value.read.operation === 'rows' && data.data.length > value.read.limit)
    throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_RESULT_LIMIT')
  return { ...value, data: data.data }
}

/** Controller-only finite target reader. No HTTP admin endpoint, provisioning,
 * job/lease identity or arbitrary SQL. Input paths/pins are from trusted CLI/Main
 * composition. All authority is repeated after I/O before releasing data.
 */
export class ProductPostgresInspectorCommands {
  constructor(
    private readonly db: Database.Database,
    private readonly cipher: AesGcmCredentialCipher,
    private readonly directory: string,
    private readonly controllerId: string,
    private readonly bundle: VerifiedControllerBundle,
    private readonly options: {
      readTarget?: (
        context: ProductPostgresInspectionContext,
        read: z.output<typeof postgresInspectionOperationSchema>,
        signal: AbortSignal
      ) => Promise<unknown>
    } = {}
  ) {}

  async read(input: unknown, parentSignal?: AbortSignal): Promise<ProductPostgresInspectionResult> {
    const parsed = postgresInspectionRequestSchema.safeParse(input)
    if (!parsed.success)
      throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_INPUT_INVALID')
    const request = parsed.data
    const before = reviewPostgresInspection(
      this.db,
      this.cipher,
      this.controllerId,
      request.context
    )
    const signal = parentSignal
      ? AbortSignal.any([parentSignal, AbortSignal.timeout(60000)])
      : AbortSignal.timeout(60000)
    if (signal.aborted) throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_TIMEOUT')
    let raw: unknown
    try {
      raw = this.options.readTarget
        ? await this.options.readTarget(
            structuredClone(before),
            structuredClone(request.read),
            signal
          )
        : await this.target(before, request, signal)
    } catch (error) {
      if (signal.aborted) throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_TIMEOUT')
      if (error instanceof ProductPostgresInspectionError) throw error
      throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_UNAVAILABLE')
    }
    if (signal.aborted) throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_TIMEOUT')
    let after: ProductPostgresInspectionContext
    try {
      after = reviewPostgresInspection(this.db, this.cipher, this.controllerId, request.context)
    } catch {
      throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_AUTHORITY_CHANGED')
    }
    if (canonicalH2Json(before) !== canonicalH2Json(after))
      throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_AUTHORITY_CHANGED')
    const wire = wireSchema.safeParse(raw)
    if (!wire.success) throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_UNAVAILABLE')
    if (!wire.data.ok) throw new ProductPostgresInspectionError(wire.data.code)
    const value = wire.data.data
    if (
      canonicalH2Json(value.operation) !== canonicalH2Json(request.read) ||
      value.instance.database_id !== before.database.database_id ||
      value.instance.volume !== `opspilot-pg-${before.database.database_id}-data`
    )
      throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_AUTHORITY_CHANGED')
    let data: ProductPostgresInspectionResult['data']
    if (request.read.operation === 'inspect') {
      if (value.data !== null)
        throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_UNAVAILABLE')
      data = null
    } else if (request.read.operation === 'tables') {
      const parsedTables = tables.safeParse(value.data)
      if (!parsedTables.success)
        throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_UNAVAILABLE')
      data = parsedTables.data
    } else {
      const parsedRows = rows.safeParse(value.data)
      if (!parsedRows.success)
        throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_UNAVAILABLE')
      data = parsedRows.data
      if (data.length > request.read.limit)
        throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_RESULT_LIMIT')
    }
    return {
      context: after,
      read: request.read,
      instance: value.instance,
      checked_at: new Date().toISOString(),
      data
    }
  }

  private async target(
    before: ProductPostgresInspectionContext,
    request: z.output<typeof postgresInspectionRequestSchema>,
    signal: AbortSignal
  ): Promise<unknown> {
    const repository = new TargetEnrollmentRepository(this.db)
    const target = repository.target(
      this.controllerId,
      before.app_id,
      before.ownership_generation,
      false
    )
    const scope = {
      controller_id: this.controllerId,
      app_id: before.app_id,
      ownership_generation: before.ownership_generation,
      target
    }
    const row = repository.get(scope)
    if (!row || row.state !== 'enrolled')
      throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_NOT_READY')
    const payload = readEnrolledProductTarget(
      this.db,
      this.directory,
      this.controllerId,
      before.app_id,
      before.ownership_generation,
      row.manifest_sha256
    )
    const assertCurrent = (): void => {
      repository.assertCurrent(payload, false)
      if (
        canonicalH2Json(
          reviewPostgresInspection(this.db, this.cipher, this.controllerId, request.context)
        ) !== canonicalH2Json(before) ||
        canonicalH2Json(payload.target) !== canonicalH2Json(target)
      )
        throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_AUTHORITY_CHANGED')
    }
    assertCurrent()
    const key = loadControllerRuntimeKey(this.directory, scope)
    const ssh = new SshManager(
      createControllerSshResolver(this.db, this.controllerId, this.directory)
    )
    try {
      const observed = await observeProductTarget(
        this.db,
        this.controllerId,
        payload,
        ssh,
        false,
        signal
      )
      assertProductPostgresTargetManifest(observed.manifest)
      const enrollment = readVerifiedControllerBundleFile(
        this.bundle,
        'target-helper/target_enrollment.py'
      )
      const marker = '__POSTGRES_INSPECTION_ENROLLMENT_SHA256__'
      if (inspectionSource.split(marker).length !== 2)
        throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_UNAVAILABLE')
      const script = inspectionSource.replace(
        marker,
        createHash('sha256').update(enrollment).digest('hex')
      )
      assertCurrent()
      const opened = await ssh.openProductBootstrapChannel(
        target.vps_id,
        { text: script, sha256: createHash('sha256').update(script).digest('hex') },
        {
          signal,
          timeoutMs: 60000,
          expectedIdentity: {
            vpsId: target.vps_id,
            host: target.host,
            port: target.port,
            username: target.username,
            authType: target.auth_type,
            hostFingerprint: target.host_fingerprint
          }
        }
      )
      try {
        assertCurrent()
        const identity = opened.identity
        if (
          identity.vpsId !== target.vps_id ||
          identity.host !== target.host ||
          identity.port !== target.port ||
          identity.username !== target.username ||
          identity.authType !== target.auth_type ||
          identity.hostFingerprint !== target.host_fingerprint
        )
          throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_AUTHORITY_CHANGED')
        const credentials = new ProductPostgresRepository(this.db, this.cipher).readCredentials(
          scope,
          before.database.database_id
        )
        const packet = JSON.stringify({
          format: 1,
          read: request.read,
          database_id: before.database.database_id,
          credentials: {
            admin_password: credentials.administrator_password,
            app_password: credentials.application_password
          },
          enrollment_source: enrollment.toString('utf8'),
          enrollment: {
            format: 1,
            operation: 'inspect',
            payload,
            key: key.toString('base64'),
            manifest: observed.manifest.toString('utf8'),
            helpers: {}
          }
        })
        if (Buffer.byteLength(packet, 'utf8') > 128 * 1024)
          throw new ProductPostgresInspectionError('POSTGRES_INSPECTION_INPUT_INVALID')
        const result = await exchangeProductBootstrapJson(opened.channel, packet, signal, 65 * 1024)
        assertCurrent()
        return result
      } finally {
        opened.channel.destroy()
      }
    } finally {
      key.fill(0)
      await ssh.disconnectAll()
    }
  }
}
