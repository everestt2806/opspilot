import type { ProductEnvironmentMetadata, ProductEnvironmentValues } from './product-environment'
import type { ProductEnvironmentSelectionResult } from './product-environment'

export interface DesktopEnvironmentContext {
  project_request_key: string
  binding_id: string
  binding_revision: number
  controller_id: string
  app_id: number
  ownership_generation: number
  source_generation: number
  source_config_sha256: string
  latest: ProductEnvironmentMetadata | null
  selected: ProductEnvironmentMetadata | null
  auto_deploy_paused: boolean
}
export interface DesktopEnvironmentSelectionPrepareInput {
  project_request_key: string
  expected_binding_revision: number
  expected_source_generation: number
  expected_source_config_sha256: string
  expected_latest_revision: number
  environment_revision: number
}
export interface DesktopEnvironmentSelectionIntent {
  request_key: string
  project_request_key: string
  binding_id: string
  binding_revision: number
  controller_id: string
  app_id: number
  ownership_generation: number
  source_generation: number
  source_config_sha256: string
  environment_revision: number
  expected_latest_revision: number
  state: 'prepared' | 'in_flight' | 'outcome_unknown' | 'selected' | 'not_applied' | 'cancelled'
  result: ProductEnvironmentSelectionResult | null
  created_at: string
  updated_at: string
}
export interface DesktopEnvironmentPrepareInput extends ProductEnvironmentValues {
  project_request_key: string
  expected_binding_revision: number
  expected_latest_revision: number | null
}
export interface DesktopEnvironmentIntent {
  request_key: string
  project_request_key: string
  binding_id: string
  binding_revision: number
  controller_id: string
  app_id: number
  ownership_generation: number
  source_generation: number
  source_config_sha256: string
  expected_latest_revision: number | null
  runtime_keys: string[]
  public_build_keys: string[]
  state: 'prepared' | 'in_flight' | 'outcome_unknown' | 'staged' | 'cancelled'
  result: ProductEnvironmentMetadata | null
  created_at: string
  updated_at: string
}
/** Only IDs + values on write; no raw remote paths/commands/target/scope from UI.
 * Context from registered project, fresh binding + SSH admin before/after await.
 * Main generates request UUID and encrypts immutable body for exact cold retry.
 * Prepared can cancel; uncertain delivery must lookup/retry original UUID/body.
 * Results never include values/ciphertext/plaintext digest; not localStorage.
 * Stage does not activate/deploy. No UI availability claim on old controller.
 */
