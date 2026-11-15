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
