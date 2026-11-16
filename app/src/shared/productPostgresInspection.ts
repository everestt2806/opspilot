import type { ProductPostgresMetadata } from './productPostgres'

export type ProductPostgresInspectionOperation =
  | { operation: 'inspect' }
  | { operation: 'tables' }
  | { operation: 'rows'; schema: string; table: string; limit: number }
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
export interface ProductPostgresRuntimeIdentity {
  database_id: string
  container_id: string
  image_id: string
  volume: string
  volume_created_at: string
  system_identifier: string
  state: 'ready'
  public_port: null
}
export interface ProductPostgresColumn {
  name: string
  data_type: string
  nullable: boolean
}
export interface ProductPostgresTable {
  schema: string
  name: string
  columns: ProductPostgresColumn[]
}
export interface ProductPostgresInspectionResult {
  context: ProductPostgresInspectionContext
  read: ProductPostgresInspectionOperation
  instance: ProductPostgresRuntimeIdentity
  checked_at: string
  data: ProductPostgresTable[] | Array<Record<string, unknown>> | null
}
