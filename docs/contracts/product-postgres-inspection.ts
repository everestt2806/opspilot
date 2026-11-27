import type { ProductPostgresMetadata } from "./product-postgres";

/** Same-UID controller metadata review. CAS refers to the CURRENT selected
 * source, unlike configuration review anchored to original registration.
 * A database name or VPS ID alone never identifies a managed instance.
 */
export interface ProductPostgresInspectionInput {
  format: 1;
  controller_id: string;
  app_id: number;
  expected_ownership_generation: number;
  expected_source_generation: number;
  expected_source_config_sha256: string;
  expected_target_security_revision: number;
  database_id: string;
}
/** Configuration snapshot only. Not an execution capability, database connection,
 * container attestation or runtime health result. Revalidate before/after a later
 * target read. No credentials, target filesystem paths, SQL or job/lease claims.
 */
export interface ProductPostgresInspectionContext {
  state: "configuration_verified";
  controller_id: string;
  app_id: number;
  ownership_generation: number;
  source_generation: number;
  source_config_sha256: string;
  target_security_revision: number;
  database: ProductPostgresMetadata;
  runtime_status: "not_checked";
}

/** Finite read-only inspector operations. Table identifiers are schema-qualified;
 * no SQL text, container selector, filesystem path or credential from the caller.
 * Reads require fresh instance/source authority before and after target I/O.
 */
export type ProductPostgresInspectionOperation =
  | { operation: "inspect" }
  | { operation: "tables" }
  | { operation: "rows"; schema: string; table: string; limit: number };
export interface ProductPostgresColumn {
  name: string;
  data_type: string;
  nullable: boolean;
}
export interface ProductPostgresTable {
  schema: string;
  name: string;
  columns: ProductPostgresColumn[];
}
/** Table samples deliberately have no unbounded SQL or pagination offset. A later
 * API can add cursor-based paging with its own consistency/scope contract.
 * Oversize/invalid results are rejected, never silently accepted as empty data.
 */
export interface ProductPostgresRows {
  schema: string;
  table: string;
  rows: Array<Record<string, unknown>>;
  limit: number;
}

export interface ProductPostgresInspectionRequest {
  context: ProductPostgresInspectionInput;
  read: ProductPostgresInspectionOperation;
}
export interface ProductPostgresRuntimeIdentity {
  database_id: string;
  container_id: string;
  image_id: string;
  volume: string;
  volume_created_at: string;
  system_identifier: string;
  state: "ready";
  public_port: null;
}
export interface ProductPostgresInspectionResult {
  context: ProductPostgresInspectionContext;
  read: ProductPostgresInspectionOperation;
  instance: ProductPostgresRuntimeIdentity;
  checked_at: string;
  data: ProductPostgresTable[] | Array<Record<string, unknown>> | null;
}

/** Linux same-UID CLI: managed-postgres-inspection, bounded stdin. Artifact and
 * manifest pin are trusted admin binding inputs, never renderer-supplied.
 * Existing schema37/key only; command opens controller SQLite read-only.
 */
export interface ProductPostgresInspectionCommand {
  artifact: string;
  manifest_sha256: string;
  inspection: ProductPostgresInspectionRequest;
}
