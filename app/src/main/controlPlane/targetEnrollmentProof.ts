import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { posix } from 'node:path'
import type { ProductDispatchTargetBinding } from '../../../../docs/contracts/product-auto-deploy'
import {
  PRODUCT_TARGET_ENROLLMENT_DOMAIN,
  type ProductTargetEnrollmentPayload,
  type ProductTargetEnrollmentProof
} from '../../../../docs/contracts/product-target-enrollment'
import { canonicalH2Json } from './productH2Proof'

export function makeTargetEnrollmentPayload(
  controllerId: string,
  appId: number,
  generation: number,
  target: ProductDispatchTargetBinding,
  manifestSha: string,
  root: string
): ProductTargetEnrollmentPayload {
  const slot = createHash('sha256').update(controllerId).digest('hex') + `-app-${appId}`
  const directory = posix.join(root, `controller-${slot}`)
  return {
    format: 1,
    purpose: 'product-target-enrollment',
    controller_id: controllerId,
    app_id: appId,
    ownership_generation: generation,
    target,
    manifest_sha256: manifestSha,
    target_root: root,
    state_root: posix.join(directory, 'state'),
    helper_path: posix.join(directory, 'helpers/target_guarded_ssh_helper.py')
  }
}

export function verifyTargetEnrollmentProof(
  expected: ProductTargetEnrollmentPayload,
  value: unknown,
  key: Buffer
): value is ProductTargetEnrollmentProof {
  try {
    if (
      !value ||
      typeof value !== 'object' ||
      Object.keys(value).sort().join(',') !== 'payload,signature' ||
      key.length !== 32
    )
      return false
    const proof = value as ProductTargetEnrollmentProof
    if (
      canonicalH2Json(proof.payload) !== canonicalH2Json(expected) ||
      typeof proof.signature !== 'string' ||
      proof.signature.length !== 64 ||
      !/^[a-f0-9]{64}$/.test(proof.signature)
    )
      return false
    const calculated = createHmac('sha256', key)
      .update(PRODUCT_TARGET_ENROLLMENT_DOMAIN + '\n')
      .update(canonicalH2Json(expected))
      .digest()
    return timingSafeEqual(calculated, Buffer.from(proof.signature, 'hex'))
  } catch {
    return false
  }
}
