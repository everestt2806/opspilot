import type { DesktopInstallation, DesktopInstallationPlan } from "./desktop-controller-installation";
import type { ControllerHostPreflight } from "./product-controller-release";
import type { DesktopControllerConnection } from "./desktop-controller-ipc";

/** Build input only. Baked into Main; never trust a renderer/resource catalog at runtime. */
export type ControllerInstallerCatalog = {
  format: 1;
  releases: Array<{
    release_id: string;
    node_version: string;
    minimum_glibc: string;
    release_sha256: string;
    installer_sha256: string;
  }>;
};
export type ControllerInstallerRelease = {
  release_id: string;
  node_version: string;
  minimum_glibc: string;
  platform: "linux-x64-glibc";
  state: "available" | "missing" | "invalid";
};
export type ControllerInstallerOverview = {
  releases: ControllerInstallerRelease[];
  installations: DesktopInstallation[];
  connections: DesktopControllerConnection[];
};
export type ControllerInstallerReview = {
  plan: DesktopInstallationPlan | null;
  host: ControllerHostPreflight;
  next: "install" | "inspect_existing" | "blocked";
  root_required: boolean;
};
export type ControllerInstallerSendInput = {
  request_key: string;
  operation: "transfer" | "install" | "recover";
  consent: true;
};
export type ControllerInstalledRegisterInput = {
  installation_request_key: string;
  binding_id: string;
  display_name: string;
  allow_write?: boolean;
};
export type ControllerInstalledPrepareInput = Omit<ControllerInstalledRegisterInput, "binding_id">;
/**
 * Main derives fixed resource paths from its app/resources root + release_id.
 * Build-time catalog contains independent pins; external resources cannot replace
 * those pins. Sender/receiver independently verify the exact Linux release bytes.
 * No WSL/host Linux Node required on Windows Desktop. Missing/invalid resources
 * disable installation; packaged-build gate requires a valid nonempty catalog.
 * Review is readonly; prepare commits local journal, explicit send performs SSH
 * mutation. Unknown outcomes require explicit inspect/same-key recover. No generic
 * path/command/UID/pin IPC. Installation identity and token binding remain separate.
 */
