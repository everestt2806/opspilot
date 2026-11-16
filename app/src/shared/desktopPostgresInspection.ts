import type {
  ProductPostgresInspectionOperation,
  ProductPostgresInspectionResult
} from './productPostgresInspection'

export interface DesktopPostgresInspectionInput {
  project_request_key: string
  expected_binding_revision: number
  expected_source_generation: number
  expected_source_config_sha256: string
  database_id: string
  read: ProductPostgresInspectionOperation
}
export interface DesktopPostgresInspectionResult extends ProductPostgresInspectionResult {
  project_request_key: string
  binding_id: string
  binding_revision: number
}
