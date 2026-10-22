import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import type {
  ProductAppOwnership,
  ProductBranchObservation,
  ProductControllerId,
  ProductDesiredBranchState,
  ProductJobState,
  ProductSourceConfigIdentity
} from '../../../../docs/contracts/product-auto-deploy'

export type ProductRecord<T> = { kind: 'present'; value: T } | { kind: 'absent' }

export interface ProductControllerRecord {
  controller_id: ProductControllerId
  created_at: string
  status: 'active' | 'maintenance' | 'revoked'
}

export interface ProductAppOwnershipRecord extends ProductAppOwnership {}
export interface ProductSourceConfigRecord extends ProductSourceConfigIdentity {
  deploy_config_json: string
  created_at: string
}

export interface ProductReconcileIdentity {
  controllerId: ProductControllerId
  appId: number
  ownershipGeneration: number
  sourceGeneration: number
  configSha256: string
  ref: string
}

export interface ProductObserveTipInput extends ProductReconcileIdentity {
  /** Latest sequence observed before the external Git read began; null means no prior tip. */
  expectedObservationSequence: number | null
  tipSha: string
}

export interface ProductReconcileResult {
  state: ProductDesiredBranchState['reconciliation_state']
  reason:
    | 'queued'
    | 'already_queued'
    | 'active_job'
    | 'live_matches'
    | 'manual_pause'
    | 'uncertain_job'
    | 'terminal_failure'
    | 'terminal_success_live_mismatch'
    | 'terminal_job'
    | 'desired_missing'
  jobId: string | null
}

export interface ProductObserveTipResult {
  observationSequence: number
  observationCreated: boolean
  desiredSha: string
  reconciliation: ProductReconcileResult
}

type ProductDesiredBranchRow = Omit<ProductDesiredBranchState, 'auto_paused'> & {
  auto_paused: 0 | 1
}

/** Product persistence access; mutations are transactional and never enroll apps implicitly. */
export class ProductDeployRepository {
  constructor(private readonly database: Database.Database) {}

