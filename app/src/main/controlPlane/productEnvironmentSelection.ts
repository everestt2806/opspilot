import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import type {
  ProductEnvironmentSelectionInput,
  ProductEnvironmentSelectionResult,
  ProductEnvironmentReference
} from '../../../../docs/contracts/product-environment'
import { ProductEnvironmentRepository } from '../db/productEnvironmentRepository'
import { TargetEnrollmentRepository } from './targetEnrollmentRepository'
import { canonicalH2Json } from './productH2Proof'
import { environmentSelectionSchema, ProductEnvironmentError } from './productEnvironment'

type Source = {
  repository_url: string
  production_ref: string
  repository_root: string
  deploy_config_json: string
  config_sha256: string
  source_generation: number
  source_config_sha256: string
  controller_id: string
  ownership_generation: number
  framework: 'express' | 'static-spa' | 'nextjs'
  host_port: number
  container_port: number
  healthcheck_path: string
  needs_db: number
  source_type: string
  git_repo_url: string
  git_ref: string
  git_root: string
  source_path: string | null
  imported_from_vps: number
  healthcheck_response_type: string
}
type Stored = {
  app_id: number
  source_generation: number
  source_config_sha256: string
  controller_id: string
  ownership_generation: number
  environment_revision: number
  target_binding_json: string
  administrator_id: string
  request_key: string
  request_json: string
  previous_source_generation: number
  previous_source_config_sha256: string
  created_at: string
}
const sha = (value: string): string => createHash('sha256').update(value).digest('hex')

