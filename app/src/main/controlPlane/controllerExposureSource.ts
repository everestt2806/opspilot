import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { H2Context } from '../../../../docs/contracts/product-h2-runtime'
import type { ProductExposureView } from '../../../../docs/contracts/product-exposure'
import { canonicalH2Json } from './productH2Proof'
import { productEnvironmentReferenceSchema } from './productEnvironmentPreflight'

type Source = {
  source_generation: number
  config_sha256: string
  deploy_config_json: string
  repository_url: string
  production_ref: string
  repository_root: string
}

/** Chỉ identity metadata. Không decrypt vault, không cấp quyền chạy config cũ/mới. */
export function readExposureSourceState(
  db: Database.Database,
  desired: { app_id: number; source_generation: number; source_config_sha256: string },
  context: H2Context
): ProductExposureView['source_state'] | null {
  const claim = context.claim
  if (claim.source_generation === desired.source_generation)
    return claim.source_config_sha256 === desired.source_config_sha256
      ? {
          active_generation: claim.source_generation,
          desired_generation: desired.source_generation,
          relation: 'current'
        }
      : null
  if (claim.source_generation >= desired.source_generation) return null
  try {
    const app = db
      .prepare(
        `SELECT framework,host_port,container_port,healthcheck_path,needs_db,
      source_type,git_repo_url,git_ref,git_root,source_path,imported_from_vps FROM app WHERE id=?`
      )
      .get(desired.app_id) as Record<string, unknown> | undefined
    if (
      !app ||
      app.source_type !== 'git' ||
      app.needs_db !== 0 ||
      app.source_path !== null ||
      app.imported_from_vps !== 0
    )
      return null
    const target = canonicalH2Json(context.target)
    const read = (generation: number, expectedHash: string): Source | null => {
      const row = db
        .prepare('SELECT * FROM product_source_config WHERE app_id=? AND source_generation=?')
        .get(desired.app_id, generation) as Source | undefined
      if (
        !row ||
        Buffer.byteLength(row.deploy_config_json) > 8192 ||
        row.config_sha256 !== expectedHash ||
        row.repository_url !== app.git_repo_url ||
        row.production_ref !== app.git_ref ||
        row.repository_root !== app.git_root
      )
        return null
      const config = JSON.parse(row.deploy_config_json)
      const ref = Object.hasOwn(config, 'environment')
        ? productEnvironmentReferenceSchema.parse(config.environment)
        : undefined
      const canonical = canonicalH2Json({
        framework: app.framework,
        host_port: app.host_port,
        container_port: app.container_port,
        healthcheck_path: app.healthcheck_path,
        needs_db: false,
        ...(ref ? { environment: ref } : {})
      })
      if (
        canonical !== row.deploy_config_json ||
        createHash('sha256').update(canonical).digest('hex') !== expectedHash
      )
        return null
      if (
        generation === claim.source_generation &&
        canonicalH2Json(ref ?? null) !== canonicalH2Json(context.environment ?? null)
      )
        return null
      if (ref) {
        if (
          ref.controller_id !== claim.controller_id ||
          ref.ownership_generation !== claim.ownership_generation
        )
          return null
        const binding = db
          .prepare(
            `SELECT s.controller_id,s.ownership_generation,s.environment_revision,s.source_config_sha256,
          s.target_binding_json,r.controller_id revision_controller,r.target_binding_json revision_target,r.framework
          FROM product_source_environment s JOIN product_environment_revision r ON r.app_id=s.app_id
          AND r.ownership_generation=s.ownership_generation AND r.revision=s.environment_revision
          WHERE s.app_id=? AND s.source_generation=?`
          )
          .get(desired.app_id, generation) as Record<string, unknown> | undefined
        if (
          !binding ||
          binding.controller_id !== claim.controller_id ||
          binding.revision_controller !== claim.controller_id ||
          binding.ownership_generation !== claim.ownership_generation ||
          binding.environment_revision !== ref.revision ||
          binding.source_config_sha256 !== expectedHash ||
          binding.target_binding_json !== target ||
          binding.revision_target !== target ||
          binding.framework !== app.framework
        )
          return null
      } else if (generation !== claim.source_generation) return null
      return row
    }
    const active = read(claim.source_generation, claim.source_config_sha256),
      current = read(desired.source_generation, desired.source_config_sha256)
    if (
      !active ||
      !current ||
      active.repository_url !== current.repository_url ||
      active.production_ref !== current.production_ref ||
      active.repository_root !== current.repository_root
    )
      return null
    return {
      active_generation: claim.source_generation,
      desired_generation: desired.source_generation,
      relation: 'pending'
    }
  } catch {
    return null
  }
}
