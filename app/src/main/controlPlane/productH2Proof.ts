import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type {
  H2Context,
  H2TerminalReceipt,
  H2SealedReceipt,
  H2CommitAttestation,
  H2SettlementAck,
  H2RuntimeProgress
} from '../../../../docs/contracts/product-h2-runtime'

const positive = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const natural = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const digest = z.string().regex(/^[0-9a-f]{64}$/)
const gitSha = z.string().regex(/^[0-9a-f]{40}$/)
const imageId = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const containerId = digest
const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/)
const timestamp = z
  .string()
  .length(24)
  .refine((value) => {
    const time = Date.parse(value)
    return Number.isFinite(time) && new Date(time).toISOString() === value
  })
const imageTag = z
  .string()
  .min(3)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*:[A-Za-z0-9_][A-Za-z0-9_.-]*$/)
const claimSchema = z.strictObject({
  controller_id: identifier,
  app_id: positive,
  job_id: identifier,
  attempt_id: identifier,
  attempt_number: positive,
  ownership_generation: positive,
  source_generation: positive,
  source_config_sha256: digest,
  app_lease_id: identifier,
  app_fence: positive,
  build_slot_lease_id: identifier,
  build_slot_fence: positive,
  expires_at: timestamp
})
const targetSchema = z.strictObject({
  vps_id: positive,
  host: z.string().min(1).max(253),
  port: positive.max(65535),
  host_fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/),
  username: z.string().min(1).max(128),
  auth_type: z.enum(['key', 'password']),
  ssh_security_revision: positive
})
const previousSchema = z.strictObject({
  deployment_id: positive,
  image_tag: imageTag,
  source_sha: gitSha
})
export const h2ContextSchema: z.ZodType<H2Context> = z
  .strictObject({
    version: z.literal(1),
    execution_nonce: digest,
    claim: claimSchema,
    target: targetSchema,
    deployment_id: positive,
    source_sha: gitSha,
    app_name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/),
    host_port: positive.min(1024).max(65535),
    container_port: positive.max(65535),
    healthcheck_path: z
      .string()
      .max(128)
      .regex(/^\/[A-Za-z0-9/_-]*$/),
    candidate_image_tag: imageTag,
    candidate_image_id: imageId.nullable(),
    build_state: z.enum(['build_succeeded', 'build_failed_definite']),
    previous: previousSchema.nullable(),
    activation_id: positive.nullable(),
    health_timeout_ms: positive.min(100).max(60_000),
    exposure_policy: z.literal('not_checked')
  })
  .superRefine((value, context) => {
    if (value.build_state === 'build_succeeded' && value.candidate_image_id === null)
      context.addIssue({ code: 'custom', message: 'H2_CONTEXT_INVALID' })
    if (
      value.build_state === 'build_failed_definite' &&
      (value.candidate_image_id !== null || value.activation_id !== null)
    )
      context.addIssue({ code: 'custom', message: 'H2_CONTEXT_INVALID' })
    if (value.previous?.deployment_id === value.deployment_id)
      context.addIssue({ code: 'custom', message: 'H2_CONTEXT_INVALID' })
  })
export const h2BoundarySchema = z.strictObject({
  generation: z.string().min(1).max(128),
  device: natural,
  inode: natural,
  next_offset: positive
})
export const h2RuntimeIdentitySchema = z
  .strictObject({
    deployment_id: positive,
    image_tag: imageTag,
    image_id: imageId,
    source_sha: gitSha,
    container_id: containerId,
    collector_container_id: containerId.nullable(),
    collector_image_id: imageId.nullable(),
    config_sha256: digest,
    health: z.enum(['healthy', 'unhealthy', 'unknown']),
    http_status: z.number().int().min(100).max(599).nullable()
  })
  .superRefine((value, context) => {
    if (
      value.health === 'healthy' &&
      (value.http_status === null || value.http_status < 200 || value.http_status >= 300)
    )
      context.addIssue({ code: 'custom', message: 'H2_HEALTH_INVALID' })
    if ((value.collector_container_id === null) !== (value.collector_image_id === null))
      context.addIssue({ code: 'custom', message: 'H2_COLLECTOR_INVALID' })
  })
