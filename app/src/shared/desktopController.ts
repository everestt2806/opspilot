/** Metadata-only Desktop controller IPC. Copy to app/src/shared/desktopController.ts.
 * API/SSH credentials are resolved in main, never supplied by or returned to renderer.
 */
export interface DesktopControllerRegisterInput {
  binding_id: string
  controller_id: string
  vps_id: number
  artifact_path: string
  data_directory: string
  node_path: string
  manifest_sha256: string
  display_name: string
}
export interface DesktopControllerConnection {
  binding_id: string
  controller_id: string
  vps_id: number
  revision: number
  state: 'pending' | 'active' | 'delivery_unknown' | 'disabled'
  display_name: string
  remote_client_id: string | null
  credential_expires_at: string | null
  updated_at: string
}
export interface DesktopControllerApp {
  app_id: number
  app_name: string
  production_ref: string
  desired_sha: string | null
  auto_deploy_paused: boolean
  reconciliation_state:
    'pending' | 'queued' | 'in_progress' | 'satisfied' | 'paused' | 'failed' | 'uncertain' | null
  observed_at: string | null
}
export interface DesktopControllerSnapshot {
  binding_id: string
  controller_id: string
  binding_revision: number
  service_state: 'ready' | 'degraded' | 'maintenance'
  data_freshness: 'current' | 'stale' | 'unknown'
  checked_at: string
  items: DesktopControllerApp[]
  next_cursor: string | null
  has_more: boolean
}
export interface DesktopControllerPageInput {
  binding_id: string
  cursor?: string
}
/** Invocation maps are added to the main ipc-contract.ts; no generic URL/SQL/call IPC. */
