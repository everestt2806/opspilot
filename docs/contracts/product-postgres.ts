import type { ProductEnvironmentScope } from "./product-environment";
import type {
  ProductClaimToken,
  ProductDispatchTargetBinding,
} from "./product-auto-deploy";

/** Generated managed resource, independent of user env/source revisions.
 * Internal controller-only credential access; metadata is safe for Main/UI.
 * prepare never opens SSH, creates a volume, selects source or starts a job.
 */
/** Linux same-UID CLI: prepare-managed-postgres / managed-postgres-state.
 * Bounded stdin only; administrator comes from OS, existing key required.
 * Exact schema037 prerequisite; never initializer/migration/key creation.
 * Current serving035 refuses both commands until protected upgrade is complete.
 */
export interface ProductPostgresPrepareInput {
  format: 1;
  request_key: string;
  scope: ProductEnvironmentScope;
  expected_source_generation: number;
  expected_source_config_sha256: string;
}
export interface ProductPostgresStateInput {
  format: 1;
  scope: ProductEnvironmentScope;
}
export interface ProductPostgresMetadata {
  database_id: string;
  controller_id: string;
  app_id: number;
  ownership_generation: number;
  framework: "express" | "nextjs";
  engine: "postgresql";
  major: 16;
  image: string;
  database_name: "opspilot";
  application_user: "opspilot";
  administrator_user: "postgres";
  created_at: string;
  provisioning: "prepared";
}
export interface ProductPostgresPrepareResult {
  state: "prepared" | "already_prepared";
  request_key: string;
  metadata: ProductPostgresMetadata;
}
/** Server-generated only. Never CLI output, IPC/HTTP DTO, build arg, argv or log.
 * Application role is not superuser; initialization/admin password is separate.
 */
export interface ProductPostgresCredentials {
  administrator_password: string;
  application_password: string;
}
export interface ProductPostgresReference {
  database_id: string;
  controller_id: string;
  ownership_generation: number;
}
/** Capability nội bộ theo claim/lease; không trả qua CLI/IPC/HTTP. */
export interface ResolvedProductPostgres {
  claim: ProductClaimToken;
  target: ProductDispatchTargetBinding;
  reference: ProductPostgresReference;
  metadata: ProductPostgresMetadata;
  credentials: ProductPostgresCredentials;
  signRuntime: (payload: string) => string;
}
/** Comment đầu .env riêng tư; Docker bỏ qua, helper xác minh trước cấp DATABASE_URL.
 * Không thêm render file/command hay truyền secret vào Dockerfile/build args.
 */
export const PRODUCT_POSTGRES_TRANSFER_PREFIX =
  "# opspilot-managed-postgres-v1 ";
export interface ProductPostgresSelectionInput extends ProductPostgresPrepareInput {
  database_id: string;
}
/** Same-UID Linux CLI only. Explicit pinned artifact, never source-provided code.
 * review/select require an actual read-only target helper/key inspection.
 * selection-state reads the durable receipt without requiring a target connection.
 */
export interface ProductPostgresSelectionCommandInput {
  artifact: string;
  manifest_sha256: string;
  selection: ProductPostgresSelectionInput;
}
export interface ProductPostgresReview {
  scope: ProductEnvironmentScope;
  source_generation: number;
  source_config_sha256: string;
  metadata: ProductPostgresMetadata;
  auto_deploy_paused: true;
  deployment_started: false;
}
export interface ProductPostgresSelectionResult {
  state: "selected" | "already_selected";
  request_key: string;
  controller_id: string;
  app_id: number;
  ownership_generation: number;
  source_generation: number;
  source_config_sha256: string;
  database: ProductPostgresReference;
  auto_deploy_paused: true;
  deployment_started: false;
  execution: "requires_postgres_runtime";
}

/** Database source binding is separate from selection request receipts. A new env
 * selection inherits its database binding; a database selection retains the previous
 * authenticated env binding without copying/reusing its original request UUID.
 * No source selection automatically enables an unsupported helper or starts deploy.
 */

/** Product exception: generated credentials encrypted in the same controller SQLite
 * using its existing explicit master key. Purpose/binding covers UUID/target/owner/
 * framework/image/names; raw passwords and secret digests never enter metadata.
 * Source changes/redeploy/rollback do not rotate either credential or database UUID.
 * Source selection/execution is separate, must validate claim/lease and this reference.
 * Archive/reconnect never adopts another target/owner or erases the retained resource.
 */

/** Metadata review anchored to immutable project registration. Only authenticated
 * env/database reference changes may differ. Never authority for Main to adopt a
 * changed source without its own verified selection journal. No ready/provisioned
 * claim, network connection, job, schema migration or credential output.
 */
export type ProductProjectConfigurationContextInput =
  import("./product-environment").ProductEnvironmentContextInput;
export interface ProductProjectConfigurationContext {
  controller_id: string;
  scope: ProductEnvironmentScope;
  basis_source_generation: number;
  basis_source_config_sha256: string;
  source_generation: number;
  source_config_sha256: string;
  environment: {
    latest: import("./product-environment").ProductEnvironmentMetadata | null;
    selected: import("./product-environment").ProductEnvironmentMetadata | null;
  };
  database: {
    prepared: ProductPostgresMetadata | null;
    selected: ProductPostgresMetadata | null;
  };
  auto_deploy_paused: boolean;
  deployment_started: false;
}

/** Exact-body same-UID prepare receipt lookup. Never repeats prepare, provisions,
 * selects source or opens SSH. Receipt absence alone is not negative proof;
 * definitive non-application requires the monotonic current source to advance.
 * Positive lookup remains available after source selection and while jobs run.
 */
export interface ProductPostgresPrepareLookup {
  result: ProductPostgresPrepareResult | null;
  definitively_unapplied: boolean;
}
