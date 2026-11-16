import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { ProductPostgresRepository } from '../db/productPostgresRepository'
import type {
  ProductPostgresSelectionInput,
  ProductPostgresSelectionResult
} from '../../../../docs/contracts/product-postgres'
import { canonicalH2Json } from './productH2Proof'
import {
  postgresSelectionSchema,
  postgresSelectionResultSchema,
  ProductPostgresError
} from './productPostgres'
import {
  TargetEnrollmentRepository,
  TARGET_HELPER_UPGRADE_PENDING_PREFIX
} from './targetEnrollmentRepository'
import {
  readProductSourceConfiguration,
  type ProductSourceBasis,
  type ProductSourceConfiguration
} from './productSourceConfiguration'
import {
  readBoundProductEnvironmentSource,
  readProductPostgresSourceBinding
} from './productSourceBindings'

type Source = ProductSourceBasis & {
  repository_url: string
  production_ref: string
  repository_root: string
  deploy_config_json: string
  config_sha256: string
  controller_id: string
  ownership_generation: number
  source_generation: number
  source_config_sha256: string
  source_type: string
  source_path: string | null
  git_repo_url: string
  git_ref: string
  git_root: string
  imported_from_vps: number
  healthcheck_response_type: string
}
const hash = (value: string): string => createHash('sha256').update(value).digest('hex')

/** Trusted SQL primitive. Public CLI/Main wrapper must probe a PG-capable pinned helper
 * before calling select; no selection CLI is enabled yet. No SSH/job/policy activation.
 */
export class ProductPostgresSelection {
  private readonly vault: ProductPostgresRepository
  constructor(
    private readonly db: Database.Database,
    cipher: AesGcmCredentialCipher
  ) {
    this.vault = new ProductPostgresRepository(db, cipher)
  }

  select(
    input: unknown,
    controllerId: string,
    administrator: string
  ): ProductPostgresSelectionResult {
    return this.guarded(() => {
      const request = this.request(input, controllerId, administrator)
      if (this.db.inTransaction) throw new ProductPostgresError('PRODUCT_POSTGRES_INPUT_INVALID')
      return this.db
        .transaction(() => {
          const source = this.source(request),
            config = this.configuration(source, request)
          this.quiescent(request)
          const body = canonicalH2Json(request),
            previous = this.receipt(request, administrator)
          if (previous) {
            if (previous.request_json !== body)
              throw new ProductPostgresError('PRODUCT_POSTGRES_REQUEST_CONFLICT')
            const result = this.readResult(previous.result_json, request)
            if (
              source.source_generation !== result.source_generation ||
              source.source_config_sha256 !== result.source_config_sha256
            )
              throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
            this.vault.verifyAvailableInTransaction(request.scope, request.database_id)
            return { ...result, state: 'already_selected' as const }
          }
          if (
            source.source_generation !== request.expected_source_generation ||
            source.source_config_sha256 !== request.expected_source_config_sha256
          )
            throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
          const metadata = this.vault.verifyAvailableInTransaction(
            request.scope,
            request.database_id
          )
          if (metadata.framework !== source.framework)
            throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
          const reference = {
            database_id: request.database_id,
            controller_id: controllerId,
            ownership_generation: request.scope.ownership_generation
          }
          let generation = source.source_generation,
            digest = source.source_config_sha256
          const stamp = new Date().toISOString(),
            already = !!config.database
          if (config.database && canonicalH2Json(config.database) !== canonicalH2Json(reference))
            throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
          if (!already) {
            const latest = this.db
              .prepare('SELECT MAX(source_generation) n FROM product_source_config WHERE app_id=?')
              .get(request.scope.app_id) as { n: number }
            if (!Number.isSafeInteger(latest.n) || latest.n >= Number.MAX_SAFE_INTEGER)
              throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
            generation = latest.n + 1
            const next = canonicalH2Json({ ...config, needs_db: true, database: reference })
            digest = hash(next)
            this.db
              .prepare(
                `INSERT INTO product_source_config(app_id,source_generation,repository_url,production_ref,repository_root,deploy_config_json,config_sha256,created_at) VALUES(?,?,?,?,?,?,?,?)`
              )
              .run(
                request.scope.app_id,
                generation,
                source.repository_url,
                source.production_ref,
                source.repository_root,
                next,
                digest,
                stamp
              )
            this.db
              .prepare(
                `INSERT INTO product_source_postgres(app_id,source_generation,controller_id,ownership_generation,database_id,source_config_sha256,target_binding_json,environment_source_generation,created_at) VALUES(?,?,?,?,?,?,?,?,?)`
              )
              .run(
                request.scope.app_id,
                generation,
                controllerId,
                request.scope.ownership_generation,
                request.database_id,
                digest,
                canonicalH2Json(request.scope.target),
                config.environment ? source.source_generation : null,
                stamp
              )
            const updated = this.db
              .prepare(
                `UPDATE product_app_control SET source_generation=?,source_config_sha256=?,changed_at=?
            WHERE app_id=? AND controller_id=? AND ownership_generation=? AND source_generation=? AND source_config_sha256=? AND mode='product' AND auto_deploy_paused=1`
              )
              .run(
                generation,
                digest,
                stamp,
                request.scope.app_id,
                controllerId,
                request.scope.ownership_generation,
                source.source_generation,
                source.source_config_sha256
              )
            if (
              updated.changes !== 1 ||
              this.db
                .prepare('UPDATE app SET needs_db=1 WHERE id=? AND needs_db=0')
                .run(request.scope.app_id).changes !== 1
            )
              throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
            this.db
              .prepare(
                `INSERT INTO product_history_event(controller_id,app_id,kind,created_at,safe_summary_json) VALUES(?,?,'postgres_source_selected',?,?)`
              )
              .run(
                controllerId,
                request.scope.app_id,
                stamp,
                canonicalH2Json({
                  request_key: request.request_key,
                  database_id: request.database_id,
                  source_generation: generation,
                  previous_source_generation: source.source_generation
                })
              )
          }
          const result: ProductPostgresSelectionResult = {
            state: already ? 'already_selected' : 'selected',
            request_key: request.request_key,
            controller_id: controllerId,
            app_id: request.scope.app_id,
            ownership_generation: request.scope.ownership_generation,
            source_generation: generation,
            source_config_sha256: digest,
            database: reference,
            auto_deploy_paused: true,
            deployment_started: false,
            execution: 'requires_postgres_runtime'
          }
          this.db
            .prepare(
              `INSERT INTO product_postgres_selection_request(controller_id,administrator_id,request_key,request_json,app_id,source_generation,result_json,created_at) VALUES(?,?,?,?,?,?,?,?)`
            )
            .run(
              controllerId,
              administrator,
              request.request_key,
              body,
              request.scope.app_id,
              generation,
              canonicalH2Json(result),
              stamp
            )
          this.configuration(this.source(request), request)
          this.quiescent(request)
          this.vault.verifyAvailableInTransaction(request.scope, request.database_id)
          return result
        })
        .immediate()
    })
  }