export const h2ReceiptSchema: z.ZodType<H2TerminalReceipt> = z
  .strictObject({
    version: z.literal(1),
    context: h2ContextSchema,
    outcome: z.enum(['succeeded', 'failed', 'rolled_back']),
    failed_step: z.enum(['BUILD', 'DEPLOY']).nullable(),
    active_runtime: h2RuntimeIdentitySchema.nullable(),
    candidate_runtime: h2RuntimeIdentitySchema.nullable(),
    previous_runtime: h2RuntimeIdentitySchema.nullable(),
    boundary: h2BoundarySchema.nullable(),
    exposure_status: z.enum(['not_checked', 'degraded']),
    remote_quiescent: z.literal(true),
    sealed_at: timestamp
  })
  .superRefine((value, context) => {
    const fail = (): void => {
      context.addIssue({ code: 'custom', message: 'H2_RECEIPT_INVALID' })
    }
    const candidate = value.context
    const active = value.active_runtime
    const cand = value.candidate_runtime
    const prev = value.previous_runtime

    // H2-PROOF-001: Any runtimes sharing a container_id must be completely identical.
    const runtimes = [active, cand, prev].filter((r): r is NonNullable<typeof r> => r !== null)
    for (let i = 0; i < runtimes.length; i++) {
      for (let j = i + 1; j < runtimes.length; j++) {
        if (runtimes[i].container_id === runtimes[j].container_id) {
          if (canonicalH2Json(runtimes[i]) !== canonicalH2Json(runtimes[j])) {
            fail()
          }
        }
      }
    }

    if (value.outcome === 'succeeded') {
      if (
        value.failed_step !== null ||
        candidate.build_state !== 'build_succeeded' ||
        !active ||
        active.health !== 'healthy' ||
        active.deployment_id !== candidate.deployment_id ||
        active.image_id !== candidate.candidate_image_id ||
        active.image_tag !== candidate.candidate_image_tag ||
        active.source_sha !== candidate.source_sha ||
        active.collector_container_id === null ||
        active.collector_image_id === null ||
        !cand ||
        canonicalH2Json(cand) !== canonicalH2Json(active) ||
        !value.boundary ||
        !candidate.activation_id
      )
        fail()
      if (candidate.previous) {
        if (
          !prev ||
          prev.deployment_id !== candidate.previous.deployment_id ||
          prev.image_tag !== candidate.previous.image_tag ||
          prev.source_sha !== candidate.previous.source_sha ||
          (active && prev.container_id === active.container_id)
        )
          fail()
      } else {
        if (prev !== null) fail()
      }
    } else if (value.outcome === 'rolled_back') {
      if (
        !candidate.previous ||
        value.failed_step !== 'DEPLOY' ||
        !active ||
        active.health !== 'healthy' ||
        active.deployment_id !== candidate.previous.deployment_id ||
        active.image_tag !== candidate.previous.image_tag ||
        active.source_sha !== candidate.previous.source_sha ||
        !prev ||
        canonicalH2Json(prev) !== canonicalH2Json(active) ||
        !value.boundary ||
        !candidate.activation_id
      )
        fail()
      if (cand) {
        if (
          cand.deployment_id !== candidate.deployment_id ||
          cand.image_tag !== candidate.candidate_image_tag ||
          cand.image_id !== candidate.candidate_image_id ||
          cand.source_sha !== candidate.source_sha ||
          (active && cand.container_id === active.container_id)
        )
          fail()
      }
    } else {
      if (value.failed_step === null) fail()
      if (candidate.previous) {
        if (
          !active ||
          active.health !== 'healthy' ||
          active.deployment_id !== candidate.previous.deployment_id ||
          active.image_tag !== candidate.previous.image_tag ||
          active.source_sha !== candidate.previous.source_sha ||
          !prev ||
          canonicalH2Json(prev) !== canonicalH2Json(active)
        )
          fail()
      } else {
        if (active !== null || prev !== null) fail()
      }
      if (value.failed_step === 'BUILD') {
        if (
          candidate.build_state !== 'build_failed_definite' ||
          value.boundary !== null ||
          cand !== null
        )
          fail()
      } else {
        if (cand) {
          if (
            cand.deployment_id !== candidate.deployment_id ||
            cand.image_tag !== candidate.candidate_image_tag ||
            cand.image_id !== candidate.candidate_image_id ||
            cand.source_sha !== candidate.source_sha ||
            (active && cand.container_id === active.container_id)
          )
            fail()
        }
      }
    }
  })
