import type Database from 'better-sqlite3'
import { z } from 'zod'
import type { ProductProjectTargetState } from '../../../../docs/contracts/product-project-target'
import {
  projectSourceVerificationInputSchema,
  readProjectSourceAuthority
} from './projectSourceVerification'
import { canonicalH2Json } from './productH2Proof'
import { TargetEnrollmentRepository } from './targetEnrollmentRepository'
import {
  enrollProductTarget,
  readEnrolledProductTarget,
  productTargetRootSchema
} from './targetEnrollment'
import { verifyControllerBundle } from './controllerBundle'

export const DEFAULT_PROJECT_TARGET_ROOT = '/var/lib/opspilot-product'
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
export const projectTargetStateSchema = z.strictObject({
  controller_id: projectSourceVerificationInputSchema.shape.controller_id,
  app_id: positive,
  ownership_generation: positive,
  source_generation: positive,
  source_config_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  target_vps_id: positive,
  target_security_revision: positive,
  target_host: z.string().min(1).max(253),
  target_port: positive.max(65535),
  target_username: z.string().min(1).max(128),
  target_fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/),
  target_root: productTargetRootSchema,
  state: z.enum(['not_prepared', 'prepared', 'unknown', 'enrolled', 'conflict']),
  proof: z.enum(['not_available', 'persisted_verified']),
  deployment_started: z.literal(false),
  runtime_preflight: z.literal('required'),
  checked_at: z.iso.datetime()
}) satisfies z.ZodType<ProductProjectTargetState>
export class ProjectTargetError extends Error {
  constructor(
    readonly code:
      | 'PROJECT_TARGET_REQUEST_INVALID'
      | 'PROJECT_TARGET_AUTHORITY_CHANGED'
      | 'PROJECT_TARGET_CONFLICT'
      | 'PROJECT_TARGET_UNAVAILABLE'
  ) {
    super(code)
  }
}
function request(
  db: Database.Database,
  controllerId: string,
  input: unknown,
  enroll: boolean
): z.output<typeof projectSourceVerificationInputSchema> & { target_root?: string } {
  const schema = enroll
    ? projectSourceVerificationInputSchema.extend({ target_root: productTargetRootSchema })
    : projectSourceVerificationInputSchema
  const parsed = schema.safeParse(input)
  if (!parsed.success || parsed.data.controller_id !== controllerId || db.inTransaction)
    throw new ProjectTargetError('PROJECT_TARGET_REQUEST_INVALID')
  return parsed.data
}
export function readProjectTargetState(
  db: Database.Database,
  controllerId: string,
  directory: string,
  input: unknown
): ProductProjectTargetState {
  const value = request(db, controllerId, input, false)
  verifyControllerBundle(value.artifact, value.manifest_sha256)
  return db.transaction(() => state(db, directory, value)).immediate()
}
function state(
  db: Database.Database,
  directory: string,
  value: z.output<typeof projectSourceVerificationInputSchema>
): ProductProjectTargetState {
  const authority = readProjectSourceAuthority(db, value)
  const row = new TargetEnrollmentRepository(db).get({
    controller_id: value.controller_id,
    app_id: value.app_id,
    ownership_generation: value.expected_ownership_generation
  })
  let status: ProductProjectTargetState['state'] = row?.state ?? 'not_prepared',
    proof: ProductProjectTargetState['proof'] = 'not_available'
  if (row) {
    if (
      row.target_binding_json !== canonicalH2Json(authority.target) ||
      row.manifest_sha256 !== value.manifest_sha256 ||
      !productTargetRootSchema.safeParse(row.target_root).success
    )
      status = 'conflict'
    else if (row.state === 'enrolled') {
      try {
        readEnrolledProductTarget(
          db,
          directory,
          value.controller_id,
          value.app_id,
          value.expected_ownership_generation,
          value.manifest_sha256
        )
        proof = 'persisted_verified'
      } catch {
        status = 'conflict'
      }
    }
  }
  return projectTargetStateSchema.parse({
    controller_id: value.controller_id,
    app_id: value.app_id,
    ownership_generation: value.expected_ownership_generation,
    source_generation: value.expected_source_generation,
    source_config_sha256: value.expected_source_config_sha256,
    target_vps_id: authority.target.vps_id,
    target_security_revision: authority.target.ssh_security_revision,
    target_host: authority.target.host,
    target_port: authority.target.port,
    target_username: authority.target.username,
    target_fingerprint: authority.target.host_fingerprint,
    target_root:
      row?.target_root && productTargetRootSchema.safeParse(row.target_root).success
        ? row.target_root
        : DEFAULT_PROJECT_TARGET_ROOT,
    state: status,
    proof,
    deployment_started: false,
    runtime_preflight: 'required',
    checked_at: new Date().toISOString()
  })
}
export async function enrollProjectTarget(
  db: Database.Database,
  controllerId: string,
  directory: string,
  input: unknown,
  signal?: AbortSignal
): Promise<ProductProjectTargetState> {
  const value = request(db, controllerId, input, true)
  const before = db.transaction(() => readProjectSourceAuthority(db, value)).immediate()
  const assertAuthority = (): void => {
    const current = readProjectSourceAuthority(db, value)
    if (
      canonicalH2Json(current.source) !== canonicalH2Json(before.source) ||
      canonicalH2Json(current.target) !== canonicalH2Json(before.target)
    )
      throw new ProjectTargetError('PROJECT_TARGET_AUTHORITY_CHANGED')
  }
  const existing = new TargetEnrollmentRepository(db).get({
    controller_id: controllerId,
    app_id: value.app_id,
    ownership_generation: value.expected_ownership_generation
  })
  if (existing && existing.target_root !== value.target_root)
    throw new ProjectTargetError('PROJECT_TARGET_CONFLICT')
  await enrollProductTarget(
    db,
    controllerId,
    directory,
    {
      format: 1,
      controller_id: controllerId,
      app_id: value.app_id,
      ownership_generation: value.expected_ownership_generation,
      artifact: value.artifact,
      manifest_sha256: value.manifest_sha256,
      target_root: value.target_root
    },
    signal,
    assertAuthority
  )
  if (db.inTransaction) throw new ProjectTargetError('PROJECT_TARGET_REQUEST_INVALID')
  return db
    .transaction(() => {
      assertAuthority()
      return state(db, directory, value)
    })
    .immediate()
}
