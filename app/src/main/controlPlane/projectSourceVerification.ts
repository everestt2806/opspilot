import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import type {
  ProductProjectSourceVerificationInput,
  ProductProjectSourceVerificationResult
} from '../../../../docs/contracts/product-project-source-verification'
import { ProductDeployRepository } from '../db/productDeployRepository'
import { canonicalizeGitHubUrl, createGitSnapshot, validateRef } from '../git/snapshot'
import { canonicalH2Json } from './productH2Proof'
import {
  validateProductSourceAndPlan,
  ProductSourceRenderError
} from './productPipelineSourceRender'
import { TargetEnrollmentRepository } from './targetEnrollmentRepository'
import { verifyControllerBundle } from './controllerBundle'

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
export const projectSourceVerificationInputSchema = z.strictObject({
  format: z.literal(1),
  controller_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/),
  app_id: positive,
  expected_ownership_generation: positive,
  expected_source_generation: positive,
  expected_source_config_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  expected_target_security_revision: positive,
  artifact: z.string().min(1).max(4096),
  manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/)
}) satisfies z.ZodType<ProductProjectSourceVerificationInput>

export const projectSourceVerificationResultSchema = z.strictObject({
  state: z.literal('source_verified'),
  controller_id: projectSourceVerificationInputSchema.shape.controller_id,
  app_id: positive,
  ownership_generation: positive,
  source_generation: positive,
  source_config_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  target_vps_id: positive,
  target_security_revision: positive,
  repository_url: z.string().min(1).max(2048),
  production_ref: z.string().min(1).max(255),
  repository_root: z.string().min(1).max(512),
  commit_sha: z.string().regex(/^[a-f0-9]{40}$/),
  observation_sequence: positive,
  framework: z.literal('express'),
  configured_container_port: positive.max(65535),
  detected_container_port: positive.max(65535),
  source_file_count: positive.max(1024),
  source_bytes: positive.max(64 * 1024 * 1024),
  auto_deploy_paused: z.literal(true),
  deployment_started: z.literal(false),
  runtime_preflight: z.literal('required'),
  verified_at: z.iso.datetime()
}) satisfies z.ZodType<ProductProjectSourceVerificationResult>

type Authority = {
  app_id: number
  name: string
  framework: string
  vps_id: number
  host_port: number
  container_port: number
  healthcheck_path: string
  healthcheck_response_type: string
  needs_db: number
  source_type: string
  source_path: string | null
  imported_from_vps: number
  git_repo_url: string
  git_ref: string
  git_root: string
  ownership_generation: number
  source_generation: number
  source_config_sha256: string
  repository_url: string
  production_ref: string
  repository_root: string
  deploy_config_json: string
  config_sha256: string
  auto_deploy_paused: number
  pause_reason: string | null
  pause_policy_provenance: string
  changed_at: string
}

type SourceErrorCode =
  | 'PROJECT_SOURCE_REQUEST_INVALID'
  | 'PROJECT_SOURCE_AUTHORITY_REJECTED'
  | 'PROJECT_SOURCE_CHANGED'
  | 'PROJECT_SOURCE_OBSERVATION_STALE'
  | 'PROJECT_SOURCE_REQUIRES_QUIESCENCE'
  | 'PROJECT_SOURCE_UNSUPPORTED'
  | 'PROJECT_SOURCE_LIMIT_EXCEEDED'
  | 'PROJECT_SOURCE_FETCH_FAILED'
  | 'PROJECT_SOURCE_ABORTED'
  | 'PROJECT_SOURCE_DEADLINE'
  | 'PROJECT_SOURCE_STORAGE_UNAVAILABLE'

export class ProjectSourceVerificationError extends Error {
  constructor(readonly code: SourceErrorCode) {
    super(code)
    this.name = 'ProjectSourceVerificationError'
  }
}

