import { randomBytes, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ProductClaimToken } from '../../../../docs/contracts/product-auto-deploy'
import { PRODUCT_LEASE_TTL_MS } from '../../../../docs/contracts/product-auto-deploy'
import type {
  H2BuildEvidence,
  H2Context,
  H2MetricBoundary,
  H2SealedReceipt,
  H2CommitAttestation,
  H2SettlementAck,
  H2TerminalRecord,
  H2TerminalReceipt
} from '../../../../docs/contracts/product-h2-runtime'
import {
  canonicalH2Json,
  hashH2,
  signH2,
  verifyH2,
  h2ContextSchema,
  h2EnvelopeSchema,
  h2AckSchema,
  h2BoundarySchema
} from '../controlPlane/productH2Proof'
import { ProductDeployRepository } from './productDeployRepository'

type ExecutionRow = {
  context_json: string
  context_sha256: string
  activation_id: number | null
  previous_activation_id: number | null
  boundary_json: string | null
}
type TerminalRow = {
  commit_id: string
  envelope_json: string
  receipt_sha256: string
  context_sha256: string
  committed_at: string
  settled_at: string | null
  leases_released_at: string | null
  settlement_json: string | null
}
type CanonicalRow = {
  app_id: number
  name: string
  framework: string
  needs_db: number
  host_port: number
  container_port: number
  healthcheck_path: string
  current_deployment_id: number | null
  image_tag: string
  git_commit_sha: string
  deployment_status: string
  previous_image_tag: string | null
  previous_sha: string | null
}

export class ProductRuntimeRepositoryError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'ProductRuntimeRepositoryError'
  }
}

/** Chỉ Product nội bộ: barrier C0, terminal T1, signer và lease release T2. */
export class ProductRuntimeRepository {
  private readonly secret: Buffer
  private readonly clock: () => number
  constructor(
    private readonly database: Database.Database,
    options: { secret: Buffer; clock?: () => number }
  ) {
    if (!Buffer.isBuffer(options.secret) || options.secret.length !== 32)
      throw new ProductRuntimeRepositoryError('H2_SECRET_INVALID')
    this.secret = Buffer.from(options.secret)
    this.clock = options.clock ?? Date.now
  }

  createContext(claim: ProductClaimToken, deploymentId: number, build: H2BuildEvidence): H2Context {
    return this.database
      .transaction(() => {
        const binding = ProductDeployRepository.withClockForTest(
          this.database,
          this.clock
        ).readGitDispatchTargetBinding(claim, deploymentId)
        if (binding.state !== 'ready') this.fail('H2_AUTHORITY_STALE')
        const row = this.canonical(claim.app_id, deploymentId)
        if (
          !row ||
          row.framework !== 'express' ||
          row.needs_db !== 0 ||
          row.deployment_status !== 'building' ||
          build.image_tag !== row.image_tag ||
          build.target_sha !== row.git_commit_sha ||
          (build.state === 'build_failed_definite' &&
            (!Number.isSafeInteger(build.exit_code) || build.exit_code === 0))
        )
          this.fail('H2_BUILD_INVALID')
        const existing = this.execution(claim.attempt_id)
        if (existing) {
          const context = this.parseContext(existing.context_json)
          if (
            canonicalH2Json(context.claim) !== canonicalH2Json(claim) ||
            context.build_state !== build.state ||
            context.source_sha !== build.target_sha ||
            context.candidate_image_tag !== build.image_tag ||
            context.candidate_image_id !==
              (build.state === 'build_succeeded' ? build.image_id : null)
          )
            this.fail('H2_CONTEXT_MISMATCH')
          this.assertLive(context)
          return context
        }
        const context = h2ContextSchema.parse({
          version: 1,
          execution_nonce: randomBytes(32).toString('hex'),
          claim,
          target: binding.binding,
          deployment_id: deploymentId,
          source_sha: build.target_sha,
          app_name: row.name,
          host_port: row.host_port,
          container_port: row.container_port,
          healthcheck_path: row.healthcheck_path,
          candidate_image_tag: row.image_tag,
          candidate_image_id: build.state === 'build_succeeded' ? build.image_id : null,
          build_state: build.state,
          previous:
            row.current_deployment_id === null
              ? null
              : {
                  deployment_id: row.current_deployment_id,
                  image_tag: row.previous_image_tag,
                  source_sha: row.previous_sha
                },
          activation_id: null,
          health_timeout_ms: 15_000,
          exposure_policy: 'not_checked'
        })
        const previous = this.database
          .prepare(
            "SELECT id,deployment_id FROM deployment_activation WHERE app_id=? AND state='active'"
          )
          .get(claim.app_id) as { id: number; deployment_id: number } | undefined
        if (previous && previous.deployment_id !== row.current_deployment_id)
          this.fail('H2_ACTIVATION_MISMATCH')
        this.database
          .prepare(
            `INSERT INTO product_runtime_execution
        (attempt_id,deployment_id,context_json,context_sha256,previous_activation_id,created_at)
        VALUES (?,?,?,?,?,?)`
          )
          .run(
            claim.attempt_id,
            deploymentId,
            canonicalH2Json(context),
            hashH2(context),
            previous?.id ?? null,
            this.now()
          )
        return context
      })
      .immediate()
  }

