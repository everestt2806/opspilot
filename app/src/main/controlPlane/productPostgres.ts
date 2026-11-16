import { z } from 'zod'
import { environmentScopeSchema } from './productEnvironment'
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
