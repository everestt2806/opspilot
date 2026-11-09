import type { ControllerInstallationResult } from "./product-controller-installation";
import type { ControllerBootstrapLocator } from "./product-controller-ssh-bootstrap";

/** Main-only protected catalog. Never accept filesystem paths or pins from IPC. */
export type DesktopControllerRelease = {
  release_id: string;
  release_directory: string;
  installer_path: string;
  release_sha256: string;
  installer_sha256: string;
};
export type DesktopInstallationState =
  | "prepared" | "in_flight" | "outcome_unknown"
  | "transferred" | "installed" | "cancelled";
export type DesktopInstallationOperation = "transfer" | "install" | "recover" | "inspect";
export type DesktopInstallation = ControllerBootstrapLocator & {
  vps_id: number;
  authority_revision: number;
  release_id: string;
  state: DesktopInstallationState;
  controller_id: string | null;
  last_result: ControllerInstallationResult | null;
  created_at: string;
  updated_at: string;
};
export type DesktopInstallationPlan = {
  plan_id: string;
  expires_at: string;
  vps_id: number;
  host: string;
  username: string;
  host_fingerprint: string;
  release_id: string;
  request_key: string;
  remote_existing: boolean;
  rebind_required: boolean;
};
/**
 * R3c-6h2b2 product-mode. Main methods only; no renderer write IPC yet.
 * plan(vps_id, release_id): pinned SSH readonly discovery, 60s ephemeral review;
 * remote locator is an untrusted hint until BOTH hashes match protected catalog.
 * prepare(plan_id): BEGIN IMMEDIATE; persist immutable UUID/pins/identity and current
 * SSH revision + ciphertext-envelope digest before any network mutation.
 * send(request_key, operation, consent:true): durable operation/session claim before
 * dispatch, current DB/authority fences throughout. No automatic mutation replay.
 * inspect is explicit, readonly on VPS; cold in-flight becomes outcome_unknown.
 * Partial or ambiguous installation requires explicit same-key recover. Missing
 * staging does not prove missing installed service; known controller_id never resets.
 * rebind(plan_id, request_key, confirm:true): fresh pinned same-host/port/key/principal
 * review, retains remote UUID/controller ID, increments authority generation and
 * requires inspect. Does not change existing Desktop API token bindings.
 * Cancellation only before any dispatch and without a discovered existing install.
 * No VPS FK cascade: journal survives removal/re-addition of local VPS records.
 */
