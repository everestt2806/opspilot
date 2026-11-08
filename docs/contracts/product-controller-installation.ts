/** Root-only trusted Linux installer CLI; JSON không nhận command/UID/service/output paths. */
export type ControllerInstallationRequest =
  | {
      format: 1;
      operation: "install";
      request_key: string;
      consent: true;
      release_directory: string;
      release_sha256: string;
    }
  | { format: 1; operation: "inspect"; request_key: string }
  | {
      format: 1;
      operation: "recover";
      request_key: string;
      consent: true;
      release_sha256: string;
    };

export type ControllerInstallationPhase =
  | "prepared"
  | "account_pending"
  | "account_ready"
  | "runtime_pending"
  | "runtime_ready"
  | "data_pending"
  | "data_ready"
  | "database_pending"
  | "database_ready"
  | "key_pending"
  | "key_ready"
  | "unit_pending"
  | "unit_ready"
  | "start_pending"
  | "installed";

export type ControllerInstallationReceipt = {
  format: 1;
  request_key: string;
  release_sha256: string;
  source_directory: string;
  payload_sha256: string;
  phase: ControllerInstallationPhase;
  uid: number | null;
  gid: number | null;
  controller_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ControllerInstallationResult = {
  format: 1;
  request_key: string;
  phase: ControllerInstallationPhase;
  controller_id: string | null;
  service_state:
    "running" | "stopped" | "starting" | "failed" | "not_installed";
  runtime_uid: number | null;
  service_enabled: boolean;
  artifact_path: string;
  node_path: string;
  data_directory: string;
  payload_sha256: string;
};

/**
 * Production: /var/lib/opspilot-controller-install (root0700 journal/flock),
 * /opt/opspilot-controller (root0755; runtime owned service account0700/0600),
 * /var/lib/opspilot-controller (runtime0700), account opspilot-controller/nologin,
 * /etc/systemd/system/opspilot-controller-product.service (root0644).
 * UUID/pin immutable, explicit consent required. Repeated install only inspect;
 * recover is a separate explicit operation using the same UUID/pin.
 * Write durable phase before mutation; fsync+rename receipts/copy files, exclusive
 * owner markers, no replacing foreign dirs/accounts/units. No DB/key regeneration.
 * Incomplete init without valid identity requires recovery, never wipes user data.
 * Lock Linux flock on inherited open file description; initialization children inherit
 * the descriptor so parent loss does not authorize concurrent init.
 * Root initializer calls verified runtime with setpriv --clear-groups to the fresh
 * service UID. Passive release verifier's optional expected-owner UID is INTERNAL,
 * derived solely from root-owned receipt + matching Unix account, never request JSON.
 * No generic SSH command/API, public port, Docker install or project deployment.
 * Root/admin bridge and Desktop transfer/consent wizard are later checkpoints.
 */