export const h2EnvelopeSchema: z.ZodType<H2SealedReceipt> = z.strictObject({
  receipt: h2ReceiptSchema,
  receipt_sha256: digest,
  signature: digest
})
const commitPayload = z.strictObject({
  version: z.literal(1),
  kind: z.literal('product-h2-commit'),
  commit_id: identifier,
  receipt_sha256: digest,
  context_sha256: digest,
  execution_nonce: digest,
  attempt_id: identifier,
  deployment_id: positive,
  outcome: z.enum(['succeeded', 'failed', 'rolled_back'])
})
export const h2AttestationSchema: z.ZodType<H2CommitAttestation> = z.strictObject({
  payload: commitPayload,
  signature: digest
})
export const h2AckSchema: z.ZodType<H2SettlementAck> = z.strictObject({
  payload: z.strictObject({
    version: z.literal(1),
    kind: z.literal('product-h2-settlement'),
    commit_id: identifier,
    receipt_sha256: digest,
    context_sha256: digest,
    execution_nonce: digest,
    attempt_id: identifier,
    deployment_id: positive,
    settled_at: timestamp
  }),
  signature: digest
})
export const h2ProgressSchema: z.ZodType<H2RuntimeProgress> = z.strictObject({
  state: z.enum(['idle', 'running', 'step_succeeded', 'step_failed', 'unknown']),
  step: z.enum(['prepare', 'activate', 'health', 'rollback', 'publish']).optional(),
  boundary: h2BoundarySchema.optional(),
  previous: h2RuntimeIdentitySchema.nullable().optional(),
  candidate: h2RuntimeIdentitySchema.nullable().optional(),
  exposure_status: z.enum(['not_checked', 'degraded']).optional(),
  safe_error_code: z
    .string()
    .max(128)
    .regex(/^[A-Z0-9_]+$/)
    .optional(),
  remote_quiescent: z.boolean()
})

/** Chỉ JSON canonical có số nguyên an toàn; không gọi toJSON trên object tùy ý. */
export function canonicalH2Json(value: unknown): string {
  const seen = new Set<object>()
  const encode = (item: unknown): string => {
    if (item === null) return 'null'
    if (typeof item === 'boolean') return item ? 'true' : 'false'
    if (typeof item === 'number' && Number.isSafeInteger(item)) return String(item === 0 ? 0 : item)
    if (typeof item === 'string' && Buffer.from(item, 'utf8').toString('utf8') === item)
      return JSON.stringify(item)
    if (typeof item !== 'object' || item === null || seen.has(item))
      throw new Error('H2_PROOF_INVALID')
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      throw new Error('H2_PROOF_INVALID')
    seen.add(item)
    try {
      if (Array.isArray(item)) return `[${Array.from(item, encode).join(',')}]`
      const keys = Reflect.ownKeys(item)
      if (keys.some((key) => typeof key !== 'string' || !/^[\x20-\x7E]+$/.test(key)))
        throw new Error('H2_PROOF_INVALID')
      return `{${(keys as string[])
        .sort()
        .map((key) => `${JSON.stringify(key)}:${encode((item as Record<string, unknown>)[key])}`)
        .join(',')}}`
    } finally {
      seen.delete(item)
    }
  }
  const encoded = encode(value)
  if (Buffer.byteLength(encoded, 'utf8') > 48 * 1024) throw new Error('H2_PROOF_LIMIT')
  return encoded
}
export function hashH2(value: unknown): string {
  return createHash('sha256').update(canonicalH2Json(value), 'utf8').digest('hex')
}
export function signH2(
  domain: 'receipt' | 'commit' | 'settlement',
  payload: unknown,
  secret: Buffer
): string {
  if (
    !Buffer.isBuffer(secret) ||
    secret.length !== 32 ||
    !['receipt', 'commit', 'settlement'].includes(domain)
  )
    throw new Error('H2_PROOF_INVALID')
  return createHmac('sha256', secret)
    .update(`product-h2:${domain}\n${canonicalH2Json(payload)}`, 'utf8')
    .digest('hex')
}
export function verifyH2(
  domain: 'receipt' | 'commit' | 'settlement',
  payload: unknown,
  signature: string,
  secret: Buffer
): boolean {
  try {
    if (!/^[0-9a-f]{64}$/.test(signature)) return false
    return timingSafeEqual(
      Buffer.from(signH2(domain, payload, secret), 'hex'),
      Buffer.from(signature, 'hex')
    )
  } catch {
    return false
  }
}
