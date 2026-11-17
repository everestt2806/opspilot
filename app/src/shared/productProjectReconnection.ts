import type { ProductEnvironmentMetadata } from './productEnvironment'
import type { ProductPostgresMetadata, ProductPostgresReference } from './productPostgres'

/** Same-UID controller CLI project-reconnection-context. Readonly discovery for
 * an authenticated administrator; no historical Desktop journal is required.
 * An optional previous snapshot digest makes a subsequent read a strict review
 * recheck. The digest is not a credential, consent receipt or deploy capability.
 */
export interface ProductProjectReconnectionInput {
  format: 1
  controller_id: string
  app_id: number
  expected_snapshot_sha256?: string
}
export interface ProductProjectReconnectionContext {
  state: 'review_required'
  controller_id: string
  app_id: number
  app_name: string
  /** Projection metadata readonly; không import DTO ghi của controller. */
  scope: {
    controller_id: string
    app_id: number
    ownership_generation: number
    target: {
      vps_id: number
      host: string
      port: number
      username: string
      auth_type: 'key' | 'password'
      host_fingerprint: string
      ssh_security_revision: number
    }
  }
  source: {
    generation: number
    config_sha256: string
    repository_url: string
    production_ref: string
    repository_root: string
    configuration: {
      framework: 'express' | 'static-spa' | 'nextjs'
      host_port: number
      container_port: number
      healthcheck_path: string
      needs_db: boolean
      environment?: { controller_id: string; ownership_generation: number; revision: number }
      database?: ProductPostgresReference
    }
  }
  selected_environment: ProductEnvironmentMetadata | null
  selected_database: ProductPostgresMetadata | null
  auto_deploy_paused: boolean
  snapshot_sha256: string
  consent_required: true
  desktop_authority: 'not_granted'
  runtime_status: 'not_checked'
}

/** Only current active Product/public-Git projects with internally consistent
 * app/source/owner/target and authenticated selected ENV/PG metadata qualify.
 * Read while auto-deploy enabled is permitted; a changed snapshot must be
 * reviewed again. No pause/job/SSH/Git/provisioning/credential output/SQLite write.
 * Future Main confirmation requires a distinct explicit-consent provenance;
 * never manufacture register-project or ENV/PG selection receipts from this DTO.
 */
