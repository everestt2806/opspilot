import type Database from 'better-sqlite3'
import type { AesGcmCredentialCipher } from '../../src/main/crypto/credentialCipher'
import type { DesktopControllerVault } from '../../src/main/controlPlane/desktopControllerVault'
import { fixture as environmentFixture } from '../product-environment-desktop-lab/fixture'
import { ProductPostgresRepository } from '../../src/main/db/productPostgresRepository'
import { ProductPostgresSelection } from '../../src/main/controlPlane/productPostgresSelection'
import { readProjectConfigurationContext } from '../../src/main/controlPlane/projectConfigurationContext'
import { DesktopProductPostgres } from '../../src/main/controlPlane/desktopProductPostgres'
import { DesktopProjectSetups } from '../../src/main/controlPlane/desktopProjectSetup'
import { DesktopProductEnvironment } from '../../src/main/controlPlane/desktopProductEnvironment'
import { DesktopEnvironmentSelections } from '../../src/main/controlPlane/desktopEnvironmentSelections'
import { readOwnedDesktopConfiguration } from '../../src/main/controlPlane/desktopConfigurationAuthority'
import type { ProductProjectConfigurationContext } from '../../../docs/contracts/product-postgres'
import type { DesktopControllerEnrollment } from '../../src/main/controlPlane/desktopControllerEnrollment'

type PostgresAdmin = Pick<
  DesktopControllerEnrollment,
  | 'postgresContext'
  | 'preparePostgres'
  | 'postgresPrepareState'
  | 'reviewPostgres'
  | 'selectPostgres'
  | 'postgresSelectionState'
>
/** Synthetic transport only; real independent SQLite/ciphers/journals. Native SSH admin
 * and installed Root/service lifecycle are separate gates, never claimed by this fixture.
 */
export async function fixture(directory: string): Promise<
  Awaited<ReturnType<typeof environmentFixture>> & {
    postgres: DesktopProductPostgres
    pgAdmin: PostgresAdmin
    environmentSelections: DesktopEnvironmentSelections
  }
> {
  const f = await environmentFixture(directory),
    store = new ProductPostgresRepository(f.remote, f.remoteCipher)
  const pgAdmin: PostgresAdmin = {
    postgresContext: async (_id, input) =>
      readProjectConfigurationContext(f.remote, f.remoteCipher, f.controllerId, 'unix:1000', input),
    preparePostgres: async (_id, input, guard) => {
      guard()
      return store.prepare(input, f.controllerId, 'unix:1000')
    },
    postgresPrepareState: async (_id, input) =>
      store.lookupPrepare(input, f.controllerId, 'unix:1000'),
    reviewPostgres: async (_id, input) =>
      new ProductPostgresSelection(f.remote, f.remoteCipher).review(
        input,
        f.controllerId,
        'unix:1000'
      ),
    selectPostgres: async (_id, input, guard) => {
      guard()
      return new ProductPostgresSelection(f.remote, f.remoteCipher).select(
        input,
        f.controllerId,
        'unix:1000'
      )
    },
    postgresSelectionState: async (_id, input) =>
      new ProductPostgresSelection(f.remote, f.remoteCipher).lookup(
        input,
        f.controllerId,
        'unix:1000'
      )
  }
  return { ...f, ...composeDesktop(f.db, f.cipher, f.vault, f.admin, pgAdmin), pgAdmin }
}

export function composeDesktop(
  db: Database.Database,
  cipher: AesGcmCredentialCipher,
  vault: DesktopControllerVault,
  environmentAdmin: Awaited<ReturnType<typeof environmentFixture>>['admin'],
  pgAdmin: PostgresAdmin
): {
  projects: DesktopProjectSetups
  main: DesktopProductEnvironment
  postgres: DesktopProductPostgres
  environmentSelections: DesktopEnvironmentSelections
} {
  const configurationContext = (key: string): Promise<ProductProjectConfigurationContext> =>
    readOwnedDesktopConfiguration(key, projects, pgAdmin, postgres, environmentSelections)
  // Registration was already exercised by the base fixture. This reader-only
  // composition must fail if a test accidentally claims target/Git integration.
  const unsupported = async (): Promise<never> => {
    throw Error('SYNTHETIC_READER_ONLY_FIXTURE')
  }
  const projects = new DesktopProjectSetups(
    db,
    vault,
    {
      environmentReview: environmentAdmin.environmentReview,
      projectTargets: unsupported,
      registerProject: unsupported,
      verifyProjectSource: unsupported,
      projectTargetState: unsupported,
      enrollProjectTarget: unsupported
    },
    { configurationContext }
  )
  const main = new DesktopProductEnvironment(db, cipher, vault, projects, environmentAdmin, {
    configurationContext
  })
  const environmentSelections = new DesktopEnvironmentSelections(
    db,
    cipher,
    vault,
    projects,
    main,
    environmentAdmin
  )
  const postgres = new DesktopProductPostgres(db, cipher, vault, projects, pgAdmin)
  return { projects, main, postgres, environmentSelections }
}
