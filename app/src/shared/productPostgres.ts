/** Metadata-only DTO mirror of docs/contracts/product-postgres.ts.
 * No credentials, claim capabilities or controller transport in the renderer. */
export interface ProductPostgresMetadata {
  database_id: string
  controller_id: string
  app_id: number
  ownership_generation: number
  framework: 'express' | 'nextjs'
  engine: 'postgresql'
  major: 16
  image: string
  database_name: 'opspilot'
  application_user: 'opspilot'
  administrator_user: 'postgres'
  created_at: string
  provisioning: 'prepared'
}
export interface ProductPostgresReference {
  database_id: string
  controller_id: string
  ownership_generation: number
}
export interface ProductPostgresPrepareResult {
  state: 'prepared' | 'already_prepared'
  request_key: string
  metadata: ProductPostgresMetadata
}
export interface ProductPostgresSelectionResult {
  state: 'selected' | 'already_selected'
  request_key: string
  controller_id: string
  app_id: number
  ownership_generation: number
  source_generation: number
  source_config_sha256: string
  database: ProductPostgresReference
  auto_deploy_paused: true
  deployment_started: false
  execution: 'requires_postgres_runtime'
}
