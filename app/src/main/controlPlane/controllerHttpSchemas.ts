import { z } from 'zod'
import type {
  ProductApiErrorCode,
  ProductControllerApiMeta
} from '../../../../docs/contracts/product-controller-api'

// Copy runtime limits từ contract; scripts rootDir không cho runtime import docs.
export const CONTROLLER_HTTP_LIMITS = {
  timeout: 20_000,
  maxTimeout: 30_000,
  header: 16 * 1024,
  request: 16 * 1024,
  response: 1024 * 1024,
  page: 100,
  staleAfter: 30_000
} as const
export const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const text = (max = 256): z.ZodString => z.string().min(1).max(max).refine(noControls)
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/)
export const controllerIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/)
export const requestKeySchema = z.uuid().transform((value) => value.toLowerCase())
const timestamp = z.iso.datetime(),
  sha = z.string().regex(/^[0-9a-f]{40}$/),
  reason = z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{1,80}$/)
    .nullable(),
  jobState = z.enum([
    'queued',
    'claimed',
    'deploying',
    'retry_wait',
    'succeeded',
    'failed',
    'rolled_back',
    'uncertain',
    'superseded',
    'cancelled'
  ]),
  deploymentState = z.enum([
    'building',
    'deploying',
    'running',
    'failed',
    'rolled_back',
    'stopped'
  ]),
  reconciliation = z.enum([
    'pending',
    'queued',
    'in_progress',
    'satisfied',
    'paused',
    'failed',
    'uncertain'
  ]),
  serviceState = z.enum(['ready', 'degraded', 'maintenance'])
const meta = {
  controller_id: controllerIdSchema,
  request_id: z.uuid(),
  sampled_at: timestamp,
  data_freshness: z.enum(['current', 'stale', 'unknown'])
}
const capability = z.strictObject({
  state: z.enum(['available', 'blocked', 'unsupported']),
  reason_code: z
    .enum([
      'NOT_IMPLEMENTED',
      'CONTROLLER_NOT_READY',
      'OWNERSHIP_REQUIRES_REVIEW',
      'RECONCILIATION_REQUIRED',
      'FEATURE_DISABLED'
    ])
    .optional()
})
const summary = {
  app_id: positive,
  app_name: text(),
  controller_id: controllerIdSchema,
  ownership_generation: positive,
  source_generation: positive,
  source_config_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  production_ref: text(1024),
  auto_deploy_paused: z.boolean(),
  pause_reason: z.enum(['manual_action', 'operator']).nullable(),
  pause_policy_provenance: z.enum([
    'legacy_clean',
    'legacy_inferred',
    'operator_required',
    'explicit'
  ]),
  desired_sha: sha.nullable(),
  reconciliation_state: reconciliation.nullable(),
  observed_at: timestamp.nullable(),
  sampled_at: timestamp
}
const job = z.strictObject({
  job_id: id,
  app_id: positive,
  ownership_generation: positive,
  source_generation: positive,
  target_sha: sha.nullable(),
  state: jobState,
  trigger: z.enum(['branch_poll', 'manual_redeploy', 'manual_rollback']),
  attempt_count: count,
  created_at: timestamp,
  updated_at: timestamp,
  finished_at: timestamp.nullable(),
  reason_code: reason
})
const deployment = z.strictObject({
  deployment_id: positive,
  app_id: positive,
  version: positive,
  commit_sha: sha.nullable(),
  status: deploymentState,
  started_at: timestamp,
  finished_at: timestamp.nullable(),
  job_id: id.nullable(),
  attempt_id: id.nullable()
})
const history = z.strictObject({
  event_id: positive,
  app_id: positive,
  job_id: id.nullable(),
  attempt_id: id.nullable(),
  deployment_id: positive.nullable(),
  kind: text(128),
  state: jobState.nullable(),
  created_at: timestamp,
  reason_code: reason
})
const page = <T extends z.ZodType>(
  item: T
): z.ZodType<
  ProductControllerApiMeta & {
    items: z.output<T>[]
    next_cursor: string | null
    has_more: boolean
  }
> =>
  z
    .strictObject({
      ...meta,
      items: z.array(item).max(CONTROLLER_HTTP_LIMITS.page),
      next_cursor: z
        .string()
        .min(1)
        .max(2048)
        .regex(/^[A-Za-z0-9_-]+$/)
        .nullable(),
      has_more: z.boolean()
    })
    .refine((value) => value.has_more === (value.next_cursor !== null))
const url = z
  .string()
  .max(4096)
  .url()
  .refine((value) => {
    const parsed = new URL(value)
    return (
      ['http:', 'https:'].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash
    )
  })
