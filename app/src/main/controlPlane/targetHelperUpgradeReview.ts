import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { PRODUCT_CONTROLLER_BUNDLE_MAX_FILE_BYTES } from '../../../../docs/contracts/product-controller-bundle'
import type {
  ProductTargetHelperUpgradeReview,
  ProductTargetHelperUpgradeReviewInput
} from '../../../../docs/contracts/product-target-helper-upgrade'
import { readReleaseFile } from './controllerRelease'
import { assertControllerRuntimeSchema } from './controllerUpgradeCheck'
import { readVerifiedControllerBundleFile, verifyControllerBundle } from './controllerBundle'
import { CONTROLLER_ENVIRONMENT_ASSET_TRANSITION } from './controllerUpgradeAssets'
import { assertRetainedTargetHelpers } from './controllerTargetHelperCompatibility'
import { loadControllerRuntimeKey } from './controllerRuntimeKeys'
import { createControllerSshResolver } from './controllerSshResolver'
import { SshManager } from '../ssh/manager'
import { exchangeProductBootstrapJson, readEnrolledProductTarget } from './targetEnrollment'
import { TargetEnrollmentRepository, type TargetEnrollmentRow } from './targetEnrollmentRepository'
import { verifyTargetEnrollmentProof } from './targetEnrollmentProof'
import { canonicalH2Json } from './productH2Proof'

