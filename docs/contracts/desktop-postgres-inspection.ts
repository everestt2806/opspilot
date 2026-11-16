import type {
  ProductPostgresInspectionOperation,
  ProductPostgresInspectionResult,
} from "./product-postgres-inspection";

/** Main derives controller/app/owner/target and artifact/pin from its authenticated
 * registered project and installation vault. Caller chooses an exact CURRENT
 * selected DB UUID and finite read only; no paths, SQL or credentials. This DTO
 * reserves the subsequent IPC surface but does not enable renderer handlers yet.
 */
export interface DesktopPostgresInspectionInput {
  project_request_key: string;
  expected_binding_revision: number;
  expected_source_generation: number;
  expected_source_config_sha256: string;
  database_id: string;
  read: ProductPostgresInspectionOperation;
}
export interface DesktopPostgresInspectionResult extends ProductPostgresInspectionResult {
  project_request_key: string;
  binding_id: string;
  binding_revision: number;
}
