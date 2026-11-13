/** Root-only trusted upgrader. Tool/release pins come from an independent catalog. */
export interface ControllerUpgradeAuthority {
  installation_request_key: string;
  controller_id: string;
  parent_upgrade_key: string | null;
  parent_release_sha256: string;
  release_sha256: string;
}
export type ControllerUpgradeRequest = ControllerUpgradeAuthority & {
  format: 1;
  request_key: string;
} & (
    | { operation: "upgrade"; consent: true; release_directory: string }
    | { operation: "inspect-upgrade" }
    | { operation: "recover-upgrade"; consent: true; release_directory?: string }
    | { operation: "rollback-upgrade"; consent: true }
  );
export type ControllerUpgradePhase =
  | "prepared"
  | "staging"
  | "staged"
  | "stop_pending"
  | "stopped"
  | "switch_pending"
  | "switched"
  | "start_pending"
  | "commit_pending"
  | "active"
  | "rollback_pending"
  | "rollback_commit_pending"
  | "rolled_back";
export interface ControllerUpgradeResult extends ControllerUpgradeAuthority {
  format: 1;
  request_key: string;
  payload_sha256: string;
  runtime_release_sha256: string;
  runtime_payload_sha256: string;
  /** Current operation's outcome runtime; historical results have is_current=false. */
  runtime_upgrade_key: string | null;
  phase: ControllerUpgradePhase;
  is_current: boolean;
  service_state:
    "running" | "maintenance" | "stopped" | "failed" | "not_current";
  runtime_uid: number;
  artifact_path: string;
  node_path: string;
  data_directory: string;
}
export interface ControllerUpgradeSnapshot {
  format: 1;
  controller_id: string;
  schema_sha256: string;
  state_sha256: string;
  key_sha256: string;
  database_inode: number;
  key_inode: number;
  quiescent: boolean;
}
/** Additive run-product stdin field, only for root-staged revision paths. */
export interface ControllerUpgradeGate {
  request_key: string;
  path: string;
}
/**
 * Shared original installation flock; immutable installation receipt/runtime.
 * Side-by-side /installation/revisions/<UUID>/runtime, root-owned revision parent,
 * service-owned verified runtime. root state/upgrade.json + history/<UUID>.json
 * preserve request identity and parent snapshots; another UUID cannot take over
 * incomplete work. Repeated upgrade is inspect only; recovery/rollback explicit.
 * Quiescent means every owned app paused, no queued/inflight/uncertain job, active
 * lease, prepared activation, or unsettled H2 terminal. No automatic policy write.
 * Same dependency lock/Node ABI, helper/template/collector assets and exact live
 * vs fresh schema required. Readonly upgrade-check hashes protected records/key;
 * R7c: chỉ cặp asset transition đã bake trong trusted upgrader được ngoại lệ:
 * exact old→new SHA/size/mode của SPA nginx template và exact-CID health helper.
 * Không nhận allowlist hoặc override từ IPC, request hay release candidate.
 * Toàn bộ Node/dependencies/asset khác phải giữ nguyên; reverse/drift bị từ chối.
 * never initializes/migrates live DB or returns plaintext records/secrets.
 * upgrade-hold is a separate service-UID, bounded IMMEDIATE no-write transaction
 * spanning quiescent check and old-service stop; rollback on stdin EOF/timeout.
 * It closes the manual-deploy admission race without changing policy/DB rows.
 * Candidate starts in maintenance with no Git poll/worker/recovery until a root
 * activation marker is durably published. commit_pending is the irrevocable
 * release boundary: unknown outcome is inspected, never automatically rolled back
 * or compared against a pre-commit business-state hash after writes may resume.
 * Explicit rollback requires a fresh quiescent snapshot; no DB backup restore or
 * blind re-stop after the parent unit becomes authoritative. rollback_commit_pending
 * permits either unit; if the parent is selected, reconcile/start it without
 * comparing business hashes from before a potentially successful restart.
 * Explicit recover may supply verified staging for a missing journal: under original
 * flock it freshly verifies current parent revision/pins/unit/health before creating
 * this same UUID. No automatic retry or takeover of another incomplete operation.
 * No key regeneration. Old inspector may reject the changed unit; Desktop must use
 * the new trusted upgrader authority, never silently replace old pins/bindings.
 */
