import type {
  ControllerUpgradeAuthority,
  ControllerUpgradeResult,
} from "./product-controller-upgrade";
import type { DesktopControllerRelease } from "./desktop-controller-installation";

/** Main catalog only; paths/pins/authority never come from renderer. */
export type DesktopUpgradeRelease = DesktopControllerRelease;
export type DesktopUpgradeState =
  | "prepared"
  | "transferred"
  | "in_flight"
  | "outcome_unknown"
  | "active"
  | "rolled_back"
  | "cancelled";
export type DesktopUpgradeOperation =
  "transfer" | "upgrade" | "inspect" | "recover" | "rollback";
export type DesktopUpgrade = ControllerUpgradeAuthority & {
  request_key: string;
  vps_id: number;
  authority_revision: number;
  release_id: string;
  installer_sha256: string;
  state: DesktopUpgradeState;
  /** Main's last attested root operation, not a fresh remote health claim. */
  is_current: boolean;
  last_result: ControllerUpgradeResult | null;
  created_at: string;
  updated_at: string;
};
export type DesktopUpgradePlan = {
  plan_id: string;
  expires_at: string;
  installation_request_key: string;
  controller_id: string;
  vps_id: number;
  host: string;
  release_id: string;
  parent_upgrade_key: string | null;
};
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