  observeTip(input: ProductObserveTipInput): ProductObserveTipResult {
    validateTipSha(input.tipSha)
    validateExpectedSequence(input.expectedObservationSequence)
    return this.database
      .transaction(() => {
        const context = loadReconcileContext(this.database, input)
        const latest = this.database
          .prepare(
            `SELECT observation_sequence, observed_sha
             FROM product_branch_observation
             WHERE app_id = ? AND source_generation = ? AND ref = ?
             ORDER BY observation_sequence DESC LIMIT 1`
          )
          .get(input.appId, input.sourceGeneration, input.ref) as
          { observation_sequence: number; observed_sha: string } | undefined

        const actualSequence = latest?.observation_sequence ?? null
        if (actualSequence !== input.expectedObservationSequence) {
          throw new ProductDeployRepositoryError('STALE_OBSERVATION')
        }

        const observationCreated = latest?.observed_sha !== input.tipSha
        let sequence = actualSequence
        if (observationCreated) {
          sequence = (actualSequence ?? 0) + 1
          this.database
            .prepare(
              `INSERT INTO product_branch_observation
               (app_id, source_generation, ref, observation_sequence, observed_sha, observed_at)
               VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
            )
            .run(input.appId, input.sourceGeneration, input.ref, sequence, input.tipSha)
          this.database
            .prepare(
              `INSERT INTO product_desired_branch
               (app_id, source_generation, ref, desired_observation_sequence, desired_sha,
                reconcile_epoch, reconciled_observation_sequence, reconciled_epoch,
                reconciliation_state, reconciliation_job_id, auto_paused, pause_reason, updated_at)
               VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, 'pending', NULL, 0, NULL,
                       strftime('%Y-%m-%dT%H:%M:%fZ','now'))
               ON CONFLICT(app_id, source_generation, ref) DO UPDATE SET
                 desired_observation_sequence=excluded.desired_observation_sequence,
                 desired_sha=excluded.desired_sha,
                 reconciled_observation_sequence=NULL,
                 reconciled_epoch=NULL,
                 reconciliation_state=CASE WHEN product_desired_branch.auto_paused=1
                                           THEN 'paused' ELSE 'pending' END,
                 reconciliation_job_id=NULL,
                 updated_at=excluded.updated_at`
            )
            .run(input.appId, input.sourceGeneration, input.ref, sequence, input.tipSha)
        } else if (latest && sequence !== null) {
          const desired = this.database
            .prepare(
              `SELECT desired_observation_sequence, desired_sha
               FROM product_desired_branch
               WHERE app_id=? AND source_generation=? AND ref=?`
            )
            .get(input.appId, input.sourceGeneration, input.ref) as
            { desired_observation_sequence: number; desired_sha: string } | undefined
          if (
            desired &&
            (desired.desired_observation_sequence !== sequence ||
              desired.desired_sha !== latest.observed_sha)
          ) {
            throw new ProductDeployRepositoryError('DESIRED_OBSERVATION_MISMATCH')
          }
          if (!desired) {
            this.database
              .prepare(
                `INSERT INTO product_desired_branch
                 (app_id, source_generation, ref, desired_observation_sequence, desired_sha,
                  reconcile_epoch, reconciliation_state, auto_paused, updated_at)
                 VALUES (?, ?, ?, ?, ?, 0, 'pending', 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
              )
              .run(input.appId, input.sourceGeneration, input.ref, sequence, latest.observed_sha)
          }
        }

        if (sequence === null) {
          throw new ProductDeployRepositoryError('OBSERVATION_NOT_CREATED')
        }

        const desired = this.loadDesired(input.appId, input.sourceGeneration, input.ref)
        if (!desired) throw new ProductDeployRepositoryError('DESIRED_STATE_NOT_CREATED')
        this.supersedeObsoleteAutoJobs(input, desired)
        const reconciliation = this.reconcileDesiredInTransaction(context, desired)
        return {
          observationSequence: sequence,
          observationCreated,
          desiredSha: desired.desired_sha,
          reconciliation
        }
      })
      .immediate()
  }

  reconcileDesired(identity: ProductReconcileIdentity): ProductReconcileResult {
    return this.database
      .transaction(() => {
        const context = loadReconcileContext(this.database, identity)
        const desired = this.loadDesired(identity.appId, identity.sourceGeneration, identity.ref)
        if (!desired) {
          return { state: 'pending' as const, reason: 'desired_missing' as const, jobId: null }
        }

        const latest = this.database
          .prepare(
            `SELECT observation_sequence, observed_sha
             FROM product_branch_observation
             WHERE app_id=? AND source_generation=? AND ref=?
             ORDER BY observation_sequence DESC LIMIT 1`
          )
          .get(identity.appId, identity.sourceGeneration, identity.ref) as
          { observation_sequence: number; observed_sha: string } | undefined
        if (
          !latest ||
          latest.observation_sequence !== desired.desired_observation_sequence ||
          latest.observed_sha !== desired.desired_sha
        ) {
          throw new ProductDeployRepositoryError('DESIRED_OBSERVATION_MISMATCH')
        }

        this.supersedeObsoleteAutoJobs(identity, desired)
        return this.reconcileDesiredInTransaction(context, desired)
      })
      .immediate()
  }

  private loadDesired(
    appId: number,
    sourceGeneration: number,
    ref: string
  ): ProductDesiredBranchState | undefined {
    const row = this.database
      .prepare(
        `SELECT app_id, source_generation, ref, desired_observation_sequence,
                       desired_sha, reconcile_epoch, reconciled_observation_sequence,
                       reconciled_epoch, reconciliation_state, reconciliation_job_id,
                       auto_paused, pause_reason, updated_at
                FROM product_desired_branch
                WHERE app_id=? AND source_generation=? AND ref=?`
      )
      .get(appId, sourceGeneration, ref) as ProductDesiredBranchRow | undefined
    return row ? { ...row, auto_paused: row.auto_paused === 1 } : undefined
  }

  private supersedeObsoleteAutoJobs(
    identity: ProductReconcileIdentity,
    desired: ProductDesiredBranchState
  ): void {
    this.database
      .prepare(
        `UPDATE product_deploy_job
         SET state='superseded', finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             safe_error_code='AUTO_DESIRED_SUPERSEDED'
         WHERE app_id=? AND trigger='branch_poll' AND state IN ('queued','retry_wait')
           AND (source_generation<>? OR ownership_generation<>? OR source_config_sha256<>?
             OR ref<>? OR observation_sequence<>? OR reconcile_epoch<>? OR target_sha<>?)`
      )
      .run(
        identity.appId,
        identity.sourceGeneration,
        identity.ownershipGeneration,
        identity.configSha256,
        identity.ref,
        desired.desired_observation_sequence,
        desired.reconcile_epoch,
        desired.desired_sha
      )
  }

  private reconcileDesiredInTransaction(
    context: ReconcileContext,
    desired: ProductDesiredBranchState
  ): ProductReconcileResult {
    const updateDesired = (
      state: ProductDesiredBranchState['reconciliation_state'],
      jobId: string | null,
      markReconciled: boolean
    ): void => {
      this.database
        .prepare(
          `UPDATE product_desired_branch
           SET reconciliation_state=?, reconciliation_job_id=?,
               reconciled_observation_sequence=?, reconciled_epoch=?,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE app_id=? AND source_generation=? AND ref=?`
        )
        .run(
          state,
          jobId,
          markReconciled ? desired.desired_observation_sequence : null,
          markReconciled ? desired.reconcile_epoch : null,
          desired.app_id,
          desired.source_generation,
          desired.ref
        )
    }
    const result = (
      state: ProductDesiredBranchState['reconciliation_state'],
      reason: ProductReconcileResult['reason'],
      jobId: string | null
    ): ProductReconcileResult => ({ state, reason, jobId })

    if (desired.auto_paused) {
      updateDesired('paused', desired.reconciliation_job_id, false)
      return result('paused', 'manual_pause', desired.reconciliation_job_id)
    }

    const uncertain = this.database
      .prepare(
        `SELECT job_id FROM product_deploy_job WHERE app_id=? AND state='uncertain'
         UNION ALL
         SELECT job_id FROM product_deploy_attempt WHERE job_id IN
           (SELECT job_id FROM product_deploy_job WHERE app_id=?) AND state='uncertain'
         LIMIT 1`
      )
      .get(desired.app_id, desired.app_id) as { job_id: string } | undefined
    if (uncertain) {
      const matching = this.getAutoJob(context, desired)
      const jobId = matching?.job_id ?? uncertain.job_id
      updateDesired('uncertain', jobId, false)
      return result('uncertain', 'uncertain_job', jobId)
    }

    const active = this.database
      .prepare(
        `SELECT job_id, trigger, source_generation, source_config_sha256,
                ownership_generation, ref, observation_sequence, reconcile_epoch, target_sha, state
         FROM product_deploy_job
         WHERE app_id=? AND state IN ('claimed','deploying')
         ORDER BY created_at, job_id LIMIT 1`
      )
      .get(desired.app_id) as ProductJobRow | undefined
    if (active) {
      const isDesiredAutoJob = isMatchingAutoJob(active, context, desired)
      const state = isDesiredAutoJob ? 'in_progress' : 'pending'
      updateDesired(state, isDesiredAutoJob ? active.job_id : null, false)
      return result(state, 'active_job', isDesiredAutoJob ? active.job_id : null)
    }

    if (this.isCanonicalLiveDesired(context, desired)) {
      updateDesired('satisfied', null, true)
      return result('satisfied', 'live_matches', null)
    }

    const existing = this.getAutoJob(context, desired)
    if (existing) {
      if (existing.state === 'queued' || existing.state === 'retry_wait') {
        updateDesired('queued', existing.job_id, true)
        return result('queued', 'already_queued', existing.job_id)
      }
      if (existing.state === 'failed' || existing.state === 'rolled_back') {
        updateDesired('failed', existing.job_id, true)
        return result('failed', 'terminal_failure', existing.job_id)
      }
      if (existing.state === 'uncertain') {
        updateDesired('uncertain', existing.job_id, false)
        return result('uncertain', 'uncertain_job', existing.job_id)
      }
      if (existing.state === 'succeeded') {
        updateDesired('pending', existing.job_id, false)
        return result('pending', 'terminal_success_live_mismatch', existing.job_id)
      }
      updateDesired('pending', existing.job_id, false)
      return result('pending', 'terminal_job', existing.job_id)
    }

    const idempotencyKey = `auto:${desired.source_generation}:${desired.desired_observation_sequence}:${desired.reconcile_epoch}`
    const jobId = createJobId()
    this.database
      .prepare(
        `INSERT INTO product_deploy_job
         (job_id, controller_id, app_id, ownership_generation, source_generation,
          source_config_sha256, trigger, idempotency_key, ref, target_sha,
          observation_sequence, reconcile_epoch, state, attempt_count, max_attempts,
          available_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'branch_poll', ?, ?, ?, ?, ?, 'queued', 0, 3,
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
      )
      .run(
        jobId,
        context.controllerId,
        desired.app_id,
        context.ownershipGeneration,
        desired.source_generation,
        context.configSha256,
        idempotencyKey,
        desired.ref,
        desired.desired_sha,
        desired.desired_observation_sequence,
        desired.reconcile_epoch
      )
    updateDesired('queued', jobId, true)
    return result('queued', 'queued', jobId)
  }

  private getAutoJob(
    context: ReconcileContext,
    desired: ProductDesiredBranchState
  ): ProductJobRow | undefined {
    const idempotencyKey = `auto:${desired.source_generation}:${desired.desired_observation_sequence}:${desired.reconcile_epoch}`
    const row = this.database
      .prepare(
        `SELECT job_id, trigger, source_generation, source_config_sha256,
                ownership_generation, ref, observation_sequence, reconcile_epoch,
                target_sha, state
         FROM product_deploy_job
         WHERE controller_id=? AND app_id=? AND idempotency_key=?`
      )
      .get(context.controllerId, desired.app_id, idempotencyKey) as ProductJobRow | undefined
    if (row && !isMatchingAutoJob(row, context, desired)) {
      throw new ProductDeployRepositoryError('IDEMPOTENCY_KEY_COLLISION')
    }
    return row
  }

  private isCanonicalLiveDesired(
    context: ReconcileContext,
    desired: ProductDesiredBranchState
  ): boolean {
    const row = this.database
      .prepare(
        `SELECT d.git_commit_sha
         FROM app a
         JOIN deployment d ON d.id=a.current_deployment_id AND d.app_id=a.id AND d.status='running'
         JOIN product_deploy_attempt pa ON pa.deployment_id=d.id AND pa.state='succeeded'
         JOIN product_deploy_job j ON j.job_id=pa.job_id AND j.app_id=a.id AND j.state='succeeded'
         JOIN product_source_config sc ON sc.app_id=j.app_id
           AND sc.source_generation=j.source_generation
           AND sc.config_sha256=j.source_config_sha256
         WHERE a.id=? AND j.controller_id=? AND j.ownership_generation=?
           AND j.source_generation=? AND j.source_config_sha256=?
           AND j.target_sha=? AND d.git_commit_sha=j.target_sha
         LIMIT 1`
      )
      .get(
        desired.app_id,
        context.controllerId,
        context.ownershipGeneration,
        desired.source_generation,
        context.configSha256,
        desired.desired_sha
      ) as { git_commit_sha: string } | undefined
    return row?.git_commit_sha === desired.desired_sha
  }

  getController(controllerId: ProductControllerId): ProductRecord<ProductControllerRecord> {
    return readOne(
      this.database
        .prepare(
          'SELECT controller_id, created_at, status FROM product_controller WHERE controller_id = ?'
        )
        .get(controllerId) as ProductControllerRecord | undefined
    )
  }

  getOwnership(appId: number): ProductRecord<ProductAppOwnershipRecord> {
    return readOne(
      this.database
        .prepare(
          `SELECT app_id, mode, controller_id, ownership_generation, changed_at
                  FROM product_app_control WHERE app_id = ?`
        )
        .get(appId) as ProductAppOwnershipRecord | undefined
    )
  }

  getSourceConfig(
    appId: number,
    sourceGeneration: number
  ): ProductRecord<ProductSourceConfigRecord> {
    return readOne(
      this.database
        .prepare(
          `SELECT app_id, source_generation, config_sha256, repository_url,
                         production_ref, repository_root, deploy_config_json, created_at
                  FROM product_source_config WHERE app_id = ? AND source_generation = ?`
        )
        .get(appId, sourceGeneration) as ProductSourceConfigRecord | undefined
    )
  }

  getDesiredState(
    appId: number,
    sourceGeneration: number,
    ref: string
  ): ProductRecord<ProductDesiredBranchState> {
    const row = this.database
      .prepare(
        `SELECT app_id, source_generation, ref, desired_observation_sequence,
                       desired_sha, reconcile_epoch, reconciled_observation_sequence,
                       reconciled_epoch, reconciliation_state, reconciliation_job_id,
                       auto_paused, pause_reason, updated_at
                FROM product_desired_branch
                WHERE app_id = ? AND source_generation = ? AND ref = ?`
      )
      .get(appId, sourceGeneration, ref) as ProductDesiredBranchRow | undefined
    if (row === undefined) return { kind: 'absent' }
    return { kind: 'present', value: { ...row, auto_paused: row.auto_paused === 1 } }
  }

  getLatestObservation(
    appId: number,
    sourceGeneration: number,
    ref: string
  ): ProductRecord<ProductBranchObservation> {
    return readOne(
      this.database
        .prepare(
          `SELECT app_id, source_generation, ref, observation_sequence, observed_sha, observed_at
                  FROM product_branch_observation
                  WHERE app_id = ? AND source_generation = ? AND ref = ?
                  ORDER BY observation_sequence DESC LIMIT 1`
        )
        .get(appId, sourceGeneration, ref) as ProductBranchObservation | undefined
    )
  }
}

function readOne<T>(row: T | undefined): ProductRecord<T> {
  return row === undefined ? { kind: 'absent' } : { kind: 'present', value: row }
}

type ReconcileContext = ProductReconcileIdentity

interface ProductJobRow {
  job_id: string
  trigger: string
  source_generation: number
  source_config_sha256: string
  ownership_generation: number
  ref: string
  observation_sequence: number | null
  reconcile_epoch: number | null
  target_sha: string | null
  state: ProductJobState
}

export class ProductDeployRepositoryError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'ProductDeployRepositoryError'
  }
}

function loadReconcileContext(
  database: Database.Database,
  identity: ProductReconcileIdentity
): ReconcileContext {
  if (
    !Number.isSafeInteger(identity.appId) ||
    identity.appId < 1 ||
    !Number.isSafeInteger(identity.ownershipGeneration) ||
    identity.ownershipGeneration < 1 ||
    !Number.isSafeInteger(identity.sourceGeneration) ||
    identity.sourceGeneration < 1 ||
    !/^[0-9a-f]{64}$/.test(identity.configSha256) ||
    typeof identity.ref !== 'string' ||
    identity.ref.length === 0
  ) {
    throw new ProductDeployRepositoryError('INVALID_PRODUCT_IDENTITY')
  }

  const controller = database
    .prepare('SELECT status FROM product_controller WHERE controller_id=?')
    .get(identity.controllerId) as { status: string } | undefined
  if (!controller || controller.status !== 'active') {
    throw new ProductDeployRepositoryError('CONTROLLER_NOT_ACTIVE')
  }

  const app = database
    .prepare(
      `SELECT a.id, a.source_type, a.git_repo_url, v.archived_at
       FROM app a JOIN vps v ON v.id=a.vps_id WHERE a.id=?`
    )
    .get(identity.appId) as
    | { id: number; source_type: string; git_repo_url: string | null; archived_at: string | null }
    | undefined
  if (!app || app.archived_at !== null || app.source_type !== 'git' || !app.git_repo_url) {
    throw new ProductDeployRepositoryError('PRODUCT_APP_NOT_ELIGIBLE')
  }

  const ownership = database
    .prepare(
      `SELECT mode, controller_id, ownership_generation, source_generation,
              source_config_sha256
       FROM product_app_control WHERE app_id=?`
    )
    .get(identity.appId) as
    | {
        mode: string
        controller_id: string | null
        ownership_generation: number
        source_generation: number
        source_config_sha256: string
      }
    | undefined
  if (
    !ownership ||
    ownership.mode !== 'product' ||
    ownership.controller_id !== identity.controllerId ||
    ownership.ownership_generation !== identity.ownershipGeneration ||
    ownership.source_generation !== identity.sourceGeneration ||
    ownership.source_config_sha256 !== identity.configSha256
  ) {
    throw new ProductDeployRepositoryError('PRODUCT_STATE_CONFLICT')
  }

  const source = database
    .prepare(
      `SELECT repository_url, production_ref, config_sha256
       FROM product_source_config WHERE app_id=? AND source_generation=?`
    )
    .get(identity.appId, identity.sourceGeneration) as
    { repository_url: string; production_ref: string; config_sha256: string } | undefined
  if (
    !source ||
    source.config_sha256 !== identity.configSha256 ||
    source.production_ref !== identity.ref ||
    source.repository_url !== app.git_repo_url
  ) {
    throw new ProductDeployRepositoryError('PRODUCT_STATE_CONFLICT')
  }

  return { ...identity }
}

function isMatchingAutoJob(
  job: ProductJobRow,
  context: ReconcileContext,
  desired: ProductDesiredBranchState
): boolean {
  return (
    job.trigger === 'branch_poll' &&
    job.source_generation === desired.source_generation &&
    job.source_config_sha256 === context.configSha256 &&
    job.ownership_generation === context.ownershipGeneration &&
    job.ref === desired.ref &&
    job.observation_sequence === desired.desired_observation_sequence &&
    job.reconcile_epoch === desired.reconcile_epoch &&
    job.target_sha === desired.desired_sha
  )
}

function validateTipSha(tipSha: string): void {
  if (typeof tipSha !== 'string' || !/^[0-9a-f]{40}$/.test(tipSha)) {
    throw new ProductDeployRepositoryError('INVALID_GIT_TIP')
  }
}

function validateExpectedSequence(sequence: number | null): void {
  if (sequence !== null && (!Number.isSafeInteger(sequence) || sequence < 1)) {
    throw new ProductDeployRepositoryError('INVALID_OBSERVATION_SEQUENCE')
  }
}

function createJobId(): string {
  return `pjob_${randomUUID()}`
}
