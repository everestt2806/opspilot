import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { ProductPostgresRepository } from '../db/productPostgresRepository'
import {
  loadControllerCredentialCipher,
  resolveControllerSecretDirectory
} from './controllerSecrets'
import { readReleaseFile } from './controllerRelease'
import {
  postgresPrepareSchema,
  postgresStateSchema,
  postgresSelectionCommandSchema,
  ProductPostgresError
} from './productPostgres'
import { assertControllerRuntimeSchema } from './controllerUpgradeCheck'
import { ProductPostgresCommands } from './productPostgresCommands'
import { verifyControllerBundle } from './controllerBundle'

/** Requires explicit schema037. Never migrates an existing controller or creates a key. */
export async function runProductPostgresCli(
  command:
    | 'prepare-managed-postgres'
    | 'managed-postgres-state'
    | 'managed-postgres-review'
    | 'select-managed-postgres'
    | 'managed-postgres-selection-state',
  directory: string,
  input: unknown,
  signal?: AbortSignal
): Promise<void> {
  if (process.platform !== 'linux') throw Error('PRODUCT_POSTGRES_LINUX_REQUIRED')
  if (signal?.aborted) throw Error('PRODUCT_POSTGRES_ABORTED')
  const root = resolveControllerSecretDirectory(directory),
    path = join(root, 'opspilot.db'),
    info = lstatSync(path)
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o077) !== 0
  )
    throw Error('PRODUCT_POSTGRES_DATABASE_UNSAFE')
  try {
    assertControllerRuntimeSchema(root, 37)
  } catch {
    throw Error('PRODUCT_POSTGRES_SCHEMA_UNSUPPORTED')
  }
  const validation = new Database(path, { readonly: true, fileMustExist: true, timeout: 5000 })
  try {
    const expected = [...Array.from({ length: 29 }, (_, i) => i + 1), 32, 33, 35, 37]
    const versions = (
      validation.prepare('SELECT version FROM schema_version ORDER BY version').all() as {
        version: number
      }[]
    ).map((r) => r.version)
    if (JSON.stringify(versions) !== JSON.stringify(expected))
      throw Error('PRODUCT_POSTGRES_SCHEMA_UNSUPPORTED')
    const count = validation
      .prepare(
        "SELECT count(*) n FROM sqlite_master WHERE type='table' AND name IN ('product_managed_postgres','product_managed_postgres_request')"
      )
      .get() as { n: number }
    if (count.n !== 2) throw Error('PRODUCT_POSTGRES_SCHEMA_UNSUPPORTED')
  } finally {
    validation.close()
  }
  const marker = JSON.parse(
    readReleaseFile(join(root, '.product-controller-initialized'), 512).toString('utf8')
  ) as { format?: unknown; controller_id?: unknown }
  if (signal?.aborted) throw Error('PRODUCT_POSTGRES_ABORTED')
  const db = new Database(path, {
    readonly: command !== 'prepare-managed-postgres' && command !== 'select-managed-postgres',
    fileMustExist: true,
    timeout: 5000
  })
  try {
    const controllers = db.prepare('SELECT controller_id,status FROM product_controller').all() as {
      controller_id: string
      status: string
    }[]
    if (
      marker.format !== 1 ||
      controllers.length !== 1 ||
      controllers[0].status !== 'active' ||
      marker.controller_id !== controllers[0].controller_id
    )
      throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
    if (
      command === 'managed-postgres-review' ||
      command === 'select-managed-postgres' ||
      command === 'managed-postgres-selection-state'
    ) {
      const request = postgresSelectionCommandSchema.safeParse(input)
      if (!request.success || request.data.selection.scope.controller_id !== marker.controller_id)
        throw new ProductPostgresError('PRODUCT_POSTGRES_INPUT_INVALID')
      const bundle = verifyControllerBundle(request.data.artifact, request.data.manifest_sha256)
      db.pragma('foreign_keys=ON')
      if (command === 'select-managed-postgres') db.pragma('synchronous=FULL')
      const commands = new ProductPostgresCommands(
        db,
        loadControllerCredentialCipher(root),
        root,
        controllers[0].controller_id,
        `unix:${process.getuid!()}`,
        bundle
      )
      const result =
        command === 'managed-postgres-review'
          ? await commands.review(request.data.selection, signal)
          : command === 'managed-postgres-selection-state'
            ? commands.lookup(request.data.selection)
            : await commands.select(request.data.selection, signal)
      console.log(JSON.stringify(result))
      return
    }
    const parsed = (
      command === 'prepare-managed-postgres' ? postgresPrepareSchema : postgresStateSchema
    ).safeParse(input)
    if (!parsed.success || parsed.data.scope.controller_id !== marker.controller_id)
      throw new ProductPostgresError('PRODUCT_POSTGRES_INPUT_INVALID')
    db.pragma('foreign_keys=ON')
    if (command === 'prepare-managed-postgres') db.pragma('synchronous=FULL')
    const repository = new ProductPostgresRepository(db, loadControllerCredentialCipher(root))
    console.log(
      JSON.stringify(
        command === 'prepare-managed-postgres'
          ? repository.prepare(
              parsed.data,
              controllers[0].controller_id,
              `unix:${process.getuid!()}`
            )
          : { metadata: repository.state(parsed.data) }
      )
    )
  } finally {
    db.close()
  }
}
