/** Root installer receives this only through independently pinned SSH bootstrap. */
export type InstalledControllerAuthority = {
  request_key: string;
  release_sha256: string;
  installer_sha256: string;
  controller_id: string;
  runtime_uid: number;
  payload_sha256: string;
  /** c-2b1: operation in the upgrade namespace; its UUID is authority.request_key. */
  revision?: {
    installation_request_key: string;
    parent_upgrade_key: string | null;
    parent_release_sha256: string;
  };
};
export type InstalledControllerAdminRequest = {
  format: 1;
  operation: "admin";
  authority: InstalledControllerAuthority;
  command: {
    operation:
      | "enroll-desktop-client" | "revoke-desktop-client" | "status"
      | "project-targets" | "register-project" | "verify-project-source"
      | "project-target-state" | "enroll-project-target" | "project-readiness"
      | "register-vps" | "stage-project-environment" | "project-environment-state"
      | "project-environment-context";
    payload: object;
  };
};
/**
 * No caller paths, GID, account, service name, executable, or script. Root-only.
 * Python verifies staging/catalog/release + independent installer pin before Node.
 * Trusted installer attests its existing root receipt/account/unit/runtime/data
 * using inspect, compares expected identity, then setpriv --clear-groups drops to
 * the attested UID/GID before executing fixed Python same-UID admin verification.
 * No init/reset/reinstall, public admin API, privilege bypass or token logging.
 * Main stores request key + authority_revision with immutable binding intent;
 * current journal/profile/cipher checks apply before dispatch and after awaits.
 * Revision admin keeps original installation flock across current upgraded journal/
 * exact runtime/unit/UID attestation and the service-UID command. It accepts only
 * is_current, settled active/rolled_back and ready running service; never historical
 * cached evidence. release/tool pin refers to the upgrade staging namespace; payload
 * pin must equal the runtime actually selected (may be parent after rollback).
 */