const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex')
export const targetHelperUpgradeReviewInputSchema = z.strictObject({
  format: z.literal(1),
  controller_id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
  app_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  ownership_generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  artifact: z.string().min(1).max(4096),
  manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  retained_manifest: z.string().min(1).max(32768)
})
const helpers = [
  'target_execution_guard.py',
  'target_guarded_ssh_helper.py',
  'target_product_runtime.py'
]
const fileSchema = z.strictObject({
  path: z.string(),
  size: z.number().int().positive().max(PRODUCT_CONTROLLER_BUNDLE_MAX_FILE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
})

/** Read-only snapshot; no transaction remains open while awaiting SSH. */
function authority(
  database: Database.Database,
  request: ProductTargetHelperUpgradeReviewInput
): string {
  if (database.inTransaction) throw Error('TARGET_HELPER_REVIEW_TRANSACTION_ACTIVE')
  return database.transaction(() => readTargetHelperUpgradeAuthority(database, request))()
}

/** Internal SQL fence: caller owns transaction; override only after exact pending-row validation. */
export function readTargetHelperUpgradeAuthority(
  database: Database.Database,
  request: Pick<
    ProductTargetHelperUpgradeReviewInput,
    'controller_id' | 'app_id' | 'ownership_generation'
  >,
  originalEnrollment?: TargetEnrollmentRow
): string {
  if (!database.inTransaction) throw Error('TARGET_HELPER_REVIEW_TRANSACTION_REQUIRED')
  const repository = new TargetEnrollmentRepository(database)
  const target = repository.target(
    request.controller_id,
    request.app_id,
    request.ownership_generation,
    true
  )
  if (
    database
      .prepare(
        `SELECT 1 FROM product_deploy_attempt a JOIN product_deploy_job j ON j.job_id=a.job_id
        WHERE j.app_id=? AND (a.state NOT IN ('succeeded','failed','rolled_back','abandoned_before_write') OR a.remote_outcome='unknown')
      UNION ALL SELECT 1 FROM product_worker_lease l JOIN product_deploy_job j ON j.job_id=l.job_id
        WHERE j.app_id=? AND l.released_at IS NULL
      UNION ALL SELECT 1 FROM deployment_activation WHERE app_id=? AND state='prepared'
      UNION ALL SELECT 1 FROM product_runtime_execution e JOIN deployment d ON d.id=e.deployment_id
        LEFT JOIN product_runtime_terminal t ON t.attempt_id=e.attempt_id WHERE d.app_id=?
        AND (t.attempt_id IS NULL OR t.settled_at IS NULL OR t.leases_released_at IS NULL)
      UNION ALL SELECT 1 FROM experiment_run e JOIN deployment d ON d.id=e.deployment_id
        WHERE d.app_id=? AND e.status='running' LIMIT 1`
      )
      .get(...Array(5).fill(request.app_id))
  )
    throw Error('TARGET_HELPER_REVIEW_REQUIRES_QUIESCENCE')
  const row = originalEnrollment ?? repository.get(request)
  if (!row || row.state !== 'enrolled' || row.last_error_code || !row.receipt_json)
    throw Error('TARGET_ENROLLMENT_NOT_READY')
  const context = database
    .prepare(
      `SELECT a.framework,a.current_deployment_id,a.host_port,a.container_port,
      a.healthcheck_path,a.name,c.*,s.repository_url,s.production_ref,s.repository_root,s.deploy_config_json
      FROM app a JOIN product_app_control c ON c.app_id=a.id JOIN product_source_config s
      ON s.app_id=c.app_id AND s.source_generation=c.source_generation AND s.config_sha256=c.source_config_sha256
      WHERE a.id=?`
    )
    .get(request.app_id)
  return sha256(canonicalH2Json({ target, enrollment: row, context }))
}

/** Authenticated retained inspect only. The returned snapshot never grants mutation authority. */
export async function reviewProductTargetHelperUpgrade(
  database: Database.Database,
  directory: string,
  controllerId: string,
  input: unknown,
  signal?: AbortSignal
): Promise<ProductTargetHelperUpgradeReview> {
  const parsed = targetHelperUpgradeReviewInputSchema.safeParse(input)
  if (
    !parsed.success ||
    parsed.data.controller_id !== controllerId ||
    Buffer.byteLength(parsed.data.retained_manifest) > 32768
  )
    throw Error('TARGET_HELPER_REVIEW_INPUT_INVALID')
  const request = parsed.data
  if (signal?.aborted) throw Error('TARGET_HELPER_REVIEW_ABORTED')
  const before = authority(database, request)
  const repository = new TargetEnrollmentRepository(database)
  const row = repository.get(request)!
  if (sha256(request.retained_manifest) !== row.manifest_sha256)
    throw Error('TARGET_HELPER_REVIEW_RETAINED_PIN_MISMATCH')
  const bundle = verifyControllerBundle(request.artifact, request.manifest_sha256)
  let retained: z.infer<typeof fileSchema>[]
  try {
    const manifest = JSON.parse(request.retained_manifest) as { files?: unknown }
    retained = z.array(fileSchema).min(helpers.length).max(128).parse(manifest.files)
  } catch {
    throw Error('TARGET_HELPER_REVIEW_MANIFEST_INVALID')
  }
  const current = helpers.map((name) => {
    const path = `target-helper/${name}`
    const bytes = readVerifiedControllerBundleFile(bundle, path)
    return { path, size: bytes.length, sha256: sha256(bytes) }
  })
  const { framework } = database
    .prepare('SELECT framework FROM app WHERE id=?')
    .get(request.app_id) as { framework: string }
  assertRetainedTargetHelpers(framework, current, retained)
  const changes = current.flatMap((file) => {
    const previous = retained.filter((entry) => entry.path === file.path)
    if (previous.length !== 1) throw Error('TARGET_HELPER_REVIEW_MANIFEST_INVALID')
    return previous[0].sha256 === file.sha256 && previous[0].size === file.size
      ? []
      : [
          {
            path: file.path,
            before: { size: previous[0].size, sha256: previous[0].sha256 },
            after: { size: file.size, sha256: file.sha256 }
          }
        ]
  })
  const approved = CONTROLLER_ENVIRONMENT_ASSET_TRANSITION[0]
  if (
    !['express', 'static-spa', 'nextjs'].includes(framework) ||
    changes.length !== 1 ||
    changes[0].path !== approved.path.replace(/^payload\//, '') ||
    changes[0].after.size !== approved.after.size ||
    changes[0].after.sha256 !== approved.after.sha256
  )
    throw Error('TARGET_HELPER_REVIEW_TRANSITION_REJECTED')
  const payload = readEnrolledProductTarget(
    database,
    directory,
    controllerId,
    request.app_id,
    request.ownership_generation,
    row.manifest_sha256
  )
  const key = loadControllerRuntimeKey(directory, request)
  const ssh = new SshManager(createControllerSshResolver(database, controllerId, directory))
  try {
    const script = readVerifiedControllerBundleFile(
      bundle,
      'target-helper/target_enrollment.py'
    ).toString('utf8')
    const target = payload.target
    const opened = await ssh.openProductBootstrapChannel(
      target.vps_id,
      { text: script, sha256: sha256(script) },
      {
        signal,
        timeoutMs: 20_000,
        expectedIdentity: {
          vpsId: target.vps_id,
          host: target.host,
          port: target.port,
          username: target.username,
          authType: target.auth_type,
          hostFingerprint: target.host_fingerprint
        }
      }
    )
    try {
      const actual = opened.identity
      if (
        actual.vpsId !== target.vps_id ||
        actual.host !== target.host ||
        actual.port !== target.port ||
        actual.username !== target.username ||
        actual.authType !== target.auth_type ||
        actual.hostFingerprint !== target.host_fingerprint ||
        authority(database, request) !== before
      )
        throw Error('TARGET_HELPER_REVIEW_AUTHORITY_CHANGED')
      const response = (await exchangeProductBootstrapJson(
        opened.channel,
        JSON.stringify({
          format: 1,
          operation: 'inspect',
          payload,
          key: key.toString('base64'),
          manifest: request.retained_manifest,
          helpers: {}
        }),
        signal
      )) as { state?: unknown; proof?: unknown }
      if (
        !response ||
        Object.keys(response).sort().join(',') !== 'proof,state' ||
        response.state !== 'enrolled' ||
        !verifyTargetEnrollmentProof(payload, response.proof, key)
      )
        throw Error('TARGET_HELPER_REVIEW_REMOTE_PROOF_REJECTED')
      if (signal?.aborted) throw Error('TARGET_HELPER_REVIEW_ABORTED')
      if (authority(database, request) !== before)
        throw Error('TARGET_HELPER_REVIEW_AUTHORITY_CHANGED')
    } finally {
      opened.channel.destroy()
    }
    const review = {
      format: 1 as const,
      purpose: 'product-target-helper-upgrade-review' as const,
      controller_id: controllerId,
      app_id: request.app_id,
      ownership_generation: request.ownership_generation,
      from_manifest_sha256: row.manifest_sha256,
      to_manifest_sha256: bundle.manifest_sha256,
      authority_sha256: before,
      changes,
      apply_available: false as const
    }
    return { ...review, review_sha256: sha256(canonicalH2Json(review)) }
  } catch (error) {
    if (
      error instanceof Error &&
      /^(TARGET_HELPER_REVIEW_|TARGET_ENROLLMENT_)[A-Z_]+$/.test(error.message)
    )
      throw error
    throw Error('TARGET_HELPER_REVIEW_REMOTE_UNKNOWN')
  } finally {
    key.fill(0)
    await ssh.disconnectAll()
  }
}

/** Separate from normal bootstrap database opener: never migrate or chmod the existing DB. */
export async function runTargetHelperUpgradeReviewCli(
  directory: string,
  input: unknown,
  signal?: AbortSignal
): Promise<void> {
  assertControllerRuntimeSchema(directory)
  const marker = JSON.parse(
    readReleaseFile(join(directory, '.product-controller-initialized'), 512).toString('utf8')
  ) as { format?: unknown; controller_id?: unknown }
  const database = new Database(join(directory, 'opspilot.db'), {
    readonly: true,
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
      throw Error('TARGET_HELPER_REVIEW_AUTHORITY_CHANGED')
    console.log(
      JSON.stringify(
        await reviewProductTargetHelperUpgrade(
          database,
          directory,
          controllers[0].controller_id,
          input,
          signal
        )
      )
    )
  } finally {
    database.close()
  }
}
