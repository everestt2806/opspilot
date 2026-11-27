import type Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type {
  ProductManualRedeployAccepted,
  ProductAutoDeployPolicyResult,
  ProductControllerRequestLookup,
  ProductControllerRequestStatus,
  ProductApiScope
} from '../../../../docs/contracts/product-controller-api'
import { ProductDeployRepository } from '../db/productDeployRepository'
import { ControllerClientAuth, ControllerClientAuthError } from './controllerClientAuth'
import { canonicalH2Json } from './productH2Proof'

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const keySchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase())
const generations = {
  expected_ownership_generation: positive,
  expected_source_generation: positive
}
const redeploySchema = z.strictObject({
  ...generations,
  require_first_deployment: z.literal(true).optional(),
  target: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('current_desired') }),
    z.strictObject({ kind: z.literal('specific_sha'), sha: z.string().regex(/^[0-9a-f]{40}$/) })
  ])
})
const policySchema = z.strictObject({
  ...generations,
  action: z.enum(['pause', 'resume']),
  reason: z
    .string()
    .refine(
      (value) =>
        Buffer.byteLength(value) <= 200 &&
        [...value].every(
          (character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127
        )
    )
    .optional()
})
type Source = {
  app_id: number
  ownership_generation: number
  source_generation: number
  source_config_sha256: string
  auto_deploy_paused: number
  pause_policy_provenance: string
  repository_url: string
  production_ref: string
  repository_root: string
  source_type: string
  git_repo_url: string
  git_ref: string
  git_root: string
}
type Action = ProductControllerRequestStatus['action']
type RequestRow = {
  controller_id: string
  client_id: string
  request_key: string
  app_id: number
  action: Action
  ownership_generation: number
  source_generation: number
  body_sha256: string
  job_id: string | null
  result_json: string
  created_at: string
}
type Result = ProductManualRedeployAccepted | ProductAutoDeployPolicyResult

/** Transaction này chỉ ghi intent/queue/policy, tuyệt đối không chạy Git/SSH/Docker. */
export class ControllerCommands {
  private readonly auth: ControllerClientAuth
  constructor(
    private readonly db: Database.Database,
    private readonly controllerId: string,
    private readonly ready: () => boolean = () => false
  ) {
    this.auth = new ControllerClientAuth(db, controllerId, `unix:${process.getuid?.() ?? 0}`)
  }

  redeploy(
    authorization: unknown,
    key: unknown,
    appId: number,
    input: unknown
  ): ProductManualRedeployAccepted {
    const parsed = redeploySchema.safeParse(input)
    if (
      !parsed.success ||
      (parsed.data.require_first_deployment && parsed.data.target.kind !== 'specific_sha')
    )
      throw new ControllerClientAuthError('REQUEST_INVALID')
    return this.write(
      authorization,
      key,
      appId,
      'manual_redeploy',
      parsed.data,
      'deploy:manual',
      (source, now) => {
        this.assertUnblocked(appId)
        if (
          parsed.data.require_first_deployment &&
          (this.db
            .prepare('SELECT 1 FROM app WHERE id=? AND current_deployment_id IS NOT NULL')
            .get(appId) ||
            this.db
              .prepare(
                "SELECT 1 FROM product_deploy_job WHERE app_id=? AND state NOT IN ('succeeded','failed','rolled_back','superseded','cancelled') LIMIT 1"
              )
              .get(appId))
        )
          throw new ControllerClientAuthError('CAPABILITY_BLOCKED')
        const sha =
          parsed.data.target.kind === 'current_desired'
            ? this.desired(source)
            : parsed.data.target.sha
        if (!this.knownSha(source, sha))
          throw new ControllerClientAuthError('TARGET_SHA_UNAVAILABLE')
        this.pause(source, 'manual_action', now)
        const jobId = `pjob_${randomUUID()}`
        this.db
          .prepare(
            `INSERT INTO product_deploy_job(job_id,controller_id,app_id,ownership_generation,source_generation,source_config_sha256,
        trigger,idempotency_key,ref,target_sha,state,attempt_count,max_attempts,available_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,'manual_redeploy',?, ?,?,'queued',0,3,?,?,?)`
          )
          .run(
            jobId,
            this.controllerId,
            appId,
            source.ownership_generation,
            source.source_generation,
            source.source_config_sha256,
            `api:${randomUUID()}`,
            source.production_ref,
            sha,
            now,
            now,
            now
          )
        this.audit(source, 'api_manual_redeploy', now, { job_id: jobId, target_sha: sha })
        return {
          job_id: jobId,
          app_id: appId,
          target_sha: sha,
          state: 'queued',
          auto_deploy_paused: true,
          retry_with_same_idempotency_key: true
        }
      }
    ) as ProductManualRedeployAccepted
  }

  policy(
    authorization: unknown,
    key: unknown,
    appId: number,
    input: unknown
  ): ProductAutoDeployPolicyResult {
    const parsed = policySchema.safeParse(input)
    if (!parsed.success) throw new ControllerClientAuthError('REQUEST_INVALID')
    const action = parsed.data.action === 'pause' ? 'pause_auto_deploy' : 'resume_auto_deploy'
    return this.write(
      authorization,
      key,
      appId,
      action,
      parsed.data,
      'policy:write',
      (source, now) => {
        const pause = parsed.data.action === 'pause'
        if (!pause) {
          this.assertUnblocked(appId)
          if (
            this.db
              .prepare(
                `SELECT 1 FROM product_deploy_job WHERE app_id=? AND trigger<>'branch_poll'
          AND state IN ('queued','retry_wait','claimed','deploying','uncertain') LIMIT 1`
              )
              .get(appId)
          )
            throw new ControllerClientAuthError('CAPABILITY_BLOCKED')
        }
        const changed =
          source.auto_deploy_paused !== (pause ? 1 : 0) ||
          source.pause_policy_provenance !== 'explicit'
        if (pause) this.pause(source, 'operator', now)
        else
          this.db
            .prepare(
              `UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL,pause_policy_provenance='explicit',changed_at=? WHERE app_id=?`
            )
            .run(now, appId)
        const reconciled = new ProductDeployRepository(this.db).reconcileDesired(
          this.reconcileIdentity(source)
        )
        this.audit(source, `api_${action}`, now, { changed })
        return {
          app_id: appId,
          result: changed ? 'updated' : 'already_in_state',
          auto_deploy_paused: pause,
          pause_policy_provenance: 'explicit',
          reconciliation_state: pause ? 'paused' : reconciled.state,
          updated_at: now
        }
      },
      parsed.data.action === 'pause'
    ) as ProductAutoDeployPolicyResult
  }

  lookup(authorization: unknown, key: unknown): ProductControllerRequestLookup {
    const parsed = keySchema.safeParse(key)
    if (!parsed.success) throw new ControllerClientAuthError('REQUEST_INVALID')
    return this.db.transaction(() => {
      const client = this.auth.authenticate(authorization, 'read')
      const row = this.request(client.client_id, parsed.data)
      if (!row) return { found: false } as const
      if (
        !this.db
          .prepare(
            `SELECT 1 FROM product_app_control c JOIN app a ON a.id=c.app_id
        JOIN vps v ON v.id=a.vps_id AND v.archived_at IS NULL
        WHERE c.app_id=? AND c.controller_id=? AND c.mode='product'`
          )
          .get(row.app_id, this.controllerId)
      )
        throw new ControllerClientAuthError('APP_NOT_FOUND')
      const job = row.job_id
        ? (this.db
            .prepare(
              'SELECT state,safe_error_code,updated_at FROM product_deploy_job WHERE controller_id=? AND app_id=? AND job_id=?'
            )
            .get(this.controllerId, row.app_id, row.job_id) as
            { state: string; safe_error_code: string | null; updated_at: string } | undefined)
        : undefined
      let state: ProductControllerRequestStatus['state'] = 'completed',
        reason: string | null = null
      if (row.job_id) {
        if (!job) {
          state = 'blocked'
          reason = 'REQUEST_JOB_MISSING'
        } else if (job.state === 'uncertain') state = 'uncertain'
        else if (['queued', 'claimed', 'deploying', 'retry_wait'].includes(job.state))
          state = 'accepted'
        reason =
          job?.safe_error_code && /^[A-Z][A-Z0-9_]{1,80}$/.test(job.safe_error_code)
            ? job.safe_error_code
            : reason
      }
      return {
        found: true,
        status: {
          request_key: row.request_key,
          action: row.action,
          app_id: row.app_id,
          ownership_generation: row.ownership_generation,
          source_generation: row.source_generation,
          state,
          job_id: row.job_id,
          reason_code: reason,
          updated_at: job?.updated_at ?? row.created_at
        }
      } as const
    })()
  }

  private write(
    authorization: unknown,
    key: unknown,
    appId: number,
    action: Action,
    body: { expected_ownership_generation: number; expected_source_generation: number },
    scope: ProductApiScope,
    operation: (source: Source, now: string) => Result,
    allowDegraded = false
  ): Result {
    const parsedKey = keySchema.safeParse(key)
    if (!parsedKey.success || !Number.isSafeInteger(appId) || appId < 1 || this.db.inTransaction)
      throw new ControllerClientAuthError('REQUEST_INVALID')
    const hash = createHash('sha256').update(canonicalH2Json(body)).digest('hex')
    return this.db
      .transaction(() => {
        const client = this.auth.authenticate(authorization, scope),
          source = this.source(appId)
        this.checkGenerations(
          source,
          body.expected_ownership_generation,
          body.expected_source_generation
        )
        const existing = this.request(client.client_id, parsedKey.data)
        if (existing) {
          if (
            existing.app_id !== appId ||
            existing.action !== action ||
            existing.body_sha256 !== hash
          )
            throw new ControllerClientAuthError('IDEMPOTENCY_CONFLICT')
          return this.result(existing)
        }
        if (
          !this.db
            .prepare("SELECT 1 FROM product_controller WHERE controller_id=? AND status='active'")
            .get(this.controllerId) ||
          (!allowDegraded && !this.ready())
        )
          throw new ControllerClientAuthError('CAPABILITY_BLOCKED')
        const now = new Date().toISOString(),
          result = operation(source, now)
        this.db
          .prepare('INSERT INTO product_api_request VALUES(?,?,?,?,?,?,?,?,?,?,?)')
          .run(
            this.controllerId,
            client.client_id,
            parsedKey.data,
            appId,
            action,
            source.ownership_generation,
            source.source_generation,
            hash,
            'job_id' in result ? result.job_id : null,
            JSON.stringify(result),
            now
          )
        return result
      })
      .immediate()
  }
  private source(appId: number): Source {
    const source = this.db
      .prepare(
        `SELECT c.app_id,c.ownership_generation,c.source_generation,c.source_config_sha256,c.auto_deploy_paused,
      c.pause_policy_provenance,s.repository_url,s.production_ref,s.repository_root,a.source_type,a.git_repo_url,a.git_ref,a.git_root
      FROM product_app_control c JOIN app a ON a.id=c.app_id JOIN vps v ON v.id=a.vps_id AND v.archived_at IS NULL
      JOIN product_source_config s ON s.app_id=c.app_id AND s.source_generation=c.source_generation AND s.config_sha256=c.source_config_sha256
      WHERE c.app_id=? AND c.controller_id=? AND c.mode='product'`
      )
      .get(appId, this.controllerId) as Source | undefined
    if (!source) throw new ControllerClientAuthError('APP_NOT_FOUND')
    if (source.source_type !== 'git') throw new ControllerClientAuthError('UNSUPPORTED')
    if (
      source.git_repo_url !== source.repository_url ||
      source.git_ref !== source.production_ref ||
      source.git_root !== source.repository_root
    )
      throw new ControllerClientAuthError('SOURCE_GENERATION_STALE')
    return source
  }
  private checkGenerations(source: Source, owner: number, generation: number): void {
    if (source.ownership_generation !== owner)
      throw new ControllerClientAuthError('OWNERSHIP_STALE')
    if (source.source_generation !== generation)
      throw new ControllerClientAuthError('SOURCE_GENERATION_STALE')
  }
  private request(client: string, key: string): RequestRow | undefined {
    return this.db
      .prepare(
        'SELECT * FROM product_api_request WHERE controller_id=? AND client_id=? AND request_key=?'
      )
      .get(this.controllerId, client, key) as RequestRow | undefined
  }
  private result(row: RequestRow): Result {
    // Không parse body/note hoặc chấp nhận thêm field lạ từ result bị hỏng trong DB.
    let value: unknown
    try {
      value = JSON.parse(row.result_json)
    } catch {
      throw new ControllerClientAuthError('INTERNAL_ERROR')
    }
    const redeploy = z.strictObject({
      job_id: z.string(),
      app_id: positive,
      target_sha: z.string().regex(/^[0-9a-f]{40}$/),
      state: z.literal('queued'),
      auto_deploy_paused: z.literal(true),
      retry_with_same_idempotency_key: z.literal(true)
    })
    const policy = z.strictObject({
      app_id: positive,
      result: z.enum(['updated', 'already_in_state']),
      auto_deploy_paused: z.boolean(),
      pause_policy_provenance: z.literal('explicit'),
      reconciliation_state: z.enum([
        'pending',
        'queued',
        'in_progress',
        'satisfied',
        'paused',
        'failed',
        'uncertain'
      ]),
      updated_at: z.string().datetime()
    })
    const parsed = (row.action === 'manual_redeploy' ? redeploy : policy).safeParse(value)
    if (
      !parsed.success ||
      parsed.data.app_id !== row.app_id ||
      ('job_id' in parsed.data && parsed.data.job_id !== row.job_id)
    )
      throw new ControllerClientAuthError('INTERNAL_ERROR')
    return parsed.data
  }
  private desired(source: Source): string {
    const row = this.db
      .prepare(
        'SELECT desired_sha FROM product_desired_branch WHERE app_id=? AND source_generation=? AND ref=?'
      )
      .get(source.app_id, source.source_generation, source.production_ref) as
      { desired_sha: string } | undefined
    if (!row) throw new ControllerClientAuthError('NO_DESIRED_TARGET')
    return row.desired_sha
  }
  private knownSha(source: Source, sha: string): boolean {
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM product_branch_observation o JOIN product_source_config s ON s.app_id=o.app_id AND s.source_generation=o.source_generation
      WHERE o.app_id=? AND o.observed_sha=? AND s.repository_url=? AND s.repository_root=?
      UNION ALL SELECT 1 FROM deployment d JOIN product_deploy_attempt a ON a.deployment_id=d.id JOIN product_deploy_job j ON j.job_id=a.job_id
      JOIN product_source_config s ON s.app_id=j.app_id AND s.source_generation=j.source_generation
      WHERE j.controller_id=? AND d.app_id=? AND d.git_commit_sha=? AND s.repository_url=? AND s.repository_root=? LIMIT 1`
        )
        .get(
          source.app_id,
          sha,
          source.repository_url,
          source.repository_root,
          this.controllerId,
          source.app_id,
          sha,
          source.repository_url,
          source.repository_root
        )
    )
  }
  private assertUnblocked(appId: number): void {
    if (
      this.db
        .prepare(
          `SELECT 1 FROM product_deploy_job WHERE app_id=? AND state='uncertain'
      UNION ALL SELECT 1 FROM product_deploy_attempt a JOIN product_deploy_job j ON j.job_id=a.job_id WHERE j.app_id=? AND (a.remote_outcome='unknown' OR a.state='uncertain')
      UNION ALL SELECT 1 FROM product_runtime_terminal t JOIN product_deploy_attempt a ON a.attempt_id=t.attempt_id
        JOIN product_deploy_job j ON j.job_id=a.job_id WHERE j.app_id=? AND t.leases_released_at IS NULL LIMIT 1`
        )
        .get(appId, appId, appId)
    )
      throw new ControllerClientAuthError('RECONCILIATION_REQUIRED')
  }
  private pause(source: Source, reason: 'operator' | 'manual_action', now: string): void {
    this.db
      .prepare(
        `UPDATE product_app_control SET auto_deploy_paused=1,pause_reason=?,pause_policy_provenance='explicit',changed_at=? WHERE app_id=?`
      )
      .run(reason, now, source.app_id)
    new ProductDeployRepository(this.db).reconcileDesired(this.reconcileIdentity(source))
  }
  private reconcileIdentity(source: Source): {
    controllerId: string
    appId: number
    ownershipGeneration: number
    sourceGeneration: number
    configSha256: string
    ref: string
  } {
    return {
      controllerId: this.controllerId,
      appId: source.app_id,
      ownershipGeneration: source.ownership_generation,
      sourceGeneration: source.source_generation,
      configSha256: source.source_config_sha256,
      ref: source.production_ref
    }
  }
  private audit(source: Source, kind: string, now: string, summary: unknown): void {
    this.db
      .prepare(
        `INSERT INTO product_history_event(controller_id,app_id,kind,created_at,safe_summary_json) VALUES(?,?,?,?,?)`
      )
      .run(this.controllerId, source.app_id, kind, now, JSON.stringify(summary))
  }
}
