import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import SqliteDatabase from 'better-sqlite3'
import { z } from 'zod'
import type Database from 'better-sqlite3'
import type {
  ProductTargetHelperUpgradePreparation,
  ProductTargetHelperUpgradeReview
} from '../../../../docs/contracts/product-target-helper-upgrade'
import { canonicalH2Json } from './productH2Proof'
import { resolveControllerSecretDirectory } from './controllerSecrets'
import { loadControllerRuntimeKey } from './controllerRuntimeKeys'
import {
  TARGET_HELPER_UPGRADE_PENDING_PREFIX,
  TargetEnrollmentRepository,
  type TargetEnrollmentRow
} from './targetEnrollmentRepository'
import { readEnrolledProductTarget } from './targetEnrollment'
import {
  readTargetHelperUpgradeAuthority,
  reviewProductTargetHelperUpgrade,
  targetHelperUpgradeReviewInputSchema
} from './targetHelperUpgradeReview'
import { assertControllerRuntimeSchema } from './controllerUpgradeCheck'
import { readReleaseFile } from './controllerRelease'

const DOMAIN = 'opspilot-target-helper-upgrade-intent-v1\n'
const CAP = 128 * 1024
const sha = z.string().regex(/^[a-f0-9]{64}$/)
const uuid = z.uuidv4().refine((value) => value === value.toLowerCase())
const digest = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex')
export const targetHelperUpgradePrepareSchema = targetHelperUpgradeReviewInputSchema.extend({
  request_key: uuid,
  expected_review_sha256: sha,
  confirm: z.literal(true)
})
export const targetHelperUpgradeLookupSchema = targetHelperUpgradeReviewInputSchema
  .pick({
    format: true,
    controller_id: true,
    app_id: true,
    ownership_generation: true
  })
  .extend({ request_key: uuid })
const asset = z.strictObject({
  size: z
    .number()
    .int()
    .positive()
    .max(512 * 1024),
  sha256: sha
})
const reviewSchema = z.strictObject({
  format: z.literal(1),
  purpose: z.literal('product-target-helper-upgrade-review'),
  controller_id: z.string(),
  app_id: z.number().int().positive(),
  ownership_generation: z.number().int().positive(),
  from_manifest_sha256: sha,
  to_manifest_sha256: sha,
  authority_sha256: sha,
  review_sha256: sha,
  changes: z
    .array(
      z.strictObject({
        path: z.literal('target-helper/target_product_runtime.py'),
        before: asset,
        after: asset
      })
    )
    .length(1),
  apply_available: z.literal(false)
})
const rowSchema = z.strictObject({
  controller_id: z.string(),
  app_id: z.number().int().positive(),
  ownership_generation: z.number().int().positive(),
  target_binding_json: z.string().max(4096),
  manifest_sha256: sha,
  target_root: z.string().max(512),
  state: z.literal('enrolled'),
  revision: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER - 1),
  receipt_json: z.string().min(1).max(16384),
  last_error_code: z.null(),
  created_at: z.string(),
  updated_at: z.string()
})
const intentSchema = z.strictObject({
  format: z.literal(1),
  purpose: z.literal('product-target-helper-upgrade-intent'),
  administrator_identity: z.string().regex(/^unix:(0|[1-9][0-9]{0,15})$/),
  request: targetHelperUpgradePrepareSchema,
  body_sha256: sha,
  review: reviewSchema,
  original_enrollment: rowSchema,
  created_at: z.iso.datetime()
})
type Intent = z.infer<typeof intentSchema>
type Identity = z.infer<typeof targetHelperUpgradeLookupSchema>
const envelopeSchema = z.strictObject({ intent: intentSchema, signature: sha })
function reject(code: string): never {
  throw Error('TARGET_HELPER_UPGRADE_' + code)
}
const signature = (intent: Intent, key: Buffer): string =>
  createHmac('sha256', key).update(DOMAIN).update(canonicalH2Json(intent)).digest('hex')

