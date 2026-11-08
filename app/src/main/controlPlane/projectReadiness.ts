import type Database from 'better-sqlite3'
import { z } from 'zod'
import type {
  ProductProjectReadiness,
  ProductReadinessCheck,
  ProductReadinessReason
} from '../../../../docs/contracts/product-project-readiness'
import {
  projectSourceVerificationInputSchema,
  readProjectSourceAuthority,
  verifyProductProjectSource
} from './projectSourceVerification'
import { verifyControllerBundle } from './controllerBundle'
import { readEnrolledProductTarget, inspectStoredProductTarget } from './targetEnrollment'
import { createControllerSshResolver } from './controllerSshResolver'
import { SshManager } from '../ssh/manager'
import { observeProductTarget } from './controllerTargetProbe'
import { assessProductResources, measureControllerResources } from './controllerResources'
import { canonicalH2Json } from './productH2Proof'
const positive = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const resourceSchema = z.strictObject({
  cpu_count: positive,
  available_ram_bytes: positive,
  workspace_available_bytes: positive,
  docker_ready: z.boolean().optional(),
  port_ready: z.boolean().optional()
})
const checkSchema = z.enum([
  'first_deployment',
  'controller_resources',
  'target_enrollment',
  'source',
  'target_resources'
])
export const projectReadinessSchema = z.strictObject({
  controller_id: projectSourceVerificationInputSchema.shape.controller_id,
  app_id: positive.positive(),
  ownership_generation: positive.positive(),
  source_generation: positive.positive(),
  source_config_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  target_vps_id: positive.positive(),
  target_security_revision: positive.positive(),
  repository_url: z.string().min(1).max(2048),
  production_ref: z.string().min(1).max(255),
  repository_root: z.string().min(1).max(512),
  host_port: positive.min(30000).max(30999),
  commit_sha: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .nullable(),
  state: z.enum(['ready', 'blocked']),
  checks: z
    .array(
      z.strictObject({ key: checkSchema, state: z.enum(['passed', 'blocked', 'not_checked']) })
    )
    .length(5),
  reasons: z
    .array(
      z.enum([
        'current_deployment_exists',
        'controller_resources_unavailable',
        'target_not_enrolled',
        'target_verification_failed',
        'source_verification_failed',
        'target_resources_unavailable',
        'authority_changed',
        'aborted'
      ])
    )
    .max(8),
  controller_resources: resourceSchema.nullable(),
  target_resources: resourceSchema.nullable(),
  auto_deploy_paused: z.literal(true),
  deployment_started: z.literal(false),
  checked_at: z.iso.datetime()
}) satisfies z.ZodType<ProductProjectReadiness>
export class ProjectReadinessError extends Error {
  constructor(
    readonly code: 'PROJECT_READINESS_REQUEST_INVALID' | 'PROJECT_READINESS_UNAVAILABLE'
  ) {
    super(code)
  }
}
/** Snapshot không cấp claim, không reserve tài nguyên hoặc bắt đầu deployment. */
export async function checkProjectReadiness(
  db: Database.Database,
  controllerId: string,
  directory: string,
  input: unknown,
  parentSignal?: AbortSignal
): Promise<ProductProjectReadiness> {
  const parsed = projectSourceVerificationInputSchema.safeParse(input)
  if (!parsed.success || parsed.data.controller_id !== controllerId || db.inTransaction)
    throw new ProjectReadinessError('PROJECT_READINESS_REQUEST_INVALID')
  const value = parsed.data,
    bundle = verifyControllerBundle(value.artifact, value.manifest_sha256)
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, AbortSignal.timeout(165_000)])
    : AbortSignal.timeout(165_000)
  const before = db.transaction(() => readProjectSourceAuthority(db, value)).immediate()
  const checks: ProductProjectReadiness['checks'] = checkSchema.options.map((key) => ({
    key,
    state: 'not_checked'
  }))
  const reasons: ProductReadinessReason[] = []
  const result: ProductProjectReadiness = {
    controller_id: controllerId,
    app_id: value.app_id,
    ownership_generation: value.expected_ownership_generation,
    source_generation: value.expected_source_generation,
    source_config_sha256: value.expected_source_config_sha256,
    target_vps_id: before.target.vps_id,
    target_security_revision: before.target.ssh_security_revision,
    repository_url: before.source.repository_url,
    production_ref: before.source.production_ref,
    repository_root: before.source.repository_root,
    host_port: before.source.host_port,
    commit_sha: null,
    state: 'blocked',
    checks,
    reasons,
    controller_resources: null,
    target_resources: null,
    auto_deploy_paused: true,
    deployment_started: false,
    checked_at: new Date().toISOString()
  }
  const mark = (
    key: ProductReadinessCheck,
    passed: boolean,
    reason: ProductReadinessReason
  ): void => {
    checks.find((check) => check.key === key)!.state = passed ? 'passed' : 'blocked'
    if (!passed && !reasons.includes(reason)) reasons.push(reason)
  }
  const done = (): ProductProjectReadiness => {
    result.checked_at = new Date().toISOString()
    result.state =
      checks.every((check) => check.state === 'passed') &&
      reasons.length === 0 &&
      result.commit_sha !== null
        ? 'ready'
        : 'blocked'
    return result
  }
  const current = (): void => {
    if (signal.aborted) throw new Error('ABORTED')
    if (db.inTransaction) throw new Error('TRANSACTION_ACTIVE')
    const now = db.transaction(() => readProjectSourceAuthority(db, value)).immediate()
    if (
      canonicalH2Json(now.source) !== canonicalH2Json(before.source) ||
      canonicalH2Json(now.target) !== canonicalH2Json(before.target)
    )
      throw new Error('CHANGED')
  }
  const first = (): boolean =>
    !db
      .prepare('SELECT 1 FROM app WHERE id=? AND current_deployment_id IS NOT NULL')
      .get(value.app_id)
  mark('first_deployment', first(), 'current_deployment_exists')
  if (reasons.length) return done()
  let payload: ReturnType<typeof readEnrolledProductTarget>
  try {
    payload = readEnrolledProductTarget(
      db,
      directory,
      controllerId,
      value.app_id,
      value.expected_ownership_generation,
      value.manifest_sha256
    )
  } catch {
    mark('target_enrollment', false, 'target_not_enrolled')
    return done()
  }
  try {
    result.controller_resources = measureControllerResources(directory)
    mark(
      'controller_resources',
      assessProductResources(result.controller_resources).state === 'ready',
      'controller_resources_unavailable'
    )
  } catch {
    mark('controller_resources', false, 'controller_resources_unavailable')
  }
  if (reasons.length) return done()
  try {
    const source = await verifyProductProjectSource(db, controllerId, value, { signal })
    current()
    mark('first_deployment', first(), 'current_deployment_exists')
    result.commit_sha = source.commit_sha
    mark('source', true, 'source_verification_failed')
  } catch {
    mark('source', false, signal.aborted ? 'aborted' : 'source_verification_failed')
    return done()
  }
  if (reasons.length) return done()
  const ssh = new SshManager(createControllerSshResolver(db, controllerId, directory))
  try {
    current()
    const observed = await observeProductTarget(db, controllerId, payload, ssh, true, signal)
    current()
    result.target_resources = observed.resources
    mark(
      'target_resources',
      assessProductResources(observed.resources, true).state === 'ready',
      'target_resources_unavailable'
    )
    const inspected = await inspectStoredProductTarget(
      db,
      directory,
      controllerId,
      value.app_id,
      value.expected_ownership_generation,
      bundle,
      observed.manifest,
      signal
    )
    current()
    mark('target_enrollment', inspected.state === 'enrolled', 'target_verification_failed')
    mark('first_deployment', first(), 'current_deployment_exists')
    result.controller_resources = measureControllerResources(directory)
    mark(
      'controller_resources',
      assessProductResources(result.controller_resources).state === 'ready',
      'controller_resources_unavailable'
    )
  } catch {
    if (!reasons.includes(signal.aborted ? 'aborted' : 'authority_changed'))
      reasons.push(signal.aborted ? 'aborted' : 'authority_changed')
    mark('target_enrollment', false, 'target_verification_failed')
  } finally {
    await ssh.disconnectAll()
  }
  return done()
}
