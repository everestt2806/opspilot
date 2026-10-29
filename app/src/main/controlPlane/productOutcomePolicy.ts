import { z } from 'zod'

import { PRODUCT_LEASE_TTL_MS } from '../../../../docs/contracts/product-auto-deploy'
import type {
  ProductClaimToken,
  ProductDispatchTargetBinding
} from '../../../../docs/contracts/product-auto-deploy'

const positiveInteger = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/)
const sha = z.string().regex(/^[0-9a-f]{40}$/)
const imageId = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const imageTag = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9_][A-Za-z0-9_.-]*$/)
const timestamp = z
  .string()
  .length(24)
  .refine((value) => {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
  })

const claimSchema: z.ZodType<ProductClaimToken> = z.strictObject({
  controller_id: identifier,
  app_id: positiveInteger,
  job_id: identifier,
  attempt_id: identifier,
  attempt_number: positiveInteger,
  ownership_generation: positiveInteger,
  source_generation: positiveInteger,
  source_config_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  app_lease_id: identifier,
  app_fence: positiveInteger,
  build_slot_lease_id: identifier,
  build_slot_fence: positiveInteger,
  expires_at: timestamp
})

const targetSchema: z.ZodType<ProductDispatchTargetBinding> = z.strictObject({
  vps_id: positiveInteger,
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  host_fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/),
  username: z.string().min(1).max(128),
  auth_type: z.enum(['key', 'password']),
  ssh_security_revision: positiveInteger
})

const runtimeIdentitySchema = z.strictObject({
  deployment_id: positiveInteger,
  image_tag: imageTag,
  image_id: imageId,
  source_sha: sha,
  container_id: z.string().regex(/^[0-9a-f]{64}$/)
})

const candidateSchema = runtimeIdentitySchema.omit({ container_id: true })
const runtimeSchema = runtimeIdentitySchema.extend({
  health: z.strictObject({
    state: z.enum(['healthy', 'unhealthy', 'unknown']),
    http_status: z.number().int().min(100).max(599).nullable(),
    checked_at: timestamp
  })
})

const contextSchema = z.strictObject({
  claim: claimSchema,
  target: targetSchema,
  candidate: candidateSchema,
  previous: runtimeIdentitySchema.nullable(),
  authority: z.enum(['current', 'stale']),
  now_ms: positiveInteger,
  execution_started_at: timestamp,
  app_lease_expires_at: timestamp,
  build_slot_lease_expires_at: timestamp,
  max_evidence_age_ms: z.number().int().min(1).max(PRODUCT_LEASE_TTL_MS)
})

const evidenceSchema = z.strictObject({
  claim: claimSchema,
  target: targetSchema,
  candidate: candidateSchema,
  phase: z.enum(['build', 'activate', 'health', 'rollback', 'publish']),
  outcome: z.enum(['succeeded', 'failed', 'unknown']),
  observed_at: timestamp,
  remote_quiescent: z.boolean(),
  runtime: runtimeSchema.nullable(),
  exposure_status: z.enum(['reachable', 'degraded', 'tunnel_only', 'not_checked'])
})

/** Context phải được caller lấy từ DB authority hiện hành; đây không phải wire contract. */
export type ProductOutcomeContext = z.infer<typeof contextSchema>
export type ProductOutcomeEvidence = z.infer<typeof evidenceSchema>
export type ProductRuntimeIdentity = z.infer<typeof runtimeIdentitySchema>

export type ProductOutcomeReconciliationCode =
  | 'EVIDENCE_INVALID'
  | 'AUTHORITY_STALE'
  | 'LEASE_EXPIRED'
  | 'IDENTITY_MISMATCH'
  | 'EVIDENCE_TIME_INVALID'
  | 'REMOTE_OUTCOME_UNKNOWN'
  | 'RUNTIME_MISMATCH'
  | 'HEALTH_UNVERIFIED'
  | 'PHASE_OUTCOME_CONFLICT'

