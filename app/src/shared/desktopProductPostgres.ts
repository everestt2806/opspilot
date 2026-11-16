import type {
  ProductPostgresMetadata,
  ProductPostgresPrepareResult,
  ProductPostgresSelectionResult
} from './productPostgres'
import type { ProductEnvironmentMetadata } from './productEnvironment'

export interface DesktopPostgresContext {
  project_request_key: string
  binding_id: string
  binding_revision: number
  controller_id: string
  app_id: number
  ownership_generation: number
  source_generation: number
  source_config_sha256: string
  database: { prepared: ProductPostgresMetadata | null; selected: ProductPostgresMetadata | null }
  environment: {
    latest: ProductEnvironmentMetadata | null
    selected: ProductEnvironmentMetadata | null
  }
  auto_deploy_paused: boolean
}
export type DesktopPostgresIntentInput = {
  project_request_key: string
  expected_binding_revision: number
  expected_source_generation: number
  expected_source_config_sha256: string
} & ({ operation: 'prepare' } | { operation: 'select'; database_id: string })
export interface DesktopPostgresIntent {
  request_key: string
  project_request_key: string
  binding_id: string
  binding_revision: number
  controller_id: string
  app_id: number
  operation: 'prepare' | 'select'
  source_generation: number
  source_config_sha256: string
  database_id: string | null
  state:
    | 'prepared'
    | 'in_flight'
    | 'outcome_unknown'
    | 'resource_prepared'
    | 'selected'
    | 'not_applied'
    | 'cancelled'
  result: ProductPostgresPrepareResult | ProductPostgresSelectionResult | null
  created_at: string
  updated_at: string
}
/** Main generates UUID and derives target/artifact from registered project/vault.
 * Encrypted authenticated request/result journal is Desktop-only, never a server
 * credential or runtime capability. Prepared can cancel. Unknown only receipt lookup;
 * absence alone does not permit replay/new UUID. Selection keeps auto-deploy paused.
 * Main follows selected source only after positive current exact-body receipt check.
 */
