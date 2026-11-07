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
  allow_write?: boolean
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
  scopes: Array<'read' | 'deploy:manual' | 'policy:write'>
}
export interface DesktopControllerApp {
  app_id: number
  ownership_generation: number
  source_generation: number
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
  capabilities: {
    redeploy: 'available' | 'blocked' | 'unsupported'
    pause: 'available' | 'blocked' | 'unsupported'
    resume: 'available' | 'blocked' | 'unsupported'
  }
  items: DesktopControllerApp[]
  next_cursor: string | null
  has_more: boolean
}
export interface DesktopControllerPageInput {
  binding_id: string
  cursor?: string
}
export interface DesktopControllerAppStatus {
  binding_id: string
  binding_revision: number
  controller_id: string
  app_id: number
  ownership_generation: number
  source_generation: number
  current_deployment_id: number | null
  current_deployment_sha: string | null
  current_deployment_state: string | null
  latest_job_id: string | null
  latest_job_state: string | null
  checked_at: string
  data_freshness: 'current' | 'stale' | 'unknown'
}
/** Invocation maps are added to the main ipc-contract.ts; no generic URL/SQL/call IPC. */
