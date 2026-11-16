import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import type {
  ProductEnvironmentReference,
  ProductEnvironmentScope
} from '../../../../docs/contracts/product-environment'
import type { ProductPostgresReference } from '../../../../docs/contracts/product-postgres'
import { canonicalH2Json } from './productH2Proof'
import { ProductPostgresError } from './productPostgres'

export interface ProductPostgresSourceBinding {
  app_id: number
  source_generation: number
  controller_id: string
  ownership_generation: number
  database_id: string
  source_config_sha256: string
  target_binding_json: string
  environment_source_generation: number | null
  created_at: string
}
export interface BoundProductEnvironmentSource {
  controller_id: string
  ownership_generation: number
  environment_revision: number
  target_binding_json: string
  source_config_sha256: string
  basis_source_generation: number
}
export function readProductPostgresSourceBinding(
  db: Database.Database,
  scope: ProductEnvironmentScope,
  sourceGeneration: number,
  sourceHash: string,
  reference: ProductPostgresReference
): ProductPostgresSourceBinding {
  const row = db
    .prepare('SELECT * FROM product_source_postgres WHERE app_id=? AND source_generation=?')
    .get(scope.app_id, sourceGeneration) as ProductPostgresSourceBinding | undefined
  if (
    !row ||
    row.controller_id !== scope.controller_id ||
    row.ownership_generation !== scope.ownership_generation ||
    row.database_id !== reference.database_id ||
    reference.controller_id !== scope.controller_id ||
    reference.ownership_generation !== scope.ownership_generation ||
    row.source_config_sha256 !== sourceHash ||
    row.target_binding_json !== canonicalH2Json(scope.target)
  )
    throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
  return row
}

/** Preserve the original env selection receipt when a DB selection creates a new source.
 * The current immutable DB binding authenticates the inherited env source generation.
 * Only this internal result normalizes current source hash; no receipt row is rewritten.
 */
export function readBoundProductEnvironmentSource(
  db: Database.Database,
  scope: ProductEnvironmentScope,
  sourceGeneration: number,
  sourceHash: string,
  environment: ProductEnvironmentReference,
  database?: ProductPostgresReference
): BoundProductEnvironmentSource {
  let basis = sourceGeneration
  if (database) {
    const binding = readProductPostgresSourceBinding(
      db,
      scope,
      sourceGeneration,
      sourceHash,
      database
    )
    if (
      !Number.isSafeInteger(binding.environment_source_generation) ||
      binding.environment_source_generation! < 1 ||
      binding.environment_source_generation! > sourceGeneration
    )
      throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
    basis = binding.environment_source_generation!
  }
  const row = db
    .prepare(
      `SELECT controller_id,ownership_generation,environment_revision,target_binding_json,source_config_sha256
    FROM product_source_environment WHERE app_id=? AND source_generation=?`
    )
    .get(scope.app_id, basis) as
    Omit<BoundProductEnvironmentSource, 'basis_source_generation'> | undefined
  const source = db
    .prepare(
      'SELECT deploy_config_json,config_sha256 FROM product_source_config WHERE app_id=? AND source_generation=?'
    )
    .get(scope.app_id, basis) as { deploy_config_json: string; config_sha256: string } | undefined
  if (
    !row ||
    !source ||
    row.controller_id !== scope.controller_id ||
    row.ownership_generation !== scope.ownership_generation ||
    environment.controller_id !== scope.controller_id ||
    environment.ownership_generation !== scope.ownership_generation ||
    row.environment_revision !== environment.revision ||
    row.target_binding_json !== canonicalH2Json(scope.target) ||
    row.source_config_sha256 !== source.config_sha256 ||
    createHash('sha256').update(source.deploy_config_json).digest('hex') !== source.config_sha256 ||
    canonicalH2Json(JSON.parse(source.deploy_config_json).environment) !==
      canonicalH2Json(environment) ||
    (!database && source.config_sha256 !== sourceHash)
  )
    throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
  return { ...row, source_config_sha256: sourceHash, basis_source_generation: basis }
}
