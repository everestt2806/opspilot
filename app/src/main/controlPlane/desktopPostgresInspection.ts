import { z } from 'zod'
import type {
  DesktopPostgresInspectionInput,
  DesktopPostgresInspectionResult
} from '@shared/desktopPostgresInspection'
import type { ProductProjectConfigurationContext } from '../../../../docs/contracts/product-postgres'
import type { ProductPostgresInspectionRequest } from '../../../../docs/contracts/product-postgres-inspection'
import type { DesktopProjectSetups } from './desktopProjectSetup'
import type { DesktopControllerVault } from './desktopControllerVault'
import type { DesktopControllerEnrollment } from './desktopControllerEnrollment'
import { DesktopPostgresError } from './desktopProductPostgres'
import { canonicalH2Json } from './productH2Proof'
import {
  postgresInspectionOperationSchema,
  validatePostgresInspectionResult
} from './productPostgresInspectorCommands'

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
export const desktopPostgresInspectionSchema = z.strictObject({
  project_request_key: z.uuidv4(),
  expected_binding_revision: positive,
  expected_source_generation: positive,
  expected_source_config_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  database_id: z.uuidv4(),
  read: postgresInspectionOperationSchema
}) satisfies z.ZodType<DesktopPostgresInspectionInput>

/** Ephemeral read: use the same positive source-selection receipts as deployment,
 * but never claim a job, pause policy, persist sample data or create an intent.
 */
export class DesktopPostgresInspection {
  constructor(
    private readonly projects: Pick<DesktopProjectSetups, 'registeredContextSnapshot'>,
    private readonly vault: Pick<DesktopControllerVault, 'resolve' | 'get'>,
    private readonly configuration: (key: string) => Promise<ProductProjectConfigurationContext>,
    private readonly admin: Pick<DesktopControllerEnrollment, 'inspectPostgres'>
  ) {}
  async read(input: DesktopPostgresInspectionInput): Promise<DesktopPostgresInspectionResult> {
    const parsed = desktopPostgresInspectionSchema.safeParse(input)
    if (!parsed.success) throw new DesktopPostgresError('POSTGRES_REQUEST_INVALID')
    const value = parsed.data
    const project = this.projects.registeredContextSnapshot(value.project_request_key)
    const binding = this.vault.resolve(project.setup.binding_id)
    const guard = (): void => {
      const current = this.vault.resolve(project.setup.binding_id)
      const scopes = this.vault.get(project.setup.binding_id).client?.scopes ?? []
      if (
        canonicalH2Json(this.projects.registeredContextSnapshot(value.project_request_key)) !==
          canonicalH2Json(project) ||
        current.controllerId !== project.setup.controller_id ||
        current.revision !== project.setup.binding_revision ||
        current.revision !== value.expected_binding_revision ||
        current.revision !== binding.revision ||
        current.accessToken !== binding.accessToken ||
        !(['read', 'deploy:manual', 'policy:write'] as const).every((scope) =>
          scopes.includes(scope)
        )
      )
        throw new DesktopPostgresError('POSTGRES_CHANGED')
    }
    guard()
    const before = await this.configuration(value.project_request_key)
    guard()
    const selected = before.database.selected
    if (!selected) throw new DesktopPostgresError('POSTGRES_UNAVAILABLE')
    if (
      before.controller_id !== project.setup.controller_id ||
      before.scope.app_id !== project.registration.app_id ||
      before.scope.ownership_generation !== project.registration.ownership_generation ||
      before.scope.target.vps_id !== project.setup.target_vps_id ||
      before.scope.target.ssh_security_revision !== project.setup.target_security_revision ||
      before.source_generation !== value.expected_source_generation ||
      before.source_config_sha256 !== value.expected_source_config_sha256 ||
      selected.database_id !== value.database_id ||
      selected.controller_id !== before.controller_id ||
      selected.app_id !== before.scope.app_id ||
      selected.ownership_generation !== before.scope.ownership_generation
    )
      throw new DesktopPostgresError('POSTGRES_CHANGED')
    const request: ProductPostgresInspectionRequest = {
      context: {
        format: 1,
        controller_id: before.controller_id,
        app_id: before.scope.app_id,
        expected_ownership_generation: before.scope.ownership_generation,
        expected_source_generation: before.source_generation,
        expected_source_config_sha256: before.source_config_sha256,
        expected_target_security_revision: before.scope.target.ssh_security_revision,
        database_id: selected.database_id
      },
      read: value.read
    }
    const result = await this.admin.inspectPostgres(project.setup.binding_id, request, guard)
    guard()
    let after: ProductProjectConfigurationContext
    try {
      after = await this.configuration(value.project_request_key)
    } catch {
      // Data cannot be released if current authority cannot be re-established.
      throw new DesktopPostgresError('POSTGRES_CHANGED')
    }
    guard()
    if (canonicalH2Json(before) !== canonicalH2Json(after))
      throw new DesktopPostgresError('POSTGRES_CHANGED')
    return {
      ...validatePostgresInspectionResult(result, request),
      project_request_key: value.project_request_key,
      binding_id: project.setup.binding_id,
      binding_revision: binding.revision
    }
  }
}