  lookup(
    input: unknown,
    controllerId: string,
    administrator: string
  ): {
    result: ProductPostgresSelectionResult | null
    is_current: boolean
    definitively_unapplied: boolean
  } {
    return this.guarded(() => {
      const request = this.request(input, controllerId, administrator)
      return this.db.transaction(() => {
        const source = this.source(request)
        this.configuration(source, request)
        const previous = this.receipt(request, administrator)
        if (!previous)
          return {
            result: null,
            is_current: false,
            definitively_unapplied: source.source_generation > request.expected_source_generation
          }
        if (previous.request_json !== canonicalH2Json(request))
          throw new ProductPostgresError('PRODUCT_POSTGRES_REQUEST_CONFLICT')
        const result = this.readResult(previous.result_json, request)
        return {
          result,
          is_current:
            source.source_generation === result.source_generation &&
            source.source_config_sha256 === result.source_config_sha256,
          definitively_unapplied: false
        }
      })()
    })
  }
  private request(
    input: unknown,
    controllerId: string,
    administrator: string
  ): ProductPostgresSelectionInput {
    const parsed = postgresSelectionSchema.safeParse(input)
    if (
      !parsed.success ||
      parsed.data.scope.controller_id !== controllerId ||
      !/^unix:(0|[1-9][0-9]{0,15})$/.test(administrator)
    )
      throw new ProductPostgresError('PRODUCT_POSTGRES_INPUT_INVALID')
    return parsed.data
  }
  private source(request: ProductPostgresSelectionInput): Source {
    const target = new TargetEnrollmentRepository(this.db).target(
      request.scope.controller_id,
      request.scope.app_id,
      request.scope.ownership_generation,
      false
    )
    if (canonicalH2Json(target) !== canonicalH2Json(request.scope.target))
      throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
    const row = this.db
      .prepare(
        `SELECT s.*,c.controller_id,c.ownership_generation,c.source_generation,c.source_config_sha256,
      a.framework,a.host_port,a.container_port,a.healthcheck_path,a.needs_db,a.source_type,a.source_path,a.imported_from_vps,
      a.healthcheck_response_type,a.git_repo_url,a.git_ref,a.git_root
      FROM product_source_config s JOIN product_app_control c ON c.app_id=s.app_id AND c.source_generation=s.source_generation AND c.source_config_sha256=s.config_sha256
      JOIN app a ON a.id=c.app_id WHERE c.app_id=? AND c.mode='product'`
      )
      .get(request.scope.app_id) as Source | undefined
    if (
      !row ||
      row.controller_id !== request.scope.controller_id ||
      row.ownership_generation !== request.scope.ownership_generation ||
      !['express', 'nextjs'].includes(row.framework) ||
      row.source_type !== 'git' ||
      row.source_path !== null ||
      row.imported_from_vps !== 0 ||
      row.healthcheck_response_type !== 'status_2xx' ||
      row.git_repo_url !== row.repository_url ||
      row.git_ref !== row.production_ref ||
      row.git_root !== row.repository_root
    )
      throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
    return row
  }
  private configuration(
    source: Source,
    request: ProductPostgresSelectionInput
  ): ProductSourceConfiguration {
    const config = readProductSourceConfiguration(source, source.deploy_config_json)
    if (hash(source.deploy_config_json) !== source.source_config_sha256)
      throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
    if (config.database) {
      const binding = readProductPostgresSourceBinding(
        this.db,
        request.scope,
        source.source_generation,
        source.source_config_sha256,
        config.database
      )
      if (!config.environment && binding.environment_source_generation !== null)
        throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
    }
    if (config.environment)
      readBoundProductEnvironmentSource(
        this.db,
        request.scope,
        source.source_generation,
        source.source_config_sha256,
        config.environment,
        config.database
      )
    return config
  }
  private quiescent(request: ProductPostgresSelectionInput): void {
    new TargetEnrollmentRepository(this.db).target(
      request.scope.controller_id,
      request.scope.app_id,
      request.scope.ownership_generation,
      true
    )
    const pending = this.db
      .prepare(
        `SELECT 1 FROM product_target_enrollment WHERE app_id=? AND last_error_code LIKE ?
      UNION ALL SELECT 1 FROM product_worker_lease w JOIN product_deploy_job j ON j.job_id=w.job_id WHERE j.app_id=? AND w.released_at IS NULL
      UNION ALL SELECT 1 FROM product_deploy_attempt a JOIN product_deploy_job j ON j.job_id=a.job_id WHERE j.app_id=? AND (a.remote_outcome='unknown' OR a.state='uncertain')
      UNION ALL SELECT 1 FROM product_runtime_execution r JOIN product_deploy_attempt a ON a.attempt_id=r.attempt_id JOIN product_deploy_job j ON j.job_id=a.job_id
      LEFT JOIN product_runtime_terminal t ON t.attempt_id=r.attempt_id WHERE j.app_id=? AND (t.attempt_id IS NULL OR t.settled_at IS NULL OR t.leases_released_at IS NULL) LIMIT 1`
      )
      .get(
        request.scope.app_id,
        TARGET_HELPER_UPGRADE_PENDING_PREFIX + '%',
        request.scope.app_id,
        request.scope.app_id,
        request.scope.app_id
      )
    if (pending) throw new ProductPostgresError('PRODUCT_POSTGRES_REQUIRES_QUIESCENCE')
  }
  private receipt(
    request: ProductPostgresSelectionInput,
    administrator: string
  ): { request_json: string; result_json: string } | undefined {
    return this.db
      .prepare(
        'SELECT request_json,result_json FROM product_postgres_selection_request WHERE controller_id=? AND administrator_id=? AND request_key=?'
      )
      .get(request.scope.controller_id, administrator, request.request_key) as
      { request_json: string; result_json: string } | undefined
  }
  private readResult(
    raw: string,
    request: ProductPostgresSelectionInput
  ): ProductPostgresSelectionResult {
    const result = postgresSelectionResultSchema.parse(JSON.parse(raw))
    if (
      result.request_key !== request.request_key ||
      result.controller_id !== request.scope.controller_id ||
      result.app_id !== request.scope.app_id ||
      result.ownership_generation !== request.scope.ownership_generation ||
      result.database?.database_id !== request.database_id ||
      result.database?.controller_id !== request.scope.controller_id ||
      result.database?.ownership_generation !== request.scope.ownership_generation ||
      result.auto_deploy_paused !== true ||
      result.deployment_started !== false ||
      result.execution !== 'requires_postgres_runtime'
    )
      throw new ProductPostgresError('PRODUCT_POSTGRES_UNAVAILABLE')
    return result
  }
  private guarded<T>(work: () => T): T {
    try {
      return work()
    } catch (error) {
      if (error instanceof ProductPostgresError) throw error
      throw new ProductPostgresError('PRODUCT_POSTGRES_UNAVAILABLE')
    }
  }
}