/** Internal same-UID CLI: chỉ chọn desired source, chưa cấp quyền runtime env. */
export class ProductEnvironmentSelection {
  private readonly vault: ProductEnvironmentRepository
  constructor(
    private readonly db: Database.Database,
    cipher: AesGcmCredentialCipher
  ) {
    this.vault = new ProductEnvironmentRepository(db, cipher)
  }
  select(
    input: unknown,
    controllerId: string,
    administratorId: string
  ): ProductEnvironmentSelectionResult {
    if (this.db.inTransaction)
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_INPUT_INVALID')
    const parsed = environmentSelectionSchema.safeParse(input)
    if (!parsed.success) throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_INPUT_INVALID')
    const request = parsed.data
    try {
      return this.db
        .transaction(() => {
          if (
            !/^unix:(0|[1-9][0-9]{0,9})$/.test(administratorId) ||
            request.scope.controller_id !== controllerId
          )
            throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED')
          const controllers = this.db
            .prepare('SELECT controller_id,status FROM product_controller')
            .all() as { controller_id: string; status: string }[]
          if (
            controllers.length !== 1 ||
            controllers[0].controller_id !== controllerId ||
            controllers[0].status !== 'active'
          )
            throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED')
          this.vault.metadataInTransaction(request.scope, request.environment_revision)
          const source = this.source(request)
          const body = canonicalH2Json(request)
          const previous = this.db
            .prepare(
              'SELECT * FROM product_source_environment WHERE controller_id=? AND administrator_id=? AND request_key=?'
            )
            .get(controllerId, administratorId, request.request_key) as Stored | undefined
          if (previous) {
            if (previous.request_json !== body)
              throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_IDEMPOTENCY_CONFLICT')
            this.verifyBinding(previous, request)
            if (
              source.source_generation !== previous.source_generation ||
              source.source_config_sha256 !== previous.source_config_sha256
            )
              throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_SOURCE_CHANGED')
            this.quiescent(request)
            return this.result(previous, 'already_selected')
          }
          this.assertExpected(source, request)
          this.quiescent(request)
          const latest = this.db
            .prepare(
              'SELECT MAX(revision) n FROM product_environment_revision WHERE app_id=? AND ownership_generation=?'
            )
            .get(request.scope.app_id, request.scope.ownership_generation) as { n: number }
          if (latest.n !== request.expected_latest_revision)
            throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_REVISION_CONFLICT')
          const max = this.db
            .prepare('SELECT MAX(source_generation) n FROM product_source_config WHERE app_id=?')
            .get(request.scope.app_id) as { n: number }
          if (!Number.isSafeInteger(max.n) || max.n >= Number.MAX_SAFE_INTEGER)
            throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_SOURCE_CHANGED')
          const generation = max.n + 1,
            stamp = new Date().toISOString(),
            environment: ProductEnvironmentReference = {
              controller_id: controllerId,
              ownership_generation: request.scope.ownership_generation,
              revision: request.environment_revision
            }
          const config = canonicalH2Json({ ...this.base(source), environment }),
            hash = sha(config)
          this.db
            .prepare(
              `INSERT INTO product_source_config(app_id,source_generation,repository_url,production_ref,repository_root,deploy_config_json,config_sha256,created_at)
        VALUES(?,?,?,?,?,?,?,?)`
            )
            .run(
              request.scope.app_id,
              generation,
              source.repository_url,
              source.production_ref,
              source.repository_root,
              config,
              hash,
              stamp
            )
          const record: Stored = {
            app_id: request.scope.app_id,
            source_generation: generation,
            source_config_sha256: hash,
            controller_id: controllerId,
            ownership_generation: request.scope.ownership_generation,
            environment_revision: request.environment_revision,
            target_binding_json: canonicalH2Json(request.scope.target),
            administrator_id: administratorId,
            request_key: request.request_key,
            request_json: body,
            previous_source_generation: source.source_generation,
            previous_source_config_sha256: source.source_config_sha256,
            created_at: stamp
          }
          this.db
            .prepare(
              `INSERT INTO product_source_environment(app_id,source_generation,source_config_sha256,controller_id,ownership_generation,environment_revision,
        target_binding_json,administrator_id,request_key,request_json,previous_source_generation,previous_source_config_sha256,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`
            )
            .run(
              record.app_id,
              generation,
              hash,
              controllerId,
              record.ownership_generation,
              record.environment_revision,
              record.target_binding_json,
              administratorId,
              record.request_key,
              body,
              record.previous_source_generation,
              record.previous_source_config_sha256,
              stamp
            )
          this.vault.metadataInTransaction(request.scope, request.environment_revision)
          this.assertExpected(this.source(request), request)
          this.quiescent(request)
          const updated = this.db
            .prepare(
              `UPDATE product_app_control SET source_generation=?,source_config_sha256=?,changed_at=? WHERE app_id=? AND controller_id=?
        AND ownership_generation=? AND source_generation=? AND source_config_sha256=? AND mode='product' AND auto_deploy_paused=1`
            )
            .run(
              generation,
              hash,
              stamp,
              request.scope.app_id,
              controllerId,
              request.scope.ownership_generation,
              request.expected_source_generation,
              request.expected_source_config_sha256
            )
          if (updated.changes !== 1)
            throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_SOURCE_CHANGED')
          this.db
            .prepare(
              `INSERT INTO product_history_event(controller_id,app_id,kind,created_at,safe_summary_json) VALUES(?,?,'environment_source_selected',?,?)`
            )
            .run(
              controllerId,
              request.scope.app_id,
              stamp,
              canonicalH2Json({
                request_key: request.request_key,
                source_generation: generation,
                environment_revision: request.environment_revision,
                previous_source_generation: source.source_generation
              })
            )
          this.verifyBinding(record, request)
          this.vault.metadataInTransaction(request.scope, request.environment_revision)
          const finalSource = this.source(request)
          if (
            finalSource.source_generation !== generation ||
            finalSource.source_config_sha256 !== hash
          )
            throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_SOURCE_CHANGED')
          this.quiescent(request)
          return this.result(record, 'selected')
        })
        .immediate()
    } catch (error) {
      if (error instanceof ProductEnvironmentError) throw error
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_STORAGE_UNAVAILABLE')
    }
  }
  private source(request: ProductEnvironmentSelectionInput): Source {
    const s = this.db
      .prepare(
        `SELECT s.*,c.controller_id,c.ownership_generation,c.source_generation,c.source_config_sha256,
      a.framework,a.host_port,a.container_port,a.healthcheck_path,a.needs_db,a.source_type,a.git_repo_url,a.git_ref,a.git_root,
      a.source_path,a.imported_from_vps,a.healthcheck_response_type FROM product_source_config s JOIN product_app_control c
      ON c.app_id=s.app_id AND c.source_generation=s.source_generation AND c.source_config_sha256=s.config_sha256
      JOIN app a ON a.id=c.app_id WHERE c.app_id=? AND c.mode='product'`
      )
      .get(request.scope.app_id) as Source | undefined
    if (
      !s ||
      s.controller_id !== request.scope.controller_id ||
      s.ownership_generation !== request.scope.ownership_generation ||
      !['express', 'static-spa', 'nextjs'].includes(s.framework) ||
      s.needs_db !== 0 ||
      s.source_type !== 'git' ||
      s.source_path !== null ||
      s.imported_from_vps !== 0 ||
      s.healthcheck_response_type !== 'status_2xx' ||
      s.git_repo_url !== s.repository_url ||
      s.git_ref !== s.production_ref ||
      s.git_root !== s.repository_root
    )
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED')
    let config: Record<string, unknown>
    try {
      config = JSON.parse(s.deploy_config_json)
    } catch {
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED')
    }
    const env = config?.environment
    const expected = canonicalH2Json({
      ...this.base(s),
      ...(env === undefined ? {} : { environment: env })
    })
    if (s.deploy_config_json !== expected || sha(expected) !== s.config_sha256)
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED')
    if (env !== undefined) {
      const binding = this.db
        .prepare('SELECT * FROM product_source_environment WHERE app_id=? AND source_generation=?')
        .get(request.scope.app_id, s.source_generation) as Stored | undefined
      if (!binding) throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED')
      this.verifyBinding(binding, request, false)
    }
    return s
  }
  private base(source: Source): object {
    return {
      framework: source.framework,
      host_port: source.host_port,
      container_port: source.container_port,
      healthcheck_path: source.healthcheck_path,
      needs_db: false
    }
  }
  private assertExpected(source: Source, request: ProductEnvironmentSelectionInput): void {
    if (
      source.source_generation !== request.expected_source_generation ||
      source.source_config_sha256 !== request.expected_source_config_sha256
    )
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_SOURCE_CHANGED')
  }
  private quiescent(request: ProductEnvironmentSelectionInput): void {
    try {
      const target = new TargetEnrollmentRepository(this.db).target(
        request.scope.controller_id,
        request.scope.app_id,
        request.scope.ownership_generation,
        true
      )
      if (canonicalH2Json(target) !== canonicalH2Json(request.scope.target)) throw Error()
      const unknown = this.db
        .prepare(
          `SELECT 1 FROM product_deploy_attempt a JOIN product_deploy_job j ON j.job_id=a.job_id
        WHERE j.app_id=? AND (a.remote_outcome='unknown' OR a.state='uncertain') LIMIT 1`
        )
        .get(request.scope.app_id)
      const worker = this.db
        .prepare(
          `SELECT 1 FROM product_worker_lease l JOIN product_deploy_job j ON j.job_id=l.job_id
        WHERE j.app_id=? AND l.released_at IS NULL LIMIT 1`
        )
        .get(request.scope.app_id)
      const pending = this.db
        .prepare(
          `SELECT 1 FROM product_runtime_execution r JOIN product_deploy_attempt a ON a.attempt_id=r.attempt_id
        JOIN product_deploy_job j ON j.job_id=a.job_id LEFT JOIN product_runtime_terminal t ON t.attempt_id=r.attempt_id
        WHERE j.app_id=? AND (t.attempt_id IS NULL OR t.settled_at IS NULL OR t.leases_released_at IS NULL) LIMIT 1`
        )
        .get(request.scope.app_id)
      if (unknown || worker || pending) throw Error()
    } catch {
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_REQUIRES_QUIESCENCE')
    }
  }
  private verifyBinding(
    row: Stored,
    request: ProductEnvironmentSelectionInput,
    matchRequest = true
  ): void {
    const source = this.db
      .prepare(
        'SELECT deploy_config_json,config_sha256 FROM product_source_config WHERE app_id=? AND source_generation=?'
      )
      .get(row.app_id, row.source_generation) as
      { deploy_config_json: string; config_sha256: string } | undefined
    let body: ProductEnvironmentSelectionInput, config: Record<string, unknown>
    try {
      body = environmentSelectionSchema.parse(JSON.parse(row.request_json))
      config = JSON.parse(source?.deploy_config_json ?? 'null')
    } catch {
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_UNAVAILABLE')
    }
    const expectedRef = {
      controller_id: row.controller_id,
      ownership_generation: row.ownership_generation,
      revision: row.environment_revision
    }
    if (
      !source ||
      source.config_sha256 !== row.source_config_sha256 ||
      sha(canonicalH2Json(config)) !== row.source_config_sha256 ||
      row.app_id !== request.scope.app_id ||
      row.controller_id !== request.scope.controller_id ||
      row.ownership_generation !== request.scope.ownership_generation ||
      row.target_binding_json !== canonicalH2Json(request.scope.target) ||
      canonicalH2Json(config.environment) !== canonicalH2Json(expectedRef) ||
      body.scope.app_id !== row.app_id ||
      body.scope.controller_id !== row.controller_id ||
      body.scope.ownership_generation !== row.ownership_generation ||
      canonicalH2Json(body.scope.target) !== row.target_binding_json ||
      body.environment_revision !== row.environment_revision ||
      body.request_key !== row.request_key ||
      body.expected_source_generation !== row.previous_source_generation ||
      body.expected_source_config_sha256 !== row.previous_source_config_sha256 ||
      (matchRequest && canonicalH2Json(body) !== canonicalH2Json(request))
    )
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_UNAVAILABLE')
  }
  private result(
    row: Stored,
    state: ProductEnvironmentSelectionResult['state']
  ): ProductEnvironmentSelectionResult {
    return {
      state,
      request_key: row.request_key,
      controller_id: row.controller_id,
      app_id: row.app_id,
      ownership_generation: row.ownership_generation,
      source_generation: row.source_generation,
      source_config_sha256: row.source_config_sha256,
      environment: {
        controller_id: row.controller_id,
        ownership_generation: row.ownership_generation,
        revision: row.environment_revision
      },
      auto_deploy_paused: true,
      deployment_started: false,
      execution: 'requires_environment_runtime'
    }
  }
}
