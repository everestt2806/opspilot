/** Internal Unix-admin CLI review. No apply command or reusable upgrade capability. */
export type ProductTargetHelperUpgradeReviewInput = Readonly<{
  format: 1;
  controller_id: string;
  app_id: number;
  ownership_generation: number;
  artifact: string;
  manifest_sha256: string;
  /** Exact retained manifest bytes, checked against the existing SQLite pin. */
  retained_manifest: string;
}>;

export type ProductTargetHelperUpgradeReview = Readonly<{
  format: 1;
  purpose: "product-target-helper-upgrade-review";
  controller_id: string;
  app_id: number;
  ownership_generation: number;
  from_manifest_sha256: string;
  to_manifest_sha256: string;
  authority_sha256: string;
  review_sha256: string;
  changes: ReadonlyArray<{
    path: string;
    before: { size: number; sha256: string };
    after: { size: number; sha256: string };
  }>;
  /** A review does not authorize writes, dispatch, enrollment or key rotation. */
  apply_available: false;
}>;

export type ProductTargetHelperUpgradePrepareInput = ProductTargetHelperUpgradeReviewInput & Readonly<{
  request_key: string;
  expected_review_sha256: string;
  confirm: true;
}>;

export type ProductTargetHelperUpgradeLookupInput = Readonly<{
  format: 1;
  controller_id: string;
  app_id: number;
  ownership_generation: number;
  request_key: string;
}>;

export type ProductTargetHelperUpgradePreparation = Readonly<{
  format: 1;
  purpose: "product-target-helper-upgrade-preparation";
  request_key: string;
  controller_id: string;
  app_id: number;
  ownership_generation: number;
  state: "intent_only" | "pending";
  review_sha256: string;
  from_manifest_sha256: string;
  to_manifest_sha256: string;
  /** Phase này không thực hiện hoặc cấp quyền remote write. */
  apply_available: false;
}>;

export type ProductTargetHelperUpgradeOperation =
  | "upgrade" | "inspect-upgrade" | "recover-upgrade" | "cancel-upgrade";

/** Target-only wire, pinned trusted bootstrap over SSH; key only in bounded stdin. */
export type ProductTargetHelperUpgradePacket = Readonly<{
  format: 1;
  operation: ProductTargetHelperUpgradeOperation;
  request_key: string;
  review_sha256: string;
  framework: "express" | "static-spa" | "nextjs";
  key: string;
  from: { payload: import("./product-target-enrollment").ProductTargetEnrollmentPayload; manifest: string };
  to: { payload: import("./product-target-enrollment").ProductTargetEnrollmentPayload; manifest: string; helpers: Record<string, string> };
}>;

export const PRODUCT_TARGET_HELPER_UPGRADE_OUTCOME_DOMAIN = "opspilot-target-helper-upgrade-outcome-v1";
export type ProductTargetHelperUpgradeOutcome = Readonly<{
  payload: {
    format: 1;
    purpose: "product-target-helper-upgrade-outcome";
    request_key: string;
    review_sha256: string;
    controller_id: string;
    app_id: number;
    ownership_generation: number;
    from_manifest_sha256: string;
    to_manifest_sha256: string;
    state: "pending" | "applied" | "not_applied";
    /** Absent-journal old observation is unsettled and cannot authorize SQL cancellation. */
    settled: boolean;
    marker_sha256: string;
    enrollment_proof_sha256: string | null;
  };
  signature: string;
}>;

/** Three-file journaled transition; never moves/replaces state/locks, key, marker or app files.
 * Repeated upgrade and inspect-upgrade only report partial state. Explicit recover-upgrade
 * resumes an existing journal; if absent it proves old enrollment without starting writes.
 * cancel-upgrade writes a durable cancellation tombstone even when no journal exists,
 * and reverts a partial journal; an already applied terminal remains applied.
 * Applied/not_applied response also returns the exact authenticated enrollment proof;
 * pending has proof:null. Absent journal returns not_applied/settled:false; a controller
 * must never clear SQL from that observation. Only settled outcomes may finalize SQL.
 * All outcomes require HMAC and UUID/manifest/identity matching.
 * No serving-controller integration/SQL pin finalization is introduced by the target engine.
 */

/**
 * prepare-target-helper-upgrade: fresh authenticated review + explicit confirm:true,
 * expected_review_sha256 và UUID v4 lowercase qua bounded stdin, trusted Unix admin only.
 * HMAC immutable intent publish/fsync trước SQLite BEGIN IMMEDIATE exact authority/revision CAS.
 * SQL enrollment unknown/last_error_code=TARGET_HELPER_UPGRADE_PENDING:<UUID> giữ old pin/proof/key.
 * helper-upgrade-state chỉ đọc intent + SQL, không SSH/replay/clear barrier hoặc rotate key.
 * intent_only không cấp quyền; pending chỉ xác nhận đúng SQL barrier và unchanged authority.
 * Ordinary enroll/inspect/complete không được clear upgrade barrier. Target apply/finish chưa có.
 */

/**
 * review-target-helper-upgrade --data-dir <private-controller-directory>
 * Input: bounded JSON stdin. Exact installed schema, readonly SQLite handle (no migrations).
 * Product owner paused and quiescent before/after pinned SSH inspect; persisted and remote
 * enrollment HMAC must match the retained manifest. Only approved forward helper transitions.
 * No raw credentials, key material, proof signatures or environment values in stdout/errors.
 * This snapshot is not consent or a capability. A future explicit apply must recheck authority,
 * acquire target locks and use a durable journal/recovery protocol; normal enroll stays create-once.
 */
