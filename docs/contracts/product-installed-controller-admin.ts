/** Root installer receives this only through independently pinned SSH bootstrap. */
export type InstalledControllerAuthority = {
  request_key: string;
  release_sha256: string;
  installer_sha256: string;
  controller_id: string;
  runtime_uid: number;
  payload_sha256: string;
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
      | "register-vps";
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
 */
