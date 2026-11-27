// Metadata DTO copies of docs/contracts/*; no secret-bearing renderer input.
import type { ControllerInstallerRelease, DesktopInstallation } from './controllerInstaller'
import type { DesktopControllerConnection } from './desktopController'
export type DesktopControllerRelease = {
  release_id: string
  release_directory: string
  installer_path: string
  release_sha256: string
  installer_sha256: string
}
/** Root-only trusted upgrader. Tool/release pins come from an independent catalog. */
export interface ControllerUpgradeAuthority {
  installation_request_key: string
  controller_id: string
  parent_upgrade_key: string | null
  parent_release_sha256: string
  release_sha256: string
}
export type ControllerUpgradeRequest = ControllerUpgradeAuthority & {
  format: 1
  request_key: string
} & (
    | { operation: 'upgrade'; consent: true; release_directory: string }
    | { operation: 'inspect-upgrade' }
    | { operation: 'recover-upgrade'; consent: true; release_directory?: string }
    | { operation: 'rollback-upgrade'; consent: true }
  )
export type ControllerUpgradePhase =
  | 'prepared'
  | 'staging'
  | 'staged'
  | 'stop_pending'
  | 'stopped'
  | 'switch_pending'
  | 'switched'
  | 'start_pending'
  | 'commit_pending'
  | 'active'
  | 'rollback_pending'
  | 'rollback_commit_pending'
  | 'rolled_back'
export interface ControllerUpgradeResult extends ControllerUpgradeAuthority {
  format: 1
  request_key: string
  payload_sha256: string
  runtime_release_sha256: string
  runtime_payload_sha256: string
  /** Current operation's outcome runtime; historical results have is_current=false. */
  runtime_upgrade_key: string | null
  phase: ControllerUpgradePhase
  is_current: boolean
  service_state: 'running' | 'maintenance' | 'stopped' | 'failed' | 'not_current'
  runtime_uid: number
  artifact_path: string
  node_path: string
  data_directory: string
}
export interface ControllerUpgradeSnapshot {
  format: 1
  controller_id: string
  schema_sha256: string
  state_sha256: string
  key_sha256: string
  database_inode: number
  key_inode: number
  quiescent: boolean
}
/** Additive run-product stdin field, only for root-staged revision paths. */
export interface ControllerUpgradeGate {
  request_key: string
  path: string
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

/** Main catalog only; paths/pins/authority never come from renderer. */
export type DesktopUpgradeRelease = DesktopControllerRelease
export type DesktopUpgradeState =
  | 'prepared'
  | 'transferred'
  | 'in_flight'
  | 'outcome_unknown'
  | 'active'
  | 'rolled_back'
  | 'cancelled'
export type DesktopUpgradeOperation = 'transfer' | 'upgrade' | 'inspect' | 'recover' | 'rollback'
export type DesktopUpgrade = ControllerUpgradeAuthority & {
  request_key: string
  vps_id: number
  authority_revision: number
  release_id: string
  installer_sha256: string
  state: DesktopUpgradeState
  /** Main's last attested root operation, not a fresh remote health claim. */
  is_current: boolean
  last_result: ControllerUpgradeResult | null
  created_at: string
  updated_at: string
}
export type DesktopUpgradePlan = {
  plan_id: string
  expires_at: string
  installation_request_key: string
  controller_id: string
  vps_id: number
  host: string
  release_id: string
  parent_upgrade_key: string | null
}
/**
 * c-2a Main-only, no IPC/UI/live rollout. plan verifies original installation or
 * current upgrade under pinned SSH; 60s ephemeral review. prepare persists immutable
 * UUID/parent/release/tool and current installation/SSH authority before any effect.
 * send requires explicit consent; upgrade only once after verified transfer.
 * Unknown/cold in-flight => inspect or explicit same-key recover/rollback, never
 * automatic replay. transfer may restore missing staging but never reset attempted.
 * Historical results cannot attest current runtime. Fresh root current evidence
 * advances a local pointer atomically; it does not rebind API credentials.
 * Journal has no cascading VPS FK; changed/deleted/re-added SSH identity fails
 * closed. Explicit installation rebind + new upgrade review is a separate step.
 * Migration030 is Desktop-only. Controller retains all001–029 unchanged; both
 * controller open/init and upgrade-check use role=controller, rejecting Desktop DB.
 */

export type ControllerUpgradeOverview = {
  ssh_candidates?: { id: number; name: string; host: string }[]
  releases: ControllerInstallerRelease[]
  installations: DesktopInstallation[]
  upgrades: DesktopUpgrade[]
  connections: DesktopControllerConnection[]
}
export type ControllerUpgradeReviewInput = { installation_request_key: string; release_id: string }
export type ControllerUpgradeSendInput = {
  request_key: string
  operation: 'transfer' | 'upgrade' | 'recover' | 'rollback'
  consent: true
}
export type ControllerUpgradeBindingReview = {
  plan_id: string
  expires_at: string
  binding_id: string
  upgrade_request_key: string
  binding_revision: number
  controller_id: string
  release_id: string
}
export type ControllerUpgradeReview = DesktopUpgradePlan
/** IDs/consent only. Main derives pins/paths/UID/current authority. Refresh preserves
 * access token/client/scopes, checks old encrypted intent/revision and fresh remote
 * settled ready evidence, then increments local binding epoch atomically. No implicit
 * enrollment/rotation; credential/VPS identity changes require separate authority review.
 */
