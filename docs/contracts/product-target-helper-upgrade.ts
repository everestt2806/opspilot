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

/**
 * review-target-helper-upgrade --data-dir <private-controller-directory>
 * Input: bounded JSON stdin. Exact installed schema, readonly SQLite handle (no migrations).
 * Product owner paused and quiescent before/after pinned SSH inspect; persisted and remote
 * enrollment HMAC must match the retained manifest. Only approved forward helper transitions.
 * No raw credentials, key material, proof signatures or environment values in stdout/errors.
 * This snapshot is not consent or a capability. A future explicit apply must recheck authority,
 * acquire target locks and use a durable journal/recovery protocol; normal enroll stays create-once.
 */
