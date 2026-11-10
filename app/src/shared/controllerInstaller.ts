// Metadata DTO copies of docs/contracts/*; keep CLI rootDir inside app.
import type { DesktopControllerConnection } from './desktopController'

export type ControllerBootstrapLocator = {
  request_key: string
  release_sha256: string
  installer_sha256: string
}
export type ControllerInstallationPhase =
  | 'prepared'
  | 'account_pending'
  | 'account_ready'
  | 'runtime_pending'
  | 'runtime_ready'
  | 'data_pending'
  | 'data_ready'
  | 'database_pending'
  | 'database_ready'
  | 'key_pending'
  | 'key_ready'
  | 'unit_pending'
  | 'unit_ready'
  | 'start_pending'
  | 'installed'

export type ControllerInstallationResult = {
  format: 1
  request_key: string
  phase: ControllerInstallationPhase
  controller_id: string | null
  service_state: 'running' | 'stopped' | 'starting' | 'failed' | 'not_installed'
  runtime_uid: number | null
  service_enabled: boolean
  artifact_path: string
  node_path: string
  data_directory: string
  payload_sha256: string
}

export type DesktopInstallationState =
  'prepared' | 'in_flight' | 'outcome_unknown' | 'transferred' | 'installed' | 'cancelled'
export type DesktopInstallationOperation = 'transfer' | 'install' | 'recover' | 'inspect'
export type DesktopInstallation = ControllerBootstrapLocator & {
  vps_id: number
  authority_revision: number
  release_id: string
  state: DesktopInstallationState
  controller_id: string | null
  last_result: ControllerInstallationResult | null
  created_at: string
  updated_at: string
}
export type DesktopInstallationPlan = {
  plan_id: string
  expires_at: string
  vps_id: number
  host: string
  username: string
  host_fingerprint: string
  release_id: string
  request_key: string
  remote_existing: boolean
  rebind_required: boolean
}
export type ControllerHostFacts = Readonly<{
  format: 1
  system: string
  architecture: string
  libc: string
  libc_version: string
  uid: number
  available_memory_bytes: number
  free_disk_bytes: number
  systemd_system: boolean
  systemd_user_bus: boolean
  user_linger: boolean
  installation_conflict: boolean
}>

export type ControllerHostPreflight = Readonly<{
  state: 'compatible_snapshot' | 'blocked'
  service_mode: 'system' | 'user'
  reasons: ReadonlyArray<
    'PLATFORM' | 'LIBC' | 'MEMORY' | 'DISK' | 'SYSTEMD' | 'EXISTING_INSTALLATION'
  >
  facts: ControllerHostFacts
}>
/** Build input only. Baked into Main; never trust a renderer/resource catalog at runtime. */
export type ControllerInstallerCatalog = {
  format: 1
  releases: Array<{
    release_id: string
    node_version: string
    minimum_glibc: string
    release_sha256: string
    installer_sha256: string
  }>
}
export type ControllerInstallerRelease = {
  release_id: string
  node_version: string
  minimum_glibc: string
  platform: 'linux-x64-glibc'
  state: 'available' | 'missing' | 'invalid'
}
export type ControllerInstallerOverview = {
  releases: ControllerInstallerRelease[]
  installations: DesktopInstallation[]
  connections: DesktopControllerConnection[]
}
export type ControllerInstallerReview = {
  plan: DesktopInstallationPlan | null
  host: ControllerHostPreflight
  next: 'install' | 'inspect_existing' | 'blocked'
  root_required: boolean
}
export type ControllerInstallerSendInput = {
  request_key: string
  operation: 'transfer' | 'install' | 'recover'
  consent: true
}
export type ControllerInstalledRegisterInput = {
  installation_request_key: string
  binding_id: string
  display_name: string
  allow_write?: boolean
}
export type ControllerInstalledPrepareInput = Omit<ControllerInstalledRegisterInput, 'binding_id'>
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
