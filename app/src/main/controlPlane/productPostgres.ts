import { z } from 'zod'
import { environmentScopeSchema, environmentMetadataSchema } from './productEnvironment'
import image from '../../../control-plane-runtime/product-postgres-image.json'

export const PRODUCT_POSTGRES_IMAGE = image.image
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
export const postgresStateSchema = z.strictObject({
  format: z.literal(1),
  scope: environmentScopeSchema
})
export const postgresPrepareSchema = postgresStateSchema.extend({
  request_key: z.uuidv4().refine((value) => value === value.toLowerCase()),
  expected_source_generation: positive,
  expected_source_config_sha256: z.string().regex(/^[a-f0-9]{64}$/)
})
export const postgresSelectionSchema = postgresPrepareSchema.extend({ database_id: z.uuidv4() })
export const postgresSelectionCommandSchema = z.strictObject({
  artifact: z.string().min(1).max(4096),
  manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  selection: postgresSelectionSchema
})
export const postgresReferenceSchema = z.strictObject({
  database_id: z.uuidv4(),
  controller_id: z.string().min(1).max(128),
  ownership_generation: positive
})
export const postgresSelectionResultSchema = z.strictObject({
  state: z.enum(['selected', 'already_selected']),
  request_key: z.uuidv4(),
  controller_id: z.string().min(1).max(128),
  app_id: positive,
  ownership_generation: positive,
  source_generation: positive,
  source_config_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  database: postgresReferenceSchema,
  auto_deploy_paused: z.literal(true),
  deployment_started: z.literal(false),
  execution: z.literal('requires_postgres_runtime')
})
export class ProductPostgresError extends Error {
  constructor(
    readonly code:
      | 'PRODUCT_POSTGRES_INPUT_INVALID'
      | 'PRODUCT_POSTGRES_AUTHORITY_CHANGED'
      | 'PRODUCT_POSTGRES_REQUIRES_QUIESCENCE'
      | 'PRODUCT_POSTGRES_REQUEST_CONFLICT'
      | 'PRODUCT_POSTGRES_UNAVAILABLE'
      | 'PRODUCT_POSTGRES_HELPER_UPGRADE_REQUIRED'
  ) {
    super(code)
    this.name = 'ProductPostgresError'
  }
}

export const postgresAdminErrorCodes = [
  'PRODUCT_POSTGRES_INPUT_INVALID',
  'PRODUCT_POSTGRES_AUTHORITY_CHANGED',
  'PRODUCT_POSTGRES_REQUIRES_QUIESCENCE',
  'PRODUCT_POSTGRES_REQUEST_CONFLICT',
  'PRODUCT_POSTGRES_UNAVAILABLE',
  'PRODUCT_POSTGRES_HELPER_UPGRADE_REQUIRED',
  'PRODUCT_POSTGRES_LINUX_REQUIRED',
  'PRODUCT_POSTGRES_ABORTED',
  'PRODUCT_POSTGRES_DATABASE_UNSAFE',
  'PRODUCT_POSTGRES_SCHEMA_UNSUPPORTED'
] as const
export const postgresMetadataSchema = z.strictObject({
  database_id: z.uuidv4(),
  controller_id: z.string().min(1).max(128),
  app_id: positive,
  ownership_generation: positive,
  framework: z.enum(['express', 'nextjs']),
  engine: z.literal('postgresql'),
  major: z.literal(16),
  image: z.literal(PRODUCT_POSTGRES_IMAGE),
  database_name: z.literal('opspilot'),
  application_user: z.literal('opspilot'),
  administrator_user: z.literal('postgres'),
  created_at: z.iso.datetime(),
  provisioning: z.literal('prepared')
})
export const postgresPrepareResultSchema = z.strictObject({
  state: z.enum(['prepared', 'already_prepared']),
  request_key: z.uuidv4(),
  metadata: postgresMetadataSchema
})
export const postgresSelectionLookupSchema = z
  .strictObject({
    result: postgresSelectionResultSchema.nullable(),
    is_current: z.boolean(),
    definitively_unapplied: z.boolean()
  })
  .superRefine((value, ctx) => {
    if ((value.result && value.definitively_unapplied) || (!value.result && value.is_current))
      ctx.addIssue({ code: 'custom', message: 'POSTGRES_LOOKUP_INCONSISTENT' })
  })
export const projectConfigurationContextSchema = z
  .strictObject({
    controller_id: environmentScopeSchema.shape.controller_id,
    scope: environmentScopeSchema,
    basis_source_generation: positive,
    basis_source_config_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    source_generation: positive,
    source_config_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    environment: z.strictObject({
      latest: environmentMetadataSchema.nullable(),
      selected: environmentMetadataSchema.nullable()
    }),
    database: z.strictObject({
      prepared: postgresMetadataSchema.nullable(),
      selected: postgresMetadataSchema.nullable()
    }),
    auto_deploy_paused: z.boolean(),
    deployment_started: z.literal(false)
  })
  .superRefine((value, ctx) => {
    const scope = value.scope
    const invalid =
      value.controller_id !== scope.controller_id ||
      value.source_generation < value.basis_source_generation ||
      (value.source_generation === value.basis_source_generation &&
        value.source_config_sha256 !== value.basis_source_config_sha256) ||
      (value.environment.selected !== null &&
        value.environment.selected.revision > (value.environment.latest?.revision ?? 0)) ||
      (value.database.selected !== null &&
        JSON.stringify(value.database.selected) !== JSON.stringify(value.database.prepared)) ||
      [
        value.environment.latest,
        value.environment.selected,
        value.database.prepared,
        value.database.selected
      ].some(
        (metadata) =>
          metadata &&
          (metadata.controller_id !== scope.controller_id ||
            metadata.app_id !== scope.app_id ||
            metadata.ownership_generation !== scope.ownership_generation)
      )
    if (invalid) ctx.addIssue({ code: 'custom', message: 'CONFIGURATION_METADATA_SCOPE_MISMATCH' })
  })

export const postgresPrepareLookupSchema = z
  .strictObject({
    result: postgresPrepareResultSchema.nullable(),
    definitively_unapplied: z.boolean()
  })
  .superRefine((value, ctx) => {
    if (value.result && value.definitively_unapplied)
      ctx.addIssue({ code: 'custom', message: 'POSTGRES_PREPARE_LOOKUP_INCONSISTENT' })
  })
