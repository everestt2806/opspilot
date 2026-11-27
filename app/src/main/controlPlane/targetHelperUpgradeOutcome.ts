import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  PRODUCT_TARGET_HELPER_UPGRADE_OUTCOME_DOMAIN,
  type ProductTargetHelperUpgradeOutcome
} from '../../../../docs/contracts/product-target-helper-upgrade'
import type {
  ProductTargetEnrollmentPayload,
  ProductTargetEnrollmentProof
} from '../../../../docs/contracts/product-target-enrollment'
import { canonicalH2Json } from './productH2Proof'
import { verifyTargetEnrollmentProof } from './targetEnrollmentProof'

export type TargetHelperUpgradeExpected = Readonly<{
  request_key: string
  review_sha256: string
  from: ProductTargetEnrollmentPayload
  to: ProductTargetEnrollmentPayload
}>
export type TargetHelperUpgradeResult = Readonly<{
  state: 'pending' | 'applied' | 'not_applied'
  receipt: ProductTargetHelperUpgradeOutcome
  proof: ProductTargetEnrollmentProof | null
}>
const sha = z.string().regex(/^[a-f0-9]{64}$/)
const states = z.enum(['pending', 'applied', 'not_applied'])
const payloadSchema = z.strictObject({
  format: z.literal(1),
  purpose: z.literal('product-target-helper-upgrade-outcome'),
  request_key: z.uuidv4().refine((value) => value === value.toLowerCase()),
  review_sha256: sha,
  controller_id: z.string().min(1).max(128),
  app_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  ownership_generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  from_manifest_sha256: sha,
  to_manifest_sha256: sha,
  state: states,
  settled: z.boolean(),
  marker_sha256: sha,
  enrollment_proof_sha256: sha.nullable()
})
const responseSchema = z.strictObject({
  state: states,
  receipt: z.strictObject({ payload: payloadSchema, signature: sha }),
  proof: z.unknown()
})

/** Verifies target evidence only; does not authorize dispatch, journal repair or SQL completion. */
export function verifyTargetHelperUpgradeOutcome(
  expected: TargetHelperUpgradeExpected,
  value: unknown,
  key: Buffer
): value is TargetHelperUpgradeResult {
  try {
    const parsed = responseSchema.safeParse(value)
    if (!parsed.success || key.length !== 32) return false
    const result = parsed.data,
      payload = result.receipt.payload
    if (
      payload.state !== result.state ||
      payload.request_key !== expected.request_key ||
      payload.review_sha256 !== expected.review_sha256 ||
      payload.controller_id !== expected.from.controller_id ||
      payload.app_id !== expected.from.app_id ||
      payload.ownership_generation !== expected.from.ownership_generation ||
      payload.from_manifest_sha256 !== expected.from.manifest_sha256 ||
      payload.to_manifest_sha256 !== expected.to.manifest_sha256 ||
      canonicalH2Json({ ...expected.from, manifest_sha256: expected.to.manifest_sha256 }) !==
        canonicalH2Json(expected.to)
    )
      return false
    const calculated = createHmac('sha256', key)
      .update(PRODUCT_TARGET_HELPER_UPGRADE_OUTCOME_DOMAIN + '\n')
      .update(canonicalH2Json(payload))
      .digest()
    if (!timingSafeEqual(calculated, Buffer.from(result.receipt.signature, 'hex'))) return false
    if (payload.state === 'pending')
      return !payload.settled && result.proof === null && payload.enrollment_proof_sha256 === null
    if (payload.state === 'applied' && !payload.settled) return false
    if (
      !verifyTargetEnrollmentProof(
        payload.state === 'applied' ? expected.to : expected.from,
        result.proof,
        key
      )
    )
      return false
    return (
      payload.enrollment_proof_sha256 ===
      createHash('sha256').update(canonicalH2Json(result.proof)).digest('hex')
    )
  } catch {
    return false
  }
}
