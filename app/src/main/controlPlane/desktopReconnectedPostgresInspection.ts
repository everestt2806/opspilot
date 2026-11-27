import { z } from 'zod'
import type {
  DesktopReconnectedPostgresInspectionInput,
  DesktopReconnectedPostgresInspectionResult
} from '@shared/desktopReconnectedPostgresInspection'
import type { ProductPostgresInspectionRequest } from '../../../../docs/contracts/product-postgres-inspection'
import type { DesktopProjectReconnections } from './desktopProjectReconnection'
import type { DesktopControllerEnrollment } from './desktopControllerEnrollment'
import { DesktopPostgresError } from './desktopProductPostgres'
import { canonicalH2Json } from './productH2Proof'
import {
  postgresInspectionOperationSchema,
  validatePostgresInspectionResult
} from './productPostgresInspectorCommands'

export const reconnectedPostgresInspectionSchema = z.strictObject({
  reconnection_request_key: z.uuidv4(),
  expected_binding_revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  expected_snapshot_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  database_id: z.uuidv4(),
  read: postgresInspectionOperationSchema
}) satisfies z.ZodType<DesktopReconnectedPostgresInspectionInput>

/** Consent hiện hành là authority riêng; không đọc/tạo receipt registration038. */
export class DesktopReconnectedPostgresInspection {
  constructor(
    private readonly reconnections: Pick<DesktopProjectReconnections, 'get' | 'current'>,
    private readonly admin: Pick<DesktopControllerEnrollment, 'inspectPostgres'>
  ) {}
  async read(
    input: DesktopReconnectedPostgresInspectionInput
  ): Promise<DesktopReconnectedPostgresInspectionResult> {
    const parsed = reconnectedPostgresInspectionSchema.safeParse(input)
    if (!parsed.success) throw new DesktopPostgresError('POSTGRES_REQUEST_INVALID')
    const value = parsed.data
    const before = await this.reconnections.current(value.reconnection_request_key)
    const context = before.context,
      selected = context.selected_database
    if (
      before.binding_revision !== value.expected_binding_revision ||
      before.snapshot_sha256 !== value.expected_snapshot_sha256 ||
      !selected ||
      selected.database_id !== value.database_id ||
      selected.controller_id !== before.controller_id ||
      selected.app_id !== before.app_id ||
      selected.ownership_generation !== context.scope.ownership_generation
    )
      throw new DesktopPostgresError('POSTGRES_CHANGED')
    const guard = (): void => {
      if (canonicalH2Json(this.reconnections.get(before.request_key)) !== canonicalH2Json(before))
        throw new DesktopPostgresError('POSTGRES_CHANGED')
    }
    guard()
    const request: ProductPostgresInspectionRequest = {
      context: {
        format: 1,
        controller_id: before.controller_id,
        app_id: before.app_id,
        expected_ownership_generation: context.scope.ownership_generation,
        expected_source_generation: context.source.generation,
        expected_source_config_sha256: context.source.config_sha256,
        expected_target_security_revision: context.scope.target.ssh_security_revision,
        database_id: selected.database_id
      },
      read: value.read
    }
    const result = await this.admin.inspectPostgres(before.binding_id, request, guard)
    guard()
    const after = await this.reconnections.current(before.request_key)
    guard()
    if (canonicalH2Json(before) !== canonicalH2Json(after))
      throw new DesktopPostgresError('POSTGRES_CHANGED')
    return {
      ...validatePostgresInspectionResult(result, request),
      reconnection_request_key: before.request_key,
      binding_id: before.binding_id,
      binding_revision: before.binding_revision,
      snapshot_sha256: before.snapshot_sha256
    }
  }
}