  beginActivationBarrier(input: H2Context): H2Context {
    const context = this.parseContext(input)
    return this.database
      .transaction(() => {
        this.assertLive(context)
        const execution = this.assertExecution(context)
        if (context.build_state !== 'build_succeeded') this.fail('H2_BARRIER_NOT_REQUIRED')
        if (execution.activation_id !== null) return context
        if (
          this.database
            .prepare("SELECT 1 FROM deployment_activation WHERE app_id=? AND state='prepared'")
            .get(context.claim.app_id)
        )
          this.fail('H2_ACTIVATION_BUSY')
        const activationId = Number(
          this.database
            .prepare(
              `INSERT INTO deployment_activation
        (app_id,deployment_id,stream_generation,start_offset,reason,state)
        VALUES (?,?,?,1,'deploy','prepared')`
            )
            .run(
              context.claim.app_id,
              context.deployment_id,
              `h2-pending:${context.claim.attempt_id}`
            ).lastInsertRowid
        )
        const updated = h2ContextSchema.parse({ ...context, activation_id: activationId })
        this.changes(
          this.database
            .prepare(
              `UPDATE product_runtime_execution SET activation_id=?,
        context_json=?,context_sha256=? WHERE attempt_id=? AND context_sha256=? AND activation_id IS NULL`
            )
            .run(
              activationId,
              canonicalH2Json(updated),
              hashH2(updated),
              context.claim.attempt_id,
              hashH2(context)
            ).changes
        )
        this.changes(
          this.database
            .prepare(
              "UPDATE deployment SET status='deploying' WHERE id=? AND app_id=? AND status='building'"
            )
            .run(context.deployment_id, context.claim.app_id).changes
        )
        this.history(updated, 'runtime_activation_prepared', { activation_id: activationId })
        return updated
      })
      .immediate()
  }

  bindActivationBoundary(input: H2Context, value: H2MetricBoundary): void {
    const context = this.parseContext(input),
      boundary = h2BoundarySchema.parse(value)
    this.database
      .transaction(() => {
        this.assertLive(context)
        const execution = this.assertExecution(context)
        if (context.activation_id === null || execution.activation_id !== context.activation_id)
          this.fail('H2_BARRIER_MISSING')
        if (execution.boundary_json !== null) {
          if (execution.boundary_json !== canonicalH2Json(boundary))
            this.fail('H2_BOUNDARY_MISMATCH')
          return
        }
        this.changes(
          this.database
            .prepare(
              `UPDATE deployment_activation SET stream_generation=?,start_offset=?
        WHERE id=? AND app_id=? AND deployment_id=? AND state='prepared'`
            )
            .run(
              boundary.generation,
              boundary.next_offset,
              context.activation_id,
              context.claim.app_id,
              context.deployment_id
            ).changes
        )
        this.changes(
          this.database
            .prepare(
              `UPDATE product_runtime_execution SET boundary_json=?
        WHERE attempt_id=? AND boundary_json IS NULL`
            )
            .run(canonicalH2Json(boundary), context.claim.attempt_id).changes
        )
      })
      .immediate()
  }