/** Chỉ đề xuất quyết định; không cấp quyền mutate/finalize hoặc thay DB CAS. */
export type ProductOutcomeDecision =
  | { action: 'reconciliation_required'; code: ProductOutcomeReconciliationCode }
  | { action: 'continue_activation' }
  | { action: 'check_candidate_health' }
  | { action: 'check_exposure' }
  | { action: 'restore_previous'; deployment_id: number }
  | {
      action: 'candidate_healthy'
      proposed_job_state: 'succeeded'
      exposure_status: ProductOutcomeEvidence['exposure_status']
    }
  | { action: 'previous_preserved'; proposed_job_state: 'failed'; failed_step: 'BUILD' | 'DEPLOY' }
  | { action: 'previous_restored'; proposed_job_state: 'rolled_back'; deployment_id: number }
  | {
      action: 'first_deploy_failed'
      proposed_job_state: 'failed'
      failed_step: 'BUILD' | 'DEPLOY' | 'HEALTHCHECK'
    }

/**
 * Kiểm tra cấu trúc/identity/semantics của observation từ adapter tin cậy.
 * Không xác thực nguồn receipt, đọc DB, gửi SSH hay khẳng định remote đã dừng.
 * Caller phải tái kiểm tra authority trước mutation/CAS và lấy proof qua guard.
 */
export function evaluateProductOutcome(
  context: unknown,
  evidence: unknown
): ProductOutcomeDecision {
  try {
    const parsedContext = contextSchema.safeParse(context)
    const parsedEvidence = evidenceSchema.safeParse(evidence)
    if (!parsedContext.success || !parsedEvidence.success) return reconcile('EVIDENCE_INVALID')
    return evaluate(parsedContext.data, parsedEvidence.data)
  } catch {
    // Dữ liệu không phải JSON có thể có getter ném lỗi; không để payload thô lọt ra log.
    return reconcile('EVIDENCE_INVALID')
  }
}

function evaluate(
  ctx: ProductOutcomeContext,
  proof: ProductOutcomeEvidence
): ProductOutcomeDecision {
  if (ctx.authority !== 'current') return reconcile('AUTHORITY_STALE')
  if (
    Date.parse(ctx.app_lease_expires_at) <= ctx.now_ms ||
    Date.parse(ctx.build_slot_lease_expires_at) <= ctx.now_ms
  )
    return reconcile('LEASE_EXPIRED')
  if (
    !sameFields(ctx.claim, proof.claim) ||
    !sameFields(ctx.target, proof.target) ||
    !sameFields(ctx.candidate, proof.candidate) ||
    ctx.previous?.deployment_id === ctx.candidate.deployment_id
  )
    return reconcile('IDENTITY_MISMATCH')
  const observedAt = Date.parse(proof.observed_at)
  const startedAt = Date.parse(ctx.execution_started_at)
  if (!validTime(ctx, observedAt) || startedAt > ctx.now_ms)
    return reconcile('EVIDENCE_TIME_INVALID')
  if (proof.outcome === 'unknown' || !proof.remote_quiescent)
    return reconcile('REMOTE_OUTCOME_UNKNOWN')

  const runtime = proof.runtime
  if (runtime) {
    const checkedAt = Date.parse(runtime.health.checked_at)
    if (!validTime(ctx, checkedAt) || checkedAt > observedAt)
      return reconcile('EVIDENCE_TIME_INVALID')
    const httpOk =
      runtime.health.http_status !== null &&
      runtime.health.http_status >= 200 &&
      runtime.health.http_status < 300
    if (
      (runtime.health.state === 'healthy' && !httpOk) ||
      (runtime.health.state === 'unhealthy' && httpOk)
    ) {
      return reconcile('PHASE_OUTCOME_CONFLICT')
    }
  }

  const candidateActive = runtime !== null && matchesCandidate(ctx, runtime)
  const previousHealthy =
    ctx.previous !== null &&
    runtime !== null &&
    sameRuntime(ctx.previous, runtime) &&
    runtime.health.state === 'healthy'
  switch (proof.phase) {
    case 'build':
      if (!(previousHealthy || (ctx.previous === null && runtime === null)))
        return reconcile('RUNTIME_MISMATCH')
      if (proof.outcome === 'succeeded') return { action: 'continue_activation' }
      return preservedOrFailed(ctx, 'BUILD')
    case 'activate':
      if (proof.outcome === 'succeeded')
        return candidateActive
          ? { action: 'check_candidate_health' }
          : reconcile('RUNTIME_MISMATCH')
      if (previousHealthy) return preservedOrFailed(ctx, 'DEPLOY')
      if (candidateActive) return recoverCandidate(ctx, 'DEPLOY')
      return ctx.previous === null && runtime === null
        ? preservedOrFailed(ctx, 'DEPLOY')
        : reconcile('RUNTIME_MISMATCH')
    case 'health':
      if (!candidateActive || !runtime) return reconcile('RUNTIME_MISMATCH')
      if (runtime.health.state === 'unknown') return reconcile('HEALTH_UNVERIFIED')
      if (proof.outcome === 'succeeded')
        return runtime.health.state === 'healthy'
          ? { action: 'check_exposure' }
          : reconcile('PHASE_OUTCOME_CONFLICT')
      return runtime.health.state === 'unhealthy'
        ? recoverCandidate(ctx, 'HEALTHCHECK')
        : reconcile('PHASE_OUTCOME_CONFLICT')
    case 'rollback':
      if (proof.outcome !== 'succeeded') return reconcile('REMOTE_OUTCOME_UNKNOWN')
      if (!previousHealthy || !ctx.previous) return reconcile('HEALTH_UNVERIFIED')
      return {
        action: 'previous_restored',
        proposed_job_state: 'rolled_back',
        deployment_id: ctx.previous.deployment_id
      }
    case 'publish':
      if (!candidateActive || !runtime) return reconcile('RUNTIME_MISMATCH')
      if (runtime.health.state !== 'healthy') return reconcile('HEALTH_UNVERIFIED')
      return {
        action: 'candidate_healthy',
        proposed_job_state: 'succeeded',
        exposure_status: proof.outcome === 'failed' ? 'degraded' : proof.exposure_status
      }
  }
}

