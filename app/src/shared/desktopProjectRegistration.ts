/** Metadata-only IPC, main creates setup UUID and remote request key. */
export interface DesktopProjectSetupInput {
  binding_id: string
  target_vps_id: number
  app_name: string
  framework: 'express'
  repository_url: string
  production_ref: string
  repository_root: string
  host_port: number | null
  container_port: number
  healthcheck_path: string
}
export interface DesktopProjectSetup {
  request_key: string
  binding_id: string
  binding_revision: number
  controller_id: string
  target_vps_id: number
  target_security_revision: number
  app_name: string
  repository_url: string
  production_ref: string
  repository_root: string
  host_port: number | null
  container_port: number
  healthcheck_path: string
  state: 'prepared' | 'in_flight' | 'outcome_unknown' | 'registered' | 'cancelled'
  app_id: number | null
  created_at: string
  updated_at: string
}
export interface DesktopProjectTargets {
  binding_id: string
  binding_revision: number
  controller_id: string
  items: Array<{
    id: number
    name: string
    host: string
    port: number
    username: string
    host_fingerprint: string
    ssh_security_revision: number
  }>
  next_after_id: number | null
  has_more: boolean
}
/** Retry setup through same SSH-admin principal/key can repeat register-project:
 * controller transaction is idempotent; never create new UUID after ambiguous
 * reply. Binding/target revision checks before+after await; no implicit rebind.
 * Registered means app/source paused, not target enrollment or deployment.
 */