  finalize(value: H2SealedReceipt): H2TerminalRecord {
    const envelope = this.verifiedEnvelope(value),
      receipt = envelope.receipt,
      context = receipt.context
    return this.database
      .transaction(() => {
        const execution = this.assertExecution(context)
        const existing = this.terminal(context.claim.attempt_id)
        if (existing) {
          if (
            existing.receipt_sha256 !== envelope.receipt_sha256 ||
            existing.context_sha256 !== hashH2(context)
          )
            this.fail('H2_TERMINAL_CONFLICT')
          return this.record(existing)
        }
        this.assertLive(context)
        const now = this.now()
        if (
          Date.parse(receipt.sealed_at) > Date.parse(now) + 5_000 ||
          Date.parse(now) - Date.parse(receipt.sealed_at) > PRODUCT_LEASE_TTL_MS
        )
          this.fail('H2_RECEIPT_STALE')
        this.assertReceiptSemantics(receipt, execution)
        this.applyActivation(receipt, execution, now)
        const status = receipt.outcome === 'succeeded' ? 'running' : receipt.outcome
        this.changes(
          this.database
            .prepare(
              `UPDATE deployment SET status=?,failed_step=?,finished_at=?,
        exposure_status=? WHERE id=? AND app_id=? AND status=?`
            )
            .run(
              status,
              receipt.failed_step,
              now,
              receipt.exposure_status,
              context.deployment_id,
              context.claim.app_id,
              context.activation_id === null ? 'building' : 'deploying'
            ).changes
        )
        if (receipt.outcome === 'succeeded' && context.previous) {
          this.changes(
            this.database
              .prepare(
                "UPDATE deployment SET status='stopped' WHERE id=? AND app_id=? AND status='running'"
              )
              .run(context.previous.deployment_id, context.claim.app_id).changes
          )
        }
        const activeId =
          receipt.outcome === 'succeeded'
            ? context.deployment_id
            : (context.previous?.deployment_id ?? null)
        const boundary = receipt.boundary
        this.changes(
          this.database
            .prepare(
              `UPDATE app SET current_deployment_id=?,
        metrics_stream_generation=COALESCE(?,metrics_stream_generation),
        metrics_stream_device=COALESCE(?,metrics_stream_device),metrics_stream_inode=COALESCE(?,metrics_stream_inode),
        metrics_offset=COALESCE(?,metrics_offset) WHERE id=? AND current_deployment_id IS ?`
            )
            .run(
              activeId,
              boundary?.generation ?? null,
              boundary?.device ?? null,
              boundary?.inode ?? null,
              boundary?.next_offset ?? null,
              context.claim.app_id,
              context.previous?.deployment_id ?? null
            ).changes
        )
        this.changes(
          this.database
            .prepare(
              `UPDATE product_deploy_attempt SET state=?,remote_outcome='applied',
        failed_step=?,finished_at=? WHERE attempt_id=? AND job_id=? AND deployment_id=?
        AND state='deploying' AND remote_outcome='unknown'`
            )
            .run(
              receipt.outcome,
              receipt.failed_step,
              now,
              context.claim.attempt_id,
              context.claim.job_id,
              context.deployment_id
            ).changes
        )
        this.changes(
          this.database
            .prepare(
              `UPDATE product_deploy_job SET state=?,updated_at=?,finished_at=?
        WHERE job_id=? AND state='deploying' AND attempt_count=?`
            )
            .run(receipt.outcome, now, now, context.claim.job_id, context.claim.attempt_number)
            .changes
        )
        this.updateDesired(receipt, now)
        const commitId = randomUUID()
        this.database
          .prepare(
            `INSERT INTO product_runtime_terminal
        (attempt_id,commit_id,receipt_sha256,context_sha256,envelope_json,committed_at)
        VALUES (?,?,?,?,?,?)`
          )
          .run(
            context.claim.attempt_id,
            commitId,
            envelope.receipt_sha256,
            hashH2(context),
            canonicalH2Json(envelope),
            now
          )
        this.history(context, 'runtime_terminal_committed', {
          commit_id: commitId,
          receipt_sha256: envelope.receipt_sha256,
          outcome: receipt.outcome
        })
        return this.record(this.terminal(context.claim.attempt_id)!)
      })
      .immediate()
  }