function sameFields<T extends object>(left: T, right: T): boolean {
  return (Object.keys(left) as Array<keyof T>).every((key) => left[key] === right[key])
}

function validTime(ctx: ProductOutcomeContext, time: number): boolean {
  return (
    time >= Date.parse(ctx.execution_started_at) &&
    time <= ctx.now_ms &&
    ctx.now_ms - time <= ctx.max_evidence_age_ms
  )
}

function matchesCandidate(ctx: ProductOutcomeContext, runtime: ProductRuntimeIdentity): boolean {
  return (
    (Object.keys(ctx.candidate) as Array<keyof typeof ctx.candidate>).every(
      (key) => ctx.candidate[key] === runtime[key]
    ) && runtime.container_id !== ctx.previous?.container_id
  )
}

function sameRuntime(expected: ProductRuntimeIdentity, runtime: ProductRuntimeIdentity): boolean {
  // Compose có thể recreate V1 khi restore: image identity phải giữ, container ID được phép đổi.
  return (
    expected.deployment_id === runtime.deployment_id &&
    expected.image_tag === runtime.image_tag &&
    expected.image_id === runtime.image_id &&
    expected.source_sha === runtime.source_sha
  )
}

function recoverCandidate(
  ctx: ProductOutcomeContext,
  step: 'DEPLOY' | 'HEALTHCHECK'
): ProductOutcomeDecision {
  return ctx.previous
    ? { action: 'restore_previous', deployment_id: ctx.previous.deployment_id }
    : { action: 'first_deploy_failed', proposed_job_state: 'failed', failed_step: step }
}

function preservedOrFailed(
  ctx: ProductOutcomeContext,
  step: 'BUILD' | 'DEPLOY'
): ProductOutcomeDecision {
  return ctx.previous
    ? { action: 'previous_preserved', proposed_job_state: 'failed', failed_step: step }
    : { action: 'first_deploy_failed', proposed_job_state: 'failed', failed_step: step }
}

function reconcile(code: ProductOutcomeReconciliationCode): ProductOutcomeDecision {
  return { action: 'reconciliation_required', code }
}
