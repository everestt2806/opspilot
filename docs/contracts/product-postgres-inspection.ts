import type { ProductPostgresMetadata } from './product-postgres'

/** Same-UID controller metadata review. CAS refers to the CURRENT selected
 * source, unlike configuration review anchored to original registration.
 * A database name or VPS ID alone never identifies a managed instance.
 */
export interface ProductPostgresInspectionInput {
  format: 1
  controller_id: string
  app_id: number
  expected_ownership_generation: number
  expected_source_generation: number
  expected_source_config_sha256: string
  expected_target_security_revision: number
  database_id: string
}
/** Configuration snapshot only. Not an execution capability, database connection,
 * container attestation or runtime health result. Revalidate before/after a later
 * target read. No credentials, target filesystem paths, SQL or job/lease claims.
 */
export interface ProductPostgresInspectionContext {
  state: 'configuration_verified'
  controller_id: string
  app_id: number
  ownership_generation: number
  source_generation: number
  source_config_sha256: string
  target_security_revision: number
  database: ProductPostgresMetadata
  runtime_status: 'not_checked'
}