export const controllerResponseSchemas = {
  identity: z.strictObject({
    ...meta,
    api_version: z.literal('v1'),
    api_bind_address: z.literal('127.0.0.1'),
    service_state: serviceState
  }),
  status: z.strictObject({
    ...meta,
    service_state: serviceState,
    last_branch_poll_at: timestamp.nullable(),
    next_branch_poll_at: timestamp.nullable(),
    queued_job_count: count,
    active_job_count: count,
    uncertain_job_count: count,
    storage_state: z.enum(['ok', 'low', 'unknown']),
    reason_code: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,80}$/)
      .nullable()
  }),
  capabilities: z.strictObject({
    ...meta,
    api_version: z.literal('v1'),
    read: capability,
    manual_redeploy: capability,
    pause_auto_deploy: capability,
    resume_auto_deploy: capability
  }),
  apps: page(z.strictObject(summary)),
  app: z.strictObject({
    ...summary,
    ...meta,
    current_deployment_id: positive.nullable(),
    current_deployment_sha: sha.nullable(),
    current_deployment_state: deploymentState.nullable(),
    latest_job_id: id.nullable(),
    latest_job_state: jobState.nullable(),
    http_url: url.nullable()
  }),
  jobs: page(job),
  deployments: page(deployment),
  history: page(history),
  lookup: z.union([
    z.strictObject({ ...meta, found: z.literal(false) }),
    z.strictObject({
      ...meta,
      found: z.literal(true),
      status: z.strictObject({
        request_key: requestKeySchema,
        action: z.enum(['manual_redeploy', 'pause_auto_deploy', 'resume_auto_deploy']),
        app_id: positive,
        ownership_generation: positive,
        source_generation: positive,
        state: z.enum(['accepted', 'completed', 'blocked', 'uncertain']),
        job_id: id.nullable(),
        reason_code: reason,
        updated_at: timestamp
      })
    })
  ]),
  redeploy: z.strictObject({
    ...meta,
    job_id: id,
    app_id: positive,
    target_sha: sha,
    state: z.enum(['queued', 'already_requested']),
    auto_deploy_paused: z.literal(true),
    retry_with_same_idempotency_key: z.literal(true)
  }),
  policy: z.strictObject({
    ...meta,
    app_id: positive,
    result: z.enum(['updated', 'already_in_state']),
    auto_deploy_paused: z.boolean(),
    pause_policy_provenance: z.literal('explicit'),
    reconciliation_state: reconciliation,
    updated_at: timestamp
  })
}
const generations = {
  expected_ownership_generation: positive,
  expected_source_generation: positive
}
export const controllerRequestSchemas = {
  redeploy: z.strictObject({
    ...generations,
    target: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('current_desired') }),
      z.strictObject({ kind: z.literal('specific_sha'), sha })
    ])
  }),
  policy: z.strictObject({
    ...generations,
    action: z.enum(['pause', 'resume']),
    reason: z
      .string()
      .refine((value) => Buffer.byteLength(value) <= 200 && noControls(value))
      .optional()
  })
}
export const controllerPageQuerySchema = z.strictObject({
  limit: positive.max(CONTROLLER_HTTP_LIMITS.page).optional(),
  cursor: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional()
})
export const controllerErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum([
      'AUTH_REQUIRED',
      'CREDENTIAL_EXPIRED',
      'CREDENTIAL_REVOKED',
      'CONTROLLER_MISMATCH',
      'CLIENT_REVOKED',
      'SCOPE_REQUIRED',
      'APP_NOT_FOUND',
      'OWNERSHIP_STALE',
      'SOURCE_GENERATION_STALE',
      'IDEMPOTENCY_CONFLICT',
      'NO_DESIRED_TARGET',
      'TARGET_SHA_UNAVAILABLE',
      'REQUEST_INVALID',
      'NOT_FOUND',
      'UNSUPPORTED',
      'CAPABILITY_BLOCKED',
      'RECONCILIATION_REQUIRED',
      'RATE_LIMITED',
      'INTERNAL_ERROR'
    ] satisfies ProductApiErrorCode[]),
    message: z.string().max(1024),
    retryable: z.boolean(),
    request_id: z.uuid(),
    retry_after_seconds: positive.optional(),
    current_ownership_generation: positive.optional(),
    current_source_generation: positive.optional()
  })
})

export const controllerErrorStatuses: Record<ProductApiErrorCode, readonly number[]> = {
  AUTH_REQUIRED: [401],
  CREDENTIAL_EXPIRED: [401],
  CREDENTIAL_REVOKED: [401],
  CLIENT_REVOKED: [401],
  CONTROLLER_MISMATCH: [403],
  SCOPE_REQUIRED: [403],
  APP_NOT_FOUND: [404],
  NOT_FOUND: [404],
  OWNERSHIP_STALE: [409],
  SOURCE_GENERATION_STALE: [409],
  IDEMPOTENCY_CONFLICT: [409],
  NO_DESIRED_TARGET: [409],
  TARGET_SHA_UNAVAILABLE: [409],
  RECONCILIATION_REQUIRED: [409],
  REQUEST_INVALID: [400, 413],
  RATE_LIMITED: [429],
  UNSUPPORTED: [501],
  CAPABILITY_BLOCKED: [503],
  INTERNAL_ERROR: [500]
}

function noControls(value: string): boolean {
  return [...value].every(
    (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127
  )
}