  commitAttestation(attemptId: string): H2CommitAttestation {
    if (this.database.inTransaction) this.fail('H2_UNCOMMITTED_TRANSACTION')
    const row = this.terminal(attemptId)
    if (!row) this.fail('H2_TERMINAL_MISSING')
    const record = this.record(row),
      receipt = record.envelope.receipt,
      context = receipt.context
    if (this.readSettlementAuthority(context) !== 'ready')
      this.fail('H2_SETTLEMENT_AUTHORITY_STALE')
    const payload: H2CommitAttestation['payload'] = {
      version: 1,
      kind: 'product-h2-commit',
      commit_id: row.commit_id,
      receipt_sha256: row.receipt_sha256,
      context_sha256: row.context_sha256,
      execution_nonce: context.execution_nonce,
      attempt_id: attemptId,
      deployment_id: context.deployment_id,
      outcome: receipt.outcome
    }
    return { payload, signature: signH2('commit', payload, this.secret) }
  }

  readSettlementAuthority(input: H2Context): 'ready' | 'rejected' {
    try {
      const context = this.parseContext(input),
        row = this.terminal(context.claim.attempt_id)
      if (!row || row.context_sha256 !== hashH2(context)) return 'rejected'
      const receipt = this.record(row).envelope.receipt
      const state = this.database
        .prepare(
          `SELECT c.status AS controller_status,o.mode,
        o.controller_id,o.ownership_generation,o.source_generation,o.source_config_sha256,
        a.name AS app_name,a.framework,a.needs_db,a.host_port,a.container_port,a.healthcheck_path,
        a.source_type,a.git_repo_url,a.git_ref,a.git_root,a.vps_id,a.current_deployment_id,
        v.host,v.port,v.host_fingerprint,v.username,v.auth_type,v.ssh_security_revision,v.archived_at,
        s.repository_url,s.production_ref,s.repository_root,
        j.state AS job_state,j.app_id,j.controller_id AS job_controller,j.ownership_generation AS job_owner,
        j.source_generation AS job_source,j.source_config_sha256 AS job_config,j.target_sha,j.attempt_count,
        p.state AS attempt_state,p.remote_outcome,p.deployment_id,p.attempt_number,
        p.lease_id,p.fencing_token,p.build_slot_lease_id,p.build_slot_fence,
        d.image_tag AS deployment_image_tag,d.git_commit_sha AS deployment_sha,d.status AS deployment_status,
        l.controller_id AS lease_controller,l.app_id AS lease_app,l.ownership_generation AS lease_owner,
        l.job_id AS lease_job,l.released_at AS app_released,
        w.controller_id AS slot_controller,w.slot_name,w.job_id AS slot_job,w.released_at AS slot_released
        FROM product_deploy_attempt p JOIN product_deploy_job j ON j.job_id=p.job_id
        JOIN product_controller c ON c.controller_id=j.controller_id
        JOIN product_app_control o ON o.app_id=j.app_id JOIN app a ON a.id=j.app_id
        JOIN deployment d ON d.id=p.deployment_id AND d.app_id=a.id
        JOIN vps v ON v.id=a.vps_id JOIN product_source_config s ON s.app_id=o.app_id
          AND s.source_generation=o.source_generation AND s.config_sha256=o.source_config_sha256
        JOIN product_app_lease l ON l.lease_id=p.lease_id AND l.fence=p.fencing_token AND l.job_id=j.job_id
        JOIN product_worker_lease w ON w.lease_id=p.build_slot_lease_id AND w.fence=p.build_slot_fence AND w.job_id=j.job_id
        WHERE p.attempt_id=? AND j.job_id=?`
        )
        .get(context.claim.attempt_id, context.claim.job_id) as Record<string, unknown> | undefined
      if (!state) return 'rejected'
      const expected: Record<string, unknown> = {
        controller_status: 'active',
        mode: 'product',
        controller_id: context.claim.controller_id,
        ownership_generation: context.claim.ownership_generation,
        source_generation: context.claim.source_generation,
        source_config_sha256: context.claim.source_config_sha256,
        app_id: context.claim.app_id,
        app_name: context.app_name,
        framework: 'express',
        needs_db: 0,
        host_port: context.host_port,
        container_port: context.container_port,
        healthcheck_path: context.healthcheck_path,
        deployment_image_tag: context.candidate_image_tag,
        deployment_sha: context.source_sha,
        deployment_status: receipt.outcome === 'succeeded' ? 'running' : receipt.outcome,
        job_controller: context.claim.controller_id,
        job_owner: context.claim.ownership_generation,
        job_source: context.claim.source_generation,
        job_config: context.claim.source_config_sha256,
        target_sha: context.source_sha,
        attempt_count: context.claim.attempt_number,
        attempt_number: context.claim.attempt_number,
        job_state: receipt.outcome,
        attempt_state: receipt.outcome,
        remote_outcome: 'applied',
        deployment_id: context.deployment_id,
        lease_id: context.claim.app_lease_id,
        fencing_token: context.claim.app_fence,
        build_slot_lease_id: context.claim.build_slot_lease_id,
        build_slot_fence: context.claim.build_slot_fence,
        lease_controller: context.claim.controller_id,
        lease_app: context.claim.app_id,
        lease_owner: context.claim.ownership_generation,
        lease_job: context.claim.job_id,
        slot_controller: context.claim.controller_id,
        slot_name: 'build',
        slot_job: context.claim.job_id,
        source_type: 'git',
        vps_id: context.target.vps_id,
        host: context.target.host,
        port: context.target.port,
        host_fingerprint: context.target.host_fingerprint,
        username: context.target.username,
        auth_type: context.target.auth_type,
        ssh_security_revision: context.target.ssh_security_revision,
        archived_at: null,
        current_deployment_id:
          receipt.outcome === 'succeeded'
            ? context.deployment_id
            : (context.previous?.deployment_id ?? null)
      }
      if (
        Object.entries(expected).some(([key, expectedValue]) => state[key] !== expectedValue) ||
        state.git_repo_url !== state.repository_url ||
        state.git_ref !== state.production_ref ||
        state.git_root !== state.repository_root ||
        (row.leases_released_at === null &&
          (state.app_released !== null || state.slot_released !== null)) ||
        (row.leases_released_at !== null &&
          (state.app_released !== row.leases_released_at ||
            state.slot_released !== row.leases_released_at))
      )
        return 'rejected'
      if (context.previous) {
        const prev = this.database
          .prepare(
            'SELECT status, image_tag, git_commit_sha FROM deployment WHERE id=? AND app_id=?'
          )
          .get(context.previous.deployment_id, context.claim.app_id) as
          { status: string; image_tag: string; git_commit_sha: string } | undefined
        if (!prev) return 'rejected'
        const expectedPrevStatus = receipt.outcome === 'succeeded' ? 'stopped' : 'running'
        if (
          prev.status !== expectedPrevStatus ||
          prev.image_tag !== context.previous.image_tag ||
          prev.git_commit_sha !== context.previous.source_sha
        ) {
          return 'rejected'
        }
      }
      return 'ready'
    } catch {
      return 'rejected'
    }
  }

