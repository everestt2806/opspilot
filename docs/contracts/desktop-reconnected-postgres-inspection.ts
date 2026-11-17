import type { ProductPostgresInspectionOperation, ProductPostgresInspectionResult } from './product-postgres-inspection'

/** Nhánh readonly riêng cho consent E2; không phải registration receipt. */
export interface DesktopReconnectedPostgresInspectionInput {
  reconnection_request_key: string
  expected_binding_revision: number
  expected_snapshot_sha256: string
  database_id: string
  read: ProductPostgresInspectionOperation
}
export interface DesktopReconnectedPostgresInspectionResult extends ProductPostgresInspectionResult {
  reconnection_request_key: string
  binding_id: string
  binding_revision: number
  snapshot_sha256: string
}