/** Không nhận source hoặc snapshot factory từ IPC/CLI; không mở SSH target. */
export async function verifyProductProjectSource(
  db: Database.Database,
  controllerId: string,
  input: unknown,
  options: {
    signal?: AbortSignal
  } = {}
): Promise<ProductProjectSourceVerificationResult> {
  const parsed = projectSourceVerificationInputSchema.safeParse(input)
  if (!parsed.success || parsed.data.controller_id !== controllerId || db.inTransaction)
    throw new ProjectSourceVerificationError('PROJECT_SOURCE_REQUEST_INVALID')
  const request = parsed.data
  const deadline = AbortSignal.timeout(90_000)
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline
  const assertNotAborted = (): void => {
    if (signal.aborted)
      throw new ProjectSourceVerificationError(
        options.signal?.aborted ? 'PROJECT_SOURCE_ABORTED' : 'PROJECT_SOURCE_DEADLINE'
      )
  }
  assertNotAborted()
  const bundle = verifyControllerBundle(request.artifact, request.manifest_sha256)
  const repository = new ProductDeployRepository(db)
  const before = db.transaction(() => readAuthority(db, request)).immediate()
  let snapshot: Awaited<ReturnType<typeof createGitSnapshot>>
  try {
    snapshot = await createGitSnapshot({
      repositoryUrl: before.source.repository_url,
      ref: `refs/heads/${before.source.production_ref}`,
      root: before.source.repository_root,
      signal,
      timeoutMs: 90_000,
      maxBytes: 512 * 1024 * 1024
    })
  } catch {
    assertNotAborted()
    throw new ProjectSourceVerificationError('PROJECT_SOURCE_FETCH_FAILED')
  }
  const verifySnapshot = (): ProductProjectSourceVerificationResult => {
    assertNotAborted()
    if (
      snapshot.repositoryUrl !== before.source.repository_url ||
      !/^[a-f0-9]{40}$/.test(snapshot.commitSha)
    )
      throw new ProjectSourceVerificationError('PROJECT_SOURCE_FETCH_FAILED')
    // Source hỏng/không hỗ trợ phải bị loại trước observation và trước bất kỳ target I/O.
    let preflight: ReturnType<typeof validateProductSourceAndPlan>
    try {
      verifyControllerBundle(request.artifact, request.manifest_sha256)
      preflight = validateProductSourceAndPlan(
        db,
        request.app_id,
        snapshot.rootDirectory,
        bundle.collector_directory,
        bundle.templates_directory
      )
    } catch (error) {
      if (error instanceof ProductSourceRenderError)
        throw new ProjectSourceVerificationError(
          error.code === 'PRODUCT_SOURCE_RENDER_LIMIT_EXCEEDED'
            ? 'PROJECT_SOURCE_LIMIT_EXCEEDED'
            : 'PROJECT_SOURCE_UNSUPPORTED'
        )
      throw new ProjectSourceVerificationError('PROJECT_SOURCE_UNSUPPORTED')
    }
    assertNotAborted()
    if (db.inTransaction) throw new ProjectSourceVerificationError('PROJECT_SOURCE_REQUEST_INVALID')
    try {
      return db
        .transaction(() => {
          assertNotAborted()
          const after = readAuthority(db, request)
          if (
            canonicalH2Json(after.source) !== canonicalH2Json(before.source) ||
            canonicalH2Json(after.target) !== canonicalH2Json(before.target)
          )
            throw new ProjectSourceVerificationError('PROJECT_SOURCE_CHANGED')
          if (after.observationSequence !== before.observationSequence)
            throw new ProjectSourceVerificationError('PROJECT_SOURCE_OBSERVATION_STALE')
          const observed = repository.observeTip({
            controllerId,
            appId: request.app_id,
            ownershipGeneration: request.expected_ownership_generation,
            sourceGeneration: request.expected_source_generation,
            configSha256: request.expected_source_config_sha256,
            ref: before.source.production_ref,
            expectedObservationSequence: before.observationSequence,
            tipSha: snapshot.commitSha
          })
          if (observed.reconciliation.state !== 'paused')
            throw new ProjectSourceVerificationError('PROJECT_SOURCE_REQUIRES_QUIESCENCE')
          const verifiedAt = new Date().toISOString()
          db.prepare(
            `INSERT INTO product_history_event(controller_id,app_id,kind,created_at,safe_summary_json)
          VALUES(?,?,'project_source_verified',?,?)`
          ).run(
            controllerId,
            request.app_id,
            verifiedAt,
            JSON.stringify({
              app_id: request.app_id,
              source_generation: request.expected_source_generation,
              commit_sha: snapshot.commitSha,
              observation_sequence: observed.observationSequence
            })
          )
          return {
            state: 'source_verified' as const,
            controller_id: controllerId,
            app_id: request.app_id,
            ownership_generation: request.expected_ownership_generation,
            source_generation: request.expected_source_generation,
            source_config_sha256: request.expected_source_config_sha256,
            target_vps_id: before.source.vps_id,
            target_security_revision: before.target.ssh_security_revision,
            repository_url: before.source.repository_url,
            production_ref: before.source.production_ref,
            repository_root: before.source.repository_root,
            commit_sha: snapshot.commitSha,
            observation_sequence: observed.observationSequence,
            framework: 'express' as const,
            configured_container_port: before.source.container_port,
            detected_container_port: preflight.plan.containerPort,
            source_file_count: preflight.sourceFiles.length,
            source_bytes: preflight.sourceManifest.totalBytes,
            auto_deploy_paused: true as const,
            deployment_started: false as const,
            runtime_preflight: 'required' as const,
            verified_at: verifiedAt
          }
        })
        .immediate()
    } catch (error) {
      if (error instanceof ProjectSourceVerificationError) throw error
      throw new ProjectSourceVerificationError('PROJECT_SOURCE_STORAGE_UNAVAILABLE')
    }
  }
  let outcome: { result: ProductProjectSourceVerificationResult } | { error: unknown }
  try {
    outcome = { result: verifySnapshot() }
  } catch (error) {
    outcome = { error }
  }
  try {
    snapshot.cleanup()
  } catch {
    // Giữ lỗi xác minh gốc; lỗi cleanup cũng không được lộ path/raw exception.
    if ('result' in outcome)
      outcome = { error: new ProjectSourceVerificationError('PROJECT_SOURCE_STORAGE_UNAVAILABLE') }
  }
  if ('error' in outcome) throw outcome.error
  return outcome.result
}

