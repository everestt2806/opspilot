import { dirname, join, resolve } from 'node:path'
import { fstatSync, lstatSync, realpathSync } from 'node:fs'
import { assertReleaseDirectory } from './controllerRelease'
import {
  controllerSchemaCommandSchema,
  controllerPostgresSchemaCommandSchema
} from './controllerSchemaUpgradeProtocol'
import { readControllerBootstrapInput } from './controllerBootstrapInput'
import {
  backupControllerSchema,
  transitionControllerSchema,
  transitionControllerPostgresSchema
} from './controllerSchemaUpgrade'

export const CONTROLLER_SCHEMA_COMMANDS = [
  'upgrade-schema-backup',
  'upgrade-schema-apply',
  'upgrade-schema-inspect-rollback',
  'upgrade-schema-rollback',
  'upgrade-postgres-schema-backup',
  'upgrade-postgres-schema-apply',
  'upgrade-postgres-schema-inspect-rollback',
  'upgrade-postgres-schema-rollback'
] as const
const fail = (): never => {
  throw Error('CONTROLLER_INSTALL_SCHEMA_AUTHORITY_INVALID')
}
/** Only an installed root revision may name its adjacent backup. No input path override. */
export function controllerSchemaBackupDirectory(requestKey: string, postgres = false): string {
  if (process.platform !== 'linux' || !process.getuid?.()) return fail()
  const artifact = resolve(process.argv[1]),
    revision = dirname(dirname(dirname(artifact))),
    installation = dirname(dirname(revision))
  if (
    artifact !== join(revision, 'runtime/payload/control-plane.cjs') ||
    dirname(revision) !== join(installation, 'revisions') ||
    revision !== join(installation, 'revisions', requestKey) ||
    realpathSync(artifact) !== artifact
  )
    return fail()
  for (const path of [installation, dirname(revision), revision]) {
    assertReleaseDirectory(path, 0)
    if (lstatSync(path).uid !== 0) return fail()
  }
  // The Root upgrader verifies marker bytes. The service may stat, never read, this0600 file.
  const marker = lstatSync(join(revision, '.controller-upgrade'))
  if (
    !marker.isFile() ||
    marker.isSymbolicLink() ||
    marker.uid !== 0 ||
    marker.nlink !== 1 ||
    (marker.mode & 0o777) !== 0o600
  )
    return fail()
  const lock = fstatSync(3)
  // Descriptor3 is inherited from the Root installation flock, not an arbitrary caller file.
  if (!lock.isFile() || lock.uid !== 0 || lock.nlink !== 1 || (lock.mode & 0o777) !== 0o600)
    return fail()
  return join(revision, postgres ? 'postgres-schema-backup' : 'schema-backup')
}
export async function runControllerSchemaUpgrade(
  command: string,
  dataDirectory: string
): Promise<void> {
  const abort = new AbortController(),
    postgres = command.startsWith('upgrade-postgres-schema-'),
    parsed = (
      postgres ? controllerPostgresSchemaCommandSchema : controllerSchemaCommandSchema
    ).safeParse(await readControllerBootstrapInput(process.stdin, abort.signal))
  if (
    !parsed.success ||
    !CONTROLLER_SCHEMA_COMMANDS.includes(command as (typeof CONTROLLER_SCHEMA_COMMANDS)[number])
  )
    return fail()
  const input = parsed.data,
    backup = controllerSchemaBackupDirectory(input.request_key, postgres)
  if (command.endsWith('-backup')) {
    if (input.backup || input.rollback_projection) return fail()
    console.log(
      JSON.stringify(
        await backupControllerSchema(
          dataDirectory,
          backup,
          input.request_key,
          input.expected,
          postgres ? 35 : 29
        )
      )
    )
    return
  }
  if (!input.backup || input.backup.request_key !== input.request_key) return fail()
  const operation = command.endsWith('-apply')
    ? 'apply'
    : command === 'upgrade-schema-rollback' || command === 'upgrade-postgres-schema-rollback'
      ? 'revert'
      : 'can-revert'
  if (operation !== 'revert' && input.rollback_projection) return fail()
  console.log(
    JSON.stringify(
      (postgres ? transitionControllerPostgresSchema : transitionControllerSchema)(
        dataDirectory,
        backup,
        input.backup,
        input.expected,
        operation,
        input.rollback_projection
      )
    )
  )
}