  completeSettlement(input: H2Context, value: H2SettlementAck): void {
    const context = this.parseContext(input),
      ack = h2AckSchema.parse(value)
    if (!verifyH2('settlement', ack.payload, ack.signature, this.secret))
      this.fail('H2_ACK_INVALID')
    this.database
      .transaction(() => {
        const row = this.terminal(context.claim.attempt_id)
        if (!row || row.context_sha256 !== hashH2(context)) this.fail('H2_TERMINAL_MISSING')
        const expected = {
          version: 1,
          kind: 'product-h2-settlement',
          commit_id: row.commit_id,
          receipt_sha256: row.receipt_sha256,
          context_sha256: row.context_sha256,
          execution_nonce: context.execution_nonce,
          attempt_id: context.claim.attempt_id,
          deployment_id: context.deployment_id,
          settled_at: ack.payload.settled_at
        }
        if (canonicalH2Json(ack.payload) !== canonicalH2Json(expected)) this.fail('H2_ACK_MISMATCH')
        if (row.leases_released_at !== null) {
          if (row.settlement_json !== canonicalH2Json(ack)) this.fail('H2_ACK_MISMATCH')
          return
        }
        if (this.readSettlementAuthority(context) !== 'ready')
          this.fail('H2_SETTLEMENT_AUTHORITY_STALE')
        const now = this.now()
        if (
          Date.parse(ack.payload.settled_at) < Date.parse(row.committed_at) - 5_000 ||
          Date.parse(ack.payload.settled_at) > Date.parse(now) + 5_000
        )
          this.fail('H2_ACK_TIME_INVALID')
        this.changes(
          this.database
            .prepare(
              `UPDATE product_app_lease SET released_at=?
        WHERE app_id=? AND lease_id=? AND controller_id=? AND ownership_generation=? AND fence=? AND job_id=? AND released_at IS NULL`
            )
            .run(
              now,
              context.claim.app_id,
              context.claim.app_lease_id,
              context.claim.controller_id,
              context.claim.ownership_generation,
              context.claim.app_fence,
              context.claim.job_id
            ).changes
        )
        this.changes(
          this.database
            .prepare(
              `UPDATE product_worker_lease SET released_at=?
        WHERE slot_name='build' AND lease_id=? AND controller_id=? AND fence=? AND job_id=? AND released_at IS NULL`
            )
            .run(
              now,
              context.claim.build_slot_lease_id,
              context.claim.controller_id,
              context.claim.build_slot_fence,
              context.claim.job_id
            ).changes
        )
        this.changes(
          this.database
            .prepare(
              `UPDATE product_runtime_terminal SET settled_at=?,leases_released_at=?,settlement_json=?
        WHERE attempt_id=? AND leases_released_at IS NULL`
            )
            .run(ack.payload.settled_at, now, canonicalH2Json(ack), context.claim.attempt_id)
            .changes
        )
        this.history(context, 'runtime_leases_released', { commit_id: row.commit_id })
      })
      .immediate()
  }

