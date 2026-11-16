import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import type { ProductProjectConfigurationContext } from '../../../../docs/contracts/product-postgres'
import { ProductEnvironmentRepository } from '../db/productEnvironmentRepository'
import { ProductPostgresRepository } from '../db/productPostgresRepository'
import { environmentContextSchema } from './productEnvironment'
import { ProductPostgresError } from './productPostgres'
import { ProductEnvironmentPreflight } from './productEnvironmentPreflight'
import { ProductPostgresPreflight } from './productPostgresPreflight'
import { canonicalH2Json } from './productH2Proof'
import {
  readProductSourceConfiguration,
  type ProductSourceBasis
} from './productSourceConfiguration'

type Source = ProductSourceBasis & {
  deploy_config_json: string
  config_sha256: string
  source_generation: number
  source_config_sha256: string
  repository_url: string
  production_ref: string
  repository_root: string
  git_repo_url: string
  git_ref: string
  git_root: string
  source_type: string
  source_path: string | null
  imported_from_vps: number
  auto_deploy_paused: number
  basis_json: string
  basis_hash: string
  basis_repo: string
  basis_ref: string
  basis_root: string
}
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

/** Same-UID metadata only. Main must separately authenticate its own durable intents
 * before following a source generation returned here. No runtime capability escapes.
 */
export function readProjectConfigurationContext(
  db: Database.Database,
  cipher: AesGcmCredentialCipher,
  controllerId: string,
  administratorId: string,
  input: unknown
): ProductProjectConfigurationContext {
  const fail = (): never => {
    throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
  }
  if (db.inTransaction) throw new ProductPostgresError('PRODUCT_POSTGRES_INPUT_INVALID')
  const parsed = environmentContextSchema.safeParse(input)
  if (!parsed.success) throw new ProductPostgresError('PRODUCT_POSTGRES_INPUT_INVALID')
  const request = parsed.data
  try {
    if (request.controller_id !== controllerId) fail()
    const read = (): Source => {
      const row = db
        .prepare(
          `SELECT s.*,c.source_generation,c.source_config_sha256,c.auto_deploy_paused,
          a.framework,a.host_port,a.container_port,a.healthcheck_path,a.needs_db,
          a.source_type,a.source_path,a.imported_from_vps,a.git_repo_url,a.git_ref,a.git_root,
          b.deploy_config_json basis_json,b.config_sha256 basis_hash,b.repository_url basis_repo,
          b.production_ref basis_ref,b.repository_root basis_root
          FROM product_app_control c JOIN app a ON a.id=c.app_id
          JOIN product_source_config s ON s.app_id=c.app_id AND s.source_generation=c.source_generation
          JOIN product_source_config b ON b.app_id=c.app_id AND b.source_generation=?
          WHERE c.app_id=? AND c.controller_id=? AND c.ownership_generation=? AND c.mode='product'`
        )
        .get(
          request.expected_source_generation,
          request.app_id,
          controllerId,
          request.expected_ownership_generation
        ) as Source | undefined
      if (
        !row ||
        row.source_generation < request.expected_source_generation ||
        row.basis_hash !== request.expected_source_config_sha256 ||
        row.config_sha256 !== row.source_config_sha256 ||
        row.repository_url !== row.basis_repo ||
        row.production_ref !== row.basis_ref ||
        row.repository_root !== row.basis_root ||
        row.source_type !== 'git' ||
        row.source_path !== null ||
        row.imported_from_vps !== 0 ||
        row.git_repo_url !== row.repository_url ||
        row.git_ref !== row.production_ref ||
        row.git_root !== row.repository_root
      )
        return fail()
      const current = readProductSourceConfiguration(row, row.deploy_config_json)
      const basisJson = JSON.parse(row.basis_json)
      const basis = readProductSourceConfiguration(
        { ...row, needs_db: basisJson.needs_db === true ? 1 : 0 },
        row.basis_json
      )
      if (
        digest(row.basis_json) !== row.basis_hash ||
        digest(row.deploy_config_json) !== row.config_sha256
      )
        fail()
      // Config parsing above rejects unknown fields and inconsistent needs_db.
      // Only authenticated optional references are excluded from the immutable plan.
      const plan = (value: typeof current): object => ({
        framework: value.framework,
        host_port: value.host_port,
        container_port: value.container_port,
        healthcheck_path: value.healthcheck_path
      })
      if (canonicalH2Json(plan(basis)) !== canonicalH2Json(plan(current))) fail()
      return row
    }
    const before = read()
    const current = {
      ...request,
      expected_source_generation: before.source_generation,
      expected_source_config_sha256: before.source_config_sha256
    }
    const environment = new ProductEnvironmentRepository(db, cipher).context(
      current,
      controllerId,
      administratorId
    )
    const selectedEnvironment = ProductEnvironmentPreflight.review(db, current, cipher)
    const selectedDatabase = ProductPostgresPreflight.review(db, current, cipher)
    const prepared =
      before.framework === 'static-spa'
        ? null
        : new ProductPostgresRepository(db, cipher).state({ format: 1, scope: environment.scope })
    if (selectedDatabase && selectedDatabase.metadata.database_id !== prepared?.database_id) fail()
    if (canonicalH2Json(read()) !== canonicalH2Json(before)) fail()
    return {
      controller_id: controllerId,
      scope: environment.scope,
      basis_source_generation: request.expected_source_generation,
      basis_source_config_sha256: request.expected_source_config_sha256,
      source_generation: before.source_generation,
      source_config_sha256: before.source_config_sha256,
      environment: { latest: environment.latest, selected: selectedEnvironment?.metadata ?? null },
      database: { prepared, selected: selectedDatabase?.metadata ?? null },
      auto_deploy_paused: before.auto_deploy_paused === 1,
      deployment_started: false
    }
  } catch {
    return fail()
  }
}
