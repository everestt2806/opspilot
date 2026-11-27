import type { ProductProjectConfigurationContext } from '../../../../docs/contracts/product-postgres'
import type { DesktopProjectSetups } from './desktopProjectSetup'
import type { DesktopControllerEnrollment } from './desktopControllerEnrollment'
import type { DesktopProductPostgres } from './desktopProductPostgres'
import { DesktopPostgresError } from './desktopProductPostgres'
import type { DesktopEnvironmentSelections } from './desktopEnvironmentSelections'
import { projectConfigurationContextSchema } from './productPostgres'
import { canonicalH2Json } from './productH2Proof'

/** Main-only composition. Metadata plus an own authenticated current receipt,
 * never an implicit adoption of changes made by another desktop/operator.
 */
export async function readOwnedDesktopConfiguration(
  key: string,
  projects: Pick<DesktopProjectSetups, 'registeredContextSnapshot'>,
  admin: Pick<DesktopControllerEnrollment, 'postgresContext'>,
  postgres: Pick<DesktopProductPostgres, 'confirmsSource'>,
  environment: Pick<DesktopEnvironmentSelections, 'confirmsSource'>
): Promise<ProductProjectConfigurationContext> {
  const basis = projects.registeredContextSnapshot(key),
    s = basis.setup,
    r = basis.registration
  const input = {
    format: 1 as const,
    controller_id: s.controller_id,
    app_id: r.app_id,
    expected_ownership_generation: r.ownership_generation,
    expected_source_generation: r.source_generation,
    expected_source_config_sha256: r.source_config_sha256,
    expected_target_security_revision: s.target_security_revision
  }
  const remote = projectConfigurationContextSchema.parse(
    await admin.postgresContext(s.binding_id, input)
  )
  if (
    remote.controller_id !== s.controller_id ||
    remote.scope.app_id !== r.app_id ||
    remote.scope.ownership_generation !== r.ownership_generation ||
    remote.scope.target.vps_id !== s.target_vps_id ||
    remote.scope.target.ssh_security_revision !== s.target_security_revision ||
    remote.basis_source_generation !== r.source_generation ||
    remote.basis_source_config_sha256 !== r.source_config_sha256 ||
    [
      remote.database.prepared,
      remote.database.selected,
      remote.environment.latest,
      remote.environment.selected
    ].some((value) => value && value.framework !== s.framework)
  )
    throw new DesktopPostgresError('POSTGRES_CHANGED')
  if (
    (remote.source_generation !== r.source_generation ||
      remote.source_config_sha256 !== r.source_config_sha256) &&
    !(await postgres.confirmsSource(key, remote)) &&
    !(await environment.confirmsSource(key, remote))
  )
    throw new DesktopPostgresError('POSTGRES_CHANGED')
  // ENV receipt lookup has no is_current field. Re-read the monotonic source after
  // either receipt proof; a stale positive receipt cannot authorize another source.
  const after = projectConfigurationContextSchema.parse(
    await admin.postgresContext(s.binding_id, input)
  )
  if (
    canonicalH2Json(after) !== canonicalH2Json(remote) ||
    canonicalH2Json(projects.registeredContextSnapshot(key)) !== canonicalH2Json(basis)
  )
    throw new DesktopPostgresError('POSTGRES_CHANGED')
  return remote
}