  getTerminal(attemptId: string): H2TerminalRecord | null {
    const row = this.terminal(attemptId)
    return row ? this.record(row) : null
  }

  private assertReceiptSemantics(receipt: H2TerminalReceipt, execution: ExecutionRow): void {
    const context = receipt.context
    if (
      context.previous &&
      (!receipt.previous_runtime ||
        receipt.previous_runtime.deployment_id !== context.previous.deployment_id ||
        receipt.previous_runtime.image_tag !== context.previous.image_tag ||
        receipt.previous_runtime.source_sha !== context.previous.source_sha)
    )
      this.fail('H2_PREVIOUS_MISMATCH')
    if (receipt.outcome === 'rolled_back') {
      if (
        receipt.active_runtime?.image_id !== receipt.previous_runtime?.image_id ||
        receipt.active_runtime?.config_sha256 !== receipt.previous_runtime?.config_sha256 ||
        receipt.active_runtime?.collector_container_id !==
          receipt.previous_runtime?.collector_container_id
      )
        this.fail('H2_RESTORE_MISMATCH')
    }
    if (context.activation_id === null) {
      if (receipt.failed_step !== 'BUILD' || receipt.boundary !== null)
        this.fail('H2_BARRIER_MISSING')
      return
    }
    const boundary =
      execution.boundary_json === null
        ? null
        : h2BoundarySchema.parse(JSON.parse(execution.boundary_json))
    if (
      !boundary ||
      !receipt.boundary ||
      boundary.generation !== receipt.boundary.generation ||
      boundary.device !== receipt.boundary.device ||
      boundary.inode !== receipt.boundary.inode ||
      (receipt.outcome === 'rolled_back'
        ? receipt.boundary.next_offset < boundary.next_offset
        : receipt.boundary.next_offset !== boundary.next_offset)
    )
      this.fail('H2_BOUNDARY_MISMATCH')
    const prepared = this.database
      .prepare(
        `SELECT id FROM deployment_activation
      WHERE id=? AND app_id=? AND deployment_id=? AND state='prepared' AND stream_generation=? AND start_offset=?`
      )
      .get(
        context.activation_id,
        context.claim.app_id,
        context.deployment_id,
        boundary.generation,
        boundary.next_offset
      )
    if (!prepared) this.fail('H2_ACTIVATION_MISMATCH')
    const active = this.database
      .prepare("SELECT id FROM deployment_activation WHERE app_id=? AND state='active'")
      .get(context.claim.app_id) as { id: number } | undefined
    if ((active?.id ?? null) !== execution.previous_activation_id)
      this.fail('H2_ACTIVATION_MISMATCH')
  }

