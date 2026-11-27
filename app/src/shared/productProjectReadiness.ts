/** Fixed Linux admin CLI project-readiness, bounded stdin. Source/target authority
 * từ registered setup, artifact/pin từ current Desktop binding; không arbitrary command.
 */
export interface ProductProjectReadinessInput {
  format: 1
  controller_id: string
  app_id: number
  expected_ownership_generation: number
  expected_source_generation: number
  expected_source_config_sha256: string
  expected_target_security_revision: number
  artifact: string
  manifest_sha256: string
}
export interface ProductReadinessResources {
  cpu_count: number
  available_ram_bytes: number
  workspace_available_bytes: number
  docker_ready?: boolean
  port_ready?: boolean
}
export type ProductReadinessCheck =
  'first_deployment' | 'controller_resources' | 'target_enrollment' | 'source' | 'target_resources'
export type ProductReadinessReason =
  | 'current_deployment_exists'
  | 'controller_resources_unavailable'
  | 'target_not_enrolled'
  | 'target_verification_failed'
  | 'source_verification_failed'
  | 'target_resources_unavailable'
  | 'authority_changed'
  | 'aborted'
export interface ProductProjectReadiness {
  controller_id: string
  app_id: number
  ownership_generation: number
  source_generation: number
  source_config_sha256: string
  target_vps_id: number
  target_security_revision: number
  repository_url: string
  production_ref: string
  repository_root: string
  host_port: number
  commit_sha: string | null
  state: 'ready' | 'blocked'
  checks: Array<{ key: ProductReadinessCheck; state: 'passed' | 'blocked' | 'not_checked' }>
  reasons: ProductReadinessReason[]
  controller_resources: ProductReadinessResources | null
  target_resources: ProductReadinessResources | null
  auto_deploy_paused: true
  deployment_started: false
  checked_at: string
}
/** Readiness fetches current branch fullSHA with shared source preflight and records
 * paused observation. Target inspect reuses enrolled material, can update controller
 * proof state but never installs/rotates helpers or writes target runtime resources.
 * Resource probe read-only; expected SSH identity before auth; authority checked after
 * every await and before result. No job/build/deployment/auto-enable. Not reservation.
 * Main issues bounded cached receipt60s only for ready result; not a persistent ready flag.
 * Fixed admin whole210s/helper180s/CLI165s; source internal90s limits unchanged.
 */
