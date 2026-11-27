import { z } from 'zod'
import { posix } from 'node:path'
import type { ControllerUpgradeResult } from '../../../../docs/contracts/product-controller-upgrade'

const uuid = z.uuidv4().refine((v) => v === v.toLowerCase())
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const path = z
  .string()
  .max(512)
  .regex(/^\/[A-Za-z0-9_./-]+$/)
  .refine((v) => posix.resolve(v) === v)
export const controllerUpgradeResultSchema = z.strictObject({
  format: z.literal(1),
  request_key: uuid,
  installation_request_key: uuid,
  controller_id: uuid,
  parent_upgrade_key: uuid.nullable(),
  parent_release_sha256: hash,
  release_sha256: hash,
  payload_sha256: hash,
  runtime_release_sha256: hash,
  runtime_payload_sha256: hash,
  runtime_upgrade_key: uuid.nullable(),
  phase: z.enum([
    'prepared',
    'staging',
    'staged',
    'stop_pending',
    'stopped',
    'switch_pending',
    'switched',
    'start_pending',
    'commit_pending',
    'active',
    'rollback_pending',
    'rollback_commit_pending',
    'rolled_back'
  ]),
  is_current: z.boolean(),
  service_state: z.enum(['running', 'maintenance', 'stopped', 'failed', 'not_current']),
  runtime_uid: z.number().int().min(1).max(2147483647),
  artifact_path: path,
  node_path: path,
  data_directory: path
}) satisfies z.ZodType<ControllerUpgradeResult>

/** Gate dùng bởi trusted root composition; cached/historical result không có quyền admin. */
export function assertControllerUpgradeAdminReady(
  value: unknown
): asserts value is ControllerUpgradeResult {
  const parsed = controllerUpgradeResultSchema.safeParse(value)
  if (
    !parsed.success ||
    !parsed.data.is_current ||
    !['active', 'rolled_back'].includes(parsed.data.phase) ||
    parsed.data.service_state !== 'running'
  )
    throw Error('CONTROLLER_INSTALL_UPGRADE_ADMIN_NOT_READY')
}