  private applyActivation(receipt: H2TerminalReceipt, execution: ExecutionRow, now: string): void {
    const context = receipt.context
    if (context.activation_id === null) return
    const boundary = h2BoundarySchema.parse(JSON.parse(execution.boundary_json!))
    if (execution.previous_activation_id !== null) {
      this.changes(
        this.database
          .prepare(
            `UPDATE deployment_activation SET state='closed',end_offset=?,closed_at=?
        WHERE id=? AND app_id=? AND state='active' AND start_offset<=?`
          )
          .run(
            boundary.next_offset,
            now,
            execution.previous_activation_id,
            context.claim.app_id,
            boundary.next_offset
          ).changes
      )
    }
    if (receipt.outcome === 'succeeded') {
      this.changes(
        this.database
          .prepare(
            "UPDATE deployment_activation SET state='active',activated_at=? WHERE id=? AND state='prepared'"
          )
          .run(now, context.activation_id).changes
      )
    } else {
      this.changes(
        this.database
          .prepare(
            "UPDATE deployment_activation SET state='aborted' WHERE id=? AND state='prepared'"
          )
          .run(context.activation_id).changes
      )
      if (context.previous) {
        this.database
          .prepare(
            `INSERT INTO deployment_activation
          (app_id,deployment_id,stream_generation,start_offset,reason,state,activated_at)
          VALUES (?,?,?,?,'deploy','active',?)`
          )
          .run(
            context.claim.app_id,
            context.previous.deployment_id,
            receipt.boundary!.generation,
            receipt.boundary!.next_offset,
            now
          )
      }
    }
  }