function readAuthority(
  db: Database.Database,
  request: ProductProjectSourceVerificationInput
): {
  source: Authority
  target: ReturnType<TargetEnrollmentRepository['target']>
  observationSequence: number | null
} {
  const controllers = db
    .prepare('SELECT controller_id,status FROM product_controller')
    .all() as Array<{ controller_id: string; status: string }>
  if (
    controllers.length !== 1 ||
    controllers[0].controller_id !== request.controller_id ||
    controllers[0].status !== 'active'
  )
    throw new ProjectSourceVerificationError('PROJECT_SOURCE_AUTHORITY_REJECTED')
  const source = db
    .prepare(
      `SELECT a.id AS app_id,a.name,a.framework,a.vps_id,a.host_port,
    a.container_port,a.healthcheck_path,a.healthcheck_response_type,a.needs_db,a.source_type,
    a.source_path,a.imported_from_vps,a.git_repo_url,a.git_ref,a.git_root,
    c.ownership_generation,c.source_generation,c.source_config_sha256,c.auto_deploy_paused,
    c.pause_reason,c.pause_policy_provenance,c.changed_at,
    s.repository_url,s.production_ref,s.repository_root,s.deploy_config_json,s.config_sha256
    FROM app a JOIN product_app_control c ON c.app_id=a.id
    JOIN product_source_config s ON s.app_id=c.app_id AND s.source_generation=c.source_generation
    WHERE a.id=? AND c.controller_id=? AND c.mode='product'`
    )
    .get(request.app_id, request.controller_id) as Authority | undefined
  if (
    !source ||
    source.ownership_generation !== request.expected_ownership_generation ||
    source.source_generation !== request.expected_source_generation ||
    source.source_config_sha256 !== request.expected_source_config_sha256 ||
    source.config_sha256 !== request.expected_source_config_sha256 ||
    source.source_type !== 'git' ||
    source.git_repo_url !== source.repository_url ||
    source.git_ref !== source.production_ref ||
    source.git_root !== source.repository_root ||
    source.framework !== 'express' ||
    source.needs_db !== 0 ||
    source.source_path !== null ||
    source.imported_from_vps !== 0 ||
    source.healthcheck_response_type !== 'status_2xx'
  )
    throw new ProjectSourceVerificationError('PROJECT_SOURCE_AUTHORITY_REJECTED')
  try {
    if (canonicalizeGitHubUrl(source.repository_url) !== source.repository_url) throw new Error()
    validateRef(source.production_ref)
    if (
      source.production_ref.startsWith('refs/') ||
      /^[a-f0-9]{40}$/i.test(source.production_ref) ||
      source.production_ref
        .split('/')
        .some((part) => !part || part.startsWith('.') || part.endsWith('.lock')) ||
      (source.repository_root !== '.' &&
        (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(source.repository_root) ||
          source.repository_root.split('/').some((part) => ['.', '..', '.git'].includes(part))))
    )
      throw new Error()
    const config = canonicalH2Json({
      framework: source.framework,
      host_port: source.host_port,
      container_port: source.container_port,
      healthcheck_path: source.healthcheck_path,
      needs_db: false
    })
    if (
      source.deploy_config_json !== config ||
      createHash('sha256').update(config).digest('hex') !== source.config_sha256
    )
      throw new Error()
  } catch {
    throw new ProjectSourceVerificationError('PROJECT_SOURCE_AUTHORITY_REJECTED')
  }
  if (source.auto_deploy_paused !== 1)
    throw new ProjectSourceVerificationError('PROJECT_SOURCE_REQUIRES_QUIESCENCE')
  if (
    db
      .prepare(
        `SELECT 1 FROM product_deploy_attempt attempt JOIN product_deploy_job job
      ON job.job_id=attempt.job_id WHERE job.app_id=? AND
      (attempt.remote_outcome='unknown' OR attempt.state='uncertain') LIMIT 1`
      )
      .get(request.app_id)
  )
    throw new ProjectSourceVerificationError('PROJECT_SOURCE_REQUIRES_QUIESCENCE')
  let target: ReturnType<TargetEnrollmentRepository['target']>
  try {
    target = new TargetEnrollmentRepository(db).target(
      request.controller_id,
      request.app_id,
      request.expected_ownership_generation,
      true
    )
    if (target.ssh_security_revision !== request.expected_target_security_revision)
      throw new Error()
  } catch {
    throw new ProjectSourceVerificationError('PROJECT_SOURCE_REQUIRES_QUIESCENCE')
  }
  const latest = db
    .prepare(
      `SELECT observation_sequence FROM product_branch_observation
    WHERE app_id=? AND source_generation=? AND ref=? ORDER BY observation_sequence DESC LIMIT 1`
    )
    .get(request.app_id, request.expected_source_generation, source.production_ref) as
    { observation_sequence: number } | undefined
  return { source, target, observationSequence: latest?.observation_sequence ?? null }
}
