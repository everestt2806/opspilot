import { z } from 'zod'
import type Database from 'better-sqlite3'
import type { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import type {
  ProductPostgresInspectionContext,
  ProductPostgresInspectionInput
} from '../../../../docs/contracts/product-postgres-inspection'
import { ProductPostgresPreflight } from './productPostgresPreflight'
import { ProductPostgresError } from './productPostgres'

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
export const postgresInspectionInputSchema = z.strictObject({
  format: z.literal(1),
  controller_id: z.string().min(1).max(128),
  app_id: positive,
  expected_ownership_generation: positive,
  expected_source_generation: positive,
  expected_source_config_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  expected_target_security_revision: positive,
  database_id: z.uuidv4().refine((id) => id === id.toLowerCase())
}) satisfies z.ZodType<ProductPostgresInspectionInput>

/** Metadata-only exact-instance review. No SSH, container enumeration, query,
 * provisioning, pause or job. Existing preflight authenticates the retained
 * resource and its selected source binding in one SQLite snapshot.
 */
export function reviewPostgresInspection(
  db: Database.Database,
  cipher: AesGcmCredentialCipher,
  controllerId: string,
  input: unknown
): ProductPostgresInspectionContext {
  if (db.inTransaction) throw new ProductPostgresError('PRODUCT_POSTGRES_INPUT_INVALID')
  const parsed = postgresInspectionInputSchema.safeParse(input)
  if (!parsed.success) throw new ProductPostgresError('PRODUCT_POSTGRES_INPUT_INVALID')
  const request = parsed.data
  if (request.controller_id !== controllerId)
    throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
  const verified = ProductPostgresPreflight.reviewForInspection(db, request, cipher)
  if (!verified || verified.reference.database_id !== request.database_id)
    throw new ProductPostgresError('PRODUCT_POSTGRES_UNAVAILABLE')
  return {
    state: 'configuration_verified',
    controller_id: controllerId,
    app_id: request.app_id,
    ownership_generation: request.expected_ownership_generation,
    source_generation: request.expected_source_generation,
    source_config_sha256: request.expected_source_config_sha256,
    target_security_revision: request.expected_target_security_revision,
    database: structuredClone(verified.metadata),
    runtime_status: 'not_checked'
  }
}