  private assertLive(context: H2Context): void {
    const result = ProductDeployRepository.withClockForTest(
      this.database,
      this.clock
    ).readGitDispatchTargetBinding(context.claim, context.deployment_id)
    const canonical = this.canonical(context.claim.app_id, context.deployment_id)
    if (
      result.state !== 'ready' ||
      canonicalH2Json(result.binding) !== canonicalH2Json(context.target) ||
      !canonical ||
      canonical.name !== context.app_name ||
      canonical.host_port !== context.host_port ||
      canonical.container_port !== context.container_port ||
      canonical.healthcheck_path !== context.healthcheck_path ||
      canonical.git_commit_sha !== context.source_sha ||
      canonical.image_tag !== context.candidate_image_tag ||
      canonical.current_deployment_id !== (context.previous?.deployment_id ?? null) ||
      (context.previous &&
        (canonical.previous_image_tag !== context.previous.image_tag ||
          canonical.previous_sha !== context.previous.source_sha))
    )
      this.fail('H2_AUTHORITY_STALE')
  }
  private canonical(appId: number, deploymentId: number): CanonicalRow | undefined {
    return this.database
      .prepare(
        `SELECT a.id AS app_id,a.name,a.framework,a.needs_db,a.host_port,a.container_port,
      a.healthcheck_path,a.current_deployment_id,d.image_tag,d.git_commit_sha,d.status AS deployment_status,
      old.image_tag AS previous_image_tag,old.git_commit_sha AS previous_sha
      FROM app a JOIN deployment d ON d.app_id=a.id AND d.id=?
      LEFT JOIN deployment old ON old.id=a.current_deployment_id AND old.app_id=a.id WHERE a.id=?`
      )
      .get(deploymentId, appId) as CanonicalRow | undefined
  }
  private assertExecution(context: H2Context): ExecutionRow {
    const execution = this.execution(context.claim.attempt_id)
    if (!execution || execution.context_sha256 !== hashH2(context)) this.fail('H2_CONTEXT_MISMATCH')
    return execution
  }
  private execution(attemptId: string): ExecutionRow | undefined {
    return this.database
      .prepare('SELECT * FROM product_runtime_execution WHERE attempt_id=?')
      .get(attemptId) as ExecutionRow | undefined
  }
  private terminal(attemptId: string): TerminalRow | undefined {
    return this.database
      .prepare('SELECT * FROM product_runtime_terminal WHERE attempt_id=?')
      .get(attemptId) as TerminalRow | undefined
  }
  private record(row: TerminalRow): H2TerminalRecord {
    const envelope = this.verifiedEnvelope(JSON.parse(row.envelope_json))
    if (
      row.receipt_sha256 !== envelope.receipt_sha256 ||
      row.context_sha256 !== hashH2(envelope.receipt.context)
    )
      this.fail('H2_TERMINAL_INVALID')
    return {
      commit_id: row.commit_id,
      envelope,
      committed_at: row.committed_at,
      settled_at: row.settled_at,
      leases_released_at: row.leases_released_at
    }
  }
  private verifiedEnvelope(value: unknown): H2SealedReceipt {
    const result = h2EnvelopeSchema.safeParse(value)
    if (
      !result.success ||
      result.data.receipt_sha256 !== hashH2(result.data.receipt) ||
      !verifyH2('receipt', result.data.receipt, result.data.signature, this.secret)
    )
      this.fail('H2_RECEIPT_INVALID')
    return result.data
  }
  private parseContext(value: unknown): H2Context {
    const result = h2ContextSchema.safeParse(typeof value === 'string' ? JSON.parse(value) : value)
    if (!result.success) this.fail('H2_CONTEXT_INVALID')
    return result.data
  }
  private updateDesired(receipt: H2TerminalReceipt, now: string): void {
    const context = receipt.context
    const job = this.database
      .prepare(
        'SELECT ref,observation_sequence,reconcile_epoch FROM product_deploy_job WHERE job_id=?'
      )
      .get(context.claim.job_id) as {
      ref: string
      observation_sequence: number | null
      reconcile_epoch: number | null
    }
    const desired = this.database
      .prepare(
        `SELECT desired_observation_sequence,desired_sha,reconcile_epoch,auto_paused,pause_reason
      FROM product_desired_branch WHERE app_id=? AND source_generation=? AND ref=?`
      )
      .get(context.claim.app_id, context.claim.source_generation, job.ref) as
      | {
          desired_observation_sequence: number
          desired_sha: string
          reconcile_epoch: number
          auto_paused: number
          pause_reason: string | null
        }
      | undefined
    if (!desired) return
    const owner = this.database
      .prepare('SELECT auto_deploy_paused,pause_reason FROM product_app_control WHERE app_id=?')
      .get(context.claim.app_id) as { auto_deploy_paused: number; pause_reason: string | null }
    const paused = owner.auto_deploy_paused === 1 || desired.auto_paused === 1
    const exact =
      desired.desired_sha === context.source_sha &&
      desired.desired_observation_sequence === job.observation_sequence &&
      desired.reconcile_epoch === job.reconcile_epoch
    this.changes(
      this.database
        .prepare(
          `UPDATE product_desired_branch SET reconciliation_state=?,
      reconciliation_job_id=?,reconciled_observation_sequence=?,reconciled_epoch=?,
      auto_paused=?,pause_reason=?,updated_at=? WHERE app_id=? AND source_generation=? AND ref=?`
        )
        .run(
          paused
            ? 'paused'
            : exact
              ? receipt.outcome === 'succeeded'
                ? 'satisfied'
                : 'failed'
              : 'pending',
          exact ? context.claim.job_id : null,
          exact && !paused ? job.observation_sequence : null,
          exact && !paused ? job.reconcile_epoch : null,
          paused ? 1 : 0,
          paused ? (owner.pause_reason ?? desired.pause_reason ?? 'operator') : null,
          now,
          context.claim.app_id,
          context.claim.source_generation,
          job.ref
        ).changes
    )
  }
  private history(context: H2Context, kind: string, summary: Record<string, unknown>): void {
    this.database
      .prepare(
        `INSERT INTO product_history_event
      (controller_id,app_id,job_id,attempt_id,kind,created_at,safe_summary_json) VALUES (?,?,?,?,?,?,?)`
      )
      .run(
        context.claim.controller_id,
        context.claim.app_id,
        context.claim.job_id,
        context.claim.attempt_id,
        kind,
        this.now(),
        canonicalH2Json(summary)
      )
  }
  private changes(count: number): void {
    if (count !== 1) this.fail('H2_CAS_FAILED')
  }
  private now(): string {
    return new Date(this.clock()).toISOString()
  }
  private fail(code: string): never {
    throw new ProductRuntimeRepositoryError(code)
  }
}