function privateDirectory(path: string): void {
  const info = lstatSync(path)
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (process.platform !== 'win32' &&
      (info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o700))
  )
    reject('JOURNAL_UNSAFE')
}
function syncDirectory(path: string): void {
  if (process.platform === 'win32') return // Operational CLI is Linux-only; native lab verifies fsync.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY)
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}
function journalPaths(
  directory: string,
  identity: Identity
): { root: string; file: string; parent: string } {
  const parent = resolveControllerSecretDirectory(directory)
  privateDirectory(parent)
  const root = join(parent, 'target-helper-upgrades')
  const slot = digest(
    canonicalH2Json({
      controller_id: identity.controller_id,
      app_id: identity.app_id,
      ownership_generation: identity.ownership_generation
    })
  )
  return { parent, root, file: join(root, `${slot}-${identity.request_key}.json`) }
}
function readIntent(directory: string, identity: Identity, key: Buffer): Intent | undefined {
  const { root, file } = journalPaths(directory, identity)
  try {
    privateDirectory(root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  let fd: number
  try {
    fd = openSync(
      file,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    return reject('JOURNAL_UNSAFE')
  }
  try {
    const before = fstatSync(fd)
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.size < 1 ||
      before.size > CAP ||
      (process.platform !== 'win32' &&
        (before.uid !== process.getuid?.() || (before.mode & 0o777) !== 0o600))
    )
      reject('JOURNAL_UNSAFE')
    const bounded = Buffer.alloc(before.size + 1)
    let count = 0
    while (count < bounded.length) {
      const n = readSync(fd, bounded, count, bounded.length - count, null)
      if (!n) break
      count += n
    }
    const bytes = bounded.subarray(0, count)
    const after = fstatSync(fd),
      path = lstatSync(file)
    if (
      bytes.length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      path.isSymbolicLink() ||
      path.ino !== before.ino ||
      path.dev !== before.dev ||
      path.nlink !== 1
    )
      reject('JOURNAL_UNSAFE')
    const parsed = envelopeSchema.safeParse(JSON.parse(bytes.toString('utf8')))
    if (!parsed.success) reject('JOURNAL_INVALID')
    const { intent, signature: mac } = parsed.data
    if (
      key.length !== 32 ||
      !timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(signature(intent, key), 'hex'))
    )
      reject('JOURNAL_INVALID')
    if (canonicalH2Json(identityOf(intent.request)) !== canonicalH2Json(identity)) {
      reject('JOURNAL_INVALID')
    }
    return intent
  } catch (error) {
    if (error instanceof Error && /^TARGET_HELPER_UPGRADE_[A-Z_]+$/.test(error.message)) throw error
    return reject('JOURNAL_INVALID')
  } finally {
    closeSync(fd)
  }
}
function identityOf(input: Identity): Identity {
  return {
    format: 1,
    controller_id: input.controller_id,
    app_id: input.app_id,
    ownership_generation: input.ownership_generation,
    request_key: input.request_key
  }
}
function publishIntent(directory: string, intent: Intent, key: Buffer): void {
  const paths = journalPaths(directory, identityOf(intent.request))
  try {
    mkdirSync(paths.root, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  privateDirectory(paths.root)
  syncDirectory(paths.parent)
  const stage = paths.file + '.stage-' + randomBytes(12).toString('hex')
  const bytes = Buffer.from(canonicalH2Json({ intent, signature: signature(intent, key) }) + '\n')
  if (bytes.length > CAP) reject('JOURNAL_INVALID')
  const fd = openSync(
    stage,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o600
  )
  let linked = false
  try {
    writeFileSync(fd, bytes)
    fsyncSync(fd)
    linkSync(stage, paths.file) // Kernel no-replace publication; existing/corrupt intent is never overwritten.
    linked = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  } finally {
    closeSync(fd)
    unlinkSync(stage)
    syncDirectory(paths.root)
  }
  if (!linked) {
    const existing = readIntent(directory, identityOf(intent.request), key)
    if (
      !existing ||
      existing.body_sha256 !== intent.body_sha256 ||
      existing.administrator_identity !== intent.administrator_identity
    )
      reject('REQUEST_CONFLICT')
  }
}

function assertIntentBinding(intent: Intent, identity: Identity, administrator: string): void {
  const { request, review, original_enrollment: row } = intent
  const { review_sha256: reviewHash, ...reviewBody } = review
  if (
    canonicalH2Json(identityOf(request)) !== canonicalH2Json(identity) ||
    intent.administrator_identity !== administrator ||
    digest(canonicalH2Json(request)) !== intent.body_sha256 ||
    digest(canonicalH2Json(reviewBody)) !== reviewHash ||
    request.expected_review_sha256 !== reviewHash ||
    review.controller_id !== request.controller_id ||
    review.app_id !== request.app_id ||
    review.ownership_generation !== request.ownership_generation ||
    row.controller_id !== request.controller_id ||
    row.app_id !== request.app_id ||
    row.ownership_generation !== request.ownership_generation ||
    row.manifest_sha256 !== review.from_manifest_sha256 ||
    request.manifest_sha256 !== review.to_manifest_sha256 ||
    digest(request.retained_manifest) !== row.manifest_sha256
  )
    reject('JOURNAL_INVALID')
}
function view(
  intent: Intent,
  state: 'intent_only' | 'pending'
): ProductTargetHelperUpgradePreparation {
  return {
    format: 1,
    purpose: 'product-target-helper-upgrade-preparation',
    request_key: intent.request.request_key,
    controller_id: intent.request.controller_id,
    app_id: intent.request.app_id,
    ownership_generation: intent.request.ownership_generation,
    state,
    review_sha256: intent.review.review_sha256,
    from_manifest_sha256: intent.review.from_manifest_sha256,
    to_manifest_sha256: intent.review.to_manifest_sha256,
    apply_available: false
  }
}
function pendingState(database: Database.Database, intent: Intent): 'intent_only' | 'pending' {
  const expected = intent.original_enrollment
  const row = new TargetEnrollmentRepository(database).get(intent.request)
  if (!row) return reject('AUTHORITY_CHANGED')
  if (canonicalH2Json(row) === canonicalH2Json(expected)) {
    if (
      readTargetHelperUpgradeAuthority(database, intent.request) !== intent.review.authority_sha256
    )
      reject('AUTHORITY_CHANGED')
    return 'intent_only'
  }
  if (
    row.revision !== expected.revision + 1 ||
    row.state !== 'unknown' ||
    row.last_error_code !== TARGET_HELPER_UPGRADE_PENDING_PREFIX + intent.request.request_key ||
    canonicalH2Json({
      ...row,
      revision: expected.revision,
      state: expected.state,
      last_error_code: expected.last_error_code,
      updated_at: expected.updated_at
    }) !== canonicalH2Json(expected) ||
    readTargetHelperUpgradeAuthority(database, intent.request, expected as TargetEnrollmentRow) !==
      intent.review.authority_sha256
  )
    reject('AUTHORITY_CHANGED')
  return 'pending'
}

/** Internal protocol: signed intent may exist alone, but only exact SQL CAS creates the barrier. */
export function activateTargetHelperUpgradeIntent(
  database: Database.Database,
  directory: string,
  controllerId: string,
  administrator: string,
  input: unknown
): ProductTargetHelperUpgradePreparation {
  const parsed = targetHelperUpgradeLookupSchema.safeParse(input)
  if (
    !parsed.success ||
    parsed.data.controller_id !== controllerId ||
    !/^unix:(0|[1-9][0-9]{0,15})$/.test(administrator)
  )
    reject('INPUT_INVALID')
  if (database.inTransaction) reject('TRANSACTION_ACTIVE')
  const key = loadControllerRuntimeKey(directory, parsed.data)
  try {
    const intent = readIntent(directory, parsed.data, key)
    if (!intent) reject('INTENT_NOT_FOUND')
    assertIntentBinding(intent, parsed.data, administrator)
    return database
      .transaction(() => {
        const state = pendingState(database, intent)
        if (state === 'pending') return view(intent, state)
        const row = intent.original_enrollment
        const changed = database
          .prepare(
            `UPDATE product_target_enrollment SET state='unknown',last_error_code=?,revision=revision+1,updated_at=?
        WHERE controller_id=? AND app_id=? AND ownership_generation=? AND revision=? AND state='enrolled' AND last_error_code IS NULL
        AND manifest_sha256=? AND receipt_json=?`
          )
          .run(
            TARGET_HELPER_UPGRADE_PENDING_PREFIX + intent.request.request_key,
            new Date().toISOString(),
            controllerId,
            parsed.data.app_id,
            parsed.data.ownership_generation,
            row.revision,
            row.manifest_sha256,
            row.receipt_json
          ).changes
        if (changed !== 1) reject('AUTHORITY_CHANGED')
        return view(intent, 'pending')
      })
      .immediate()
  } finally {
    key.fill(0)
  }
}

/** No SSH, SQL write, key creation, journal repair or automatic resume. */
export function readTargetHelperUpgradePreparation(
  database: Database.Database,
  directory: string,
  controllerId: string,
  administrator: string,
  input: unknown
): ProductTargetHelperUpgradePreparation {
  const parsed = targetHelperUpgradeLookupSchema.safeParse(input)
  if (
    !parsed.success ||
    parsed.data.controller_id !== controllerId ||
    !/^unix:(0|[1-9][0-9]{0,15})$/.test(administrator)
  )
    reject('INPUT_INVALID')
  if (database.inTransaction) reject('TRANSACTION_ACTIVE')
  const key = loadControllerRuntimeKey(directory, parsed.data)
  try {
    const intent = readIntent(directory, parsed.data, key)
    if (!intent) reject('INTENT_NOT_FOUND')
    assertIntentBinding(intent, parsed.data, administrator)
    return database.transaction(() => view(intent, pendingState(database, intent)))()
  } finally {
    key.fill(0)
  }
}

/** Fresh authenticated review is required on first publication, explicit consent remains separate. */
export async function prepareTargetHelperUpgrade(
  database: Database.Database,
  directory: string,
  controllerId: string,
  administrator: string,
  input: unknown,
  signal?: AbortSignal
): Promise<ProductTargetHelperUpgradePreparation> {
  const parsed = targetHelperUpgradePrepareSchema.safeParse(input)
  if (
    !parsed.success ||
    parsed.data.controller_id !== controllerId ||
    !/^unix:(0|[1-9][0-9]{0,15})$/.test(administrator)
  )
    reject('INPUT_INVALID')
  if (database.inTransaction) reject('TRANSACTION_ACTIVE')
  if (signal?.aborted) reject('ABORTED')
  const request = parsed.data,
    identity = identityOf(request)
  const key = loadControllerRuntimeKey(directory, identity)
  try {
    let intent = readIntent(directory, identity, key)
    if (intent) {
      assertIntentBinding(intent, identity, administrator)
      if (intent.body_sha256 !== digest(canonicalH2Json(request))) reject('REQUEST_CONFLICT')
    } else {
      const reviewInput = {
        format: request.format,
        controller_id: controllerId,
        app_id: request.app_id,
        ownership_generation: request.ownership_generation,
        artifact: request.artifact,
        manifest_sha256: request.manifest_sha256,
        retained_manifest: request.retained_manifest
      }
      const review: ProductTargetHelperUpgradeReview = await reviewProductTargetHelperUpgrade(
        database,
        directory,
        controllerId,
        reviewInput,
        signal
      )
      if (review.review_sha256 !== request.expected_review_sha256) reject('REVIEW_CHANGED')
      if (signal?.aborted) reject('ABORTED')
      // Synchronous authority fence after SSH before material publication; transaction ends before file I/O.
      const original = database.transaction(() => {
        if (readTargetHelperUpgradeAuthority(database, request) !== review.authority_sha256)
          reject('AUTHORITY_CHANGED')
        readEnrolledProductTarget(
          database,
          directory,
          controllerId,
          request.app_id,
          request.ownership_generation,
          review.from_manifest_sha256
        )
        return new TargetEnrollmentRepository(database).get(request)!
      })()
      intent = intentSchema.parse({
        format: 1,
        purpose: 'product-target-helper-upgrade-intent',
        administrator_identity: administrator,
        request,
        body_sha256: digest(canonicalH2Json(request)),
        review,
        original_enrollment: original,
        created_at: new Date().toISOString()
      })
      publishIntent(directory, intent, key)
    }
    if (signal?.aborted) reject('ABORTED')
    return activateTargetHelperUpgradeIntent(
      database,
      directory,
      controllerId,
      administrator,
      identity
    )
  } finally {
    key.fill(0)
  }
}

/** Linux-only CLI: validate installed schema before opening, never run normal auto-migrations. */
export async function runTargetHelperUpgradeJournalCli(
  command: 'prepare-target-helper-upgrade' | 'helper-upgrade-state',
  directory: string,
  input: unknown,
  signal?: AbortSignal
): Promise<void> {
  if (process.platform !== 'linux') reject('LINUX_REQUIRED')
  if (signal?.aborted) reject('ABORTED')
  assertControllerRuntimeSchema(directory)
  const marker = JSON.parse(
    readReleaseFile(join(directory, '.product-controller-initialized'), 512).toString('utf8')
  ) as { format?: unknown; controller_id?: unknown }
  const database = new SqliteDatabase(join(directory, 'opspilot.db'), {
    readonly: command === 'helper-upgrade-state',
    fileMustExist: true,
    timeout: 5000
  })
  try {
    const controllers = database
      .prepare('SELECT controller_id,status FROM product_controller')
      .all() as { controller_id: string; status: string }[]
    if (
      marker.format !== 1 ||
      controllers.length !== 1 ||
      controllers[0].status !== 'active' ||
      marker.controller_id !== controllers[0].controller_id
    )
      reject('AUTHORITY_CHANGED')
    database.pragma('foreign_keys=ON')
    if (command === 'prepare-target-helper-upgrade') database.pragma('synchronous=FULL')
    const controllerId = controllers[0].controller_id,
      administrator = `unix:${process.getuid!()}`
    const result =
      command === 'helper-upgrade-state'
        ? readTargetHelperUpgradePreparation(
            database,
            directory,
            controllerId,
            administrator,
            input
          )
        : await prepareTargetHelperUpgrade(
            database,
            directory,
            controllerId,
            administrator,
            input,
            signal
          )
    console.log(JSON.stringify(result))
  } finally {
    database.close()
  }
}
