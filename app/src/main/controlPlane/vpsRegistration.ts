import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { ProductVpsRegistrationResult } from '../../../../docs/contracts/product-vps-registration'
import {
  controllerVpsEnrollmentSchema,
  enrollControllerVps,
  ControllerVpsEnrollmentError
} from './controllerEnrollment'
import { canonicalH2Json } from './productH2Proof'

export const vpsRegistrationInputSchema = controllerVpsEnrollmentSchema.extend({
  request_key: z.uuid().transform((value) => value.toLowerCase())
})
export const vpsRegistrationResultSchema = z.strictObject({
  state: z.literal('registered'),
  request_key: z.uuid(),
  controller_id: controllerVpsEnrollmentSchema.shape.controller_id,
  vps_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  ssh_security_revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  profile: controllerVpsEnrollmentSchema.shape.profile,
  created_at: z.iso.datetime()
}) satisfies z.ZodType<ProductVpsRegistrationResult>
export class VpsRegistrationError extends ControllerVpsEnrollmentError {
  constructor(
    readonly code:
      | 'VPS_REGISTRATION_REQUEST_INVALID'
      | 'VPS_REGISTRATION_CONFLICT'
      | 'VPS_REGISTRATION_CHANGED'
      | 'VPS_REGISTRATION_UNAVAILABLE'
  ) {
    super(code)
  }
}
type Receipt = {
  profile_json: string
  profile_sha256: string
  vps_id: number
  ssh_security_revision: number
  result_json: string
}
/** Không lưu secret/hash password; base enrollment kiểm lại credential bằng decrypt trong RAM. */
export async function registerControllerVps(
  db: Database.Database,
  controllerId: string,
  directory: string,
  administratorId: string,
  input: unknown,
  signal?: AbortSignal
): Promise<ProductVpsRegistrationResult> {
  const parsed = vpsRegistrationInputSchema.safeParse(input)
  if (
    !parsed.success ||
    parsed.data.controller_id !== controllerId ||
    !/^unix:[0-9]+$/.test(administratorId) ||
    db.inTransaction
  )
    throw new VpsRegistrationError('VPS_REGISTRATION_REQUEST_INVALID')
  const { request_key, ...enrollment } = parsed.data,
    profile = canonicalH2Json(enrollment.profile),
    digest = createHash('sha256').update(profile).digest('hex')
  const previous = (): ProductVpsRegistrationResult | null => {
    const receipt = db
      .prepare(
        'SELECT profile_json,profile_sha256,vps_id,ssh_security_revision,result_json FROM product_vps_registration WHERE controller_id=? AND administrator_id=? AND request_key=?'
      )
      .get(controllerId, administratorId, request_key) as Receipt | undefined
    if (!receipt) return null
    if (receipt.profile_json !== profile || receipt.profile_sha256 !== digest)
      throw new VpsRegistrationError('VPS_REGISTRATION_CONFLICT')
    const result = vpsRegistrationResultSchema.safeParse(JSON.parse(receipt.result_json))
    const current = db
      .prepare(
        'SELECT name,host,port,username,auth_type,host_fingerprint,ssh_security_revision,archived_at FROM vps WHERE id=?'
      )
      .get(receipt.vps_id) as Record<string, unknown> | undefined
    if (
      !result.success ||
      result.data.request_key !== request_key ||
      result.data.controller_id !== controllerId ||
      result.data.vps_id !== receipt.vps_id ||
      result.data.ssh_security_revision !== receipt.ssh_security_revision ||
      canonicalH2Json(result.data.profile) !== profile ||
      !current ||
      current.archived_at !== null ||
      current.ssh_security_revision !== receipt.ssh_security_revision ||
      Object.entries(enrollment.profile).some(([key, value]) => current[key] !== value)
    )
      throw new VpsRegistrationError('VPS_REGISTRATION_CHANGED')
    return result.data
  }
  previous()
  let result: ProductVpsRegistrationResult | undefined
  await enrollControllerVps(db, controllerId, directory, enrollment, signal, (receipt) => {
    const existing = previous()
    if (existing) {
      if (existing.vps_id !== receipt.vps_id)
        throw new VpsRegistrationError('VPS_REGISTRATION_CONFLICT')
      result = existing
      return
    }
    const target = db
      .prepare('SELECT ssh_security_revision FROM vps WHERE id=? AND archived_at IS NULL')
      .get(receipt.vps_id) as { ssh_security_revision: number } | undefined
    if (!target) throw new VpsRegistrationError('VPS_REGISTRATION_CHANGED')
    const stamp = new Date().toISOString()
    result = {
      state: 'registered',
      request_key,
      controller_id: controllerId,
      vps_id: receipt.vps_id,
      ssh_security_revision: target.ssh_security_revision,
      profile: enrollment.profile,
      created_at: stamp
    }
    db.prepare(
      'INSERT INTO product_vps_registration(controller_id,administrator_id,request_key,profile_json,profile_sha256,vps_id,ssh_security_revision,result_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)'
    ).run(
      controllerId,
      administratorId,
      request_key,
      profile,
      digest,
      receipt.vps_id,
      target.ssh_security_revision,
      canonicalH2Json(result),
      stamp
    )
  })
  if (!result) throw new VpsRegistrationError('VPS_REGISTRATION_UNAVAILABLE')
  return result
}
