import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import type { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import type { ProductEnvironmentScope } from '../../../../docs/contracts/product-environment'
import type {
  ProductPostgresReview,
  ProductPostgresSelectionResult
} from '../../../../docs/contracts/product-postgres'
import { ProductPostgresSelection } from './productPostgresSelection'
import { postgresSelectionSchema, ProductPostgresError } from './productPostgres'
import { canonicalH2Json } from './productH2Proof'
import { CONTROLLER_POSTGRES_IO_ASSET_TRANSITION } from './controllerUpgradeAssets'
import { readVerifiedControllerBundleFile, type VerifiedControllerBundle } from './controllerBundle'
import { TargetEnrollmentRepository } from './targetEnrollmentRepository'
import { readEnrolledProductTarget, exchangeProductBootstrapJson } from './targetEnrollment'
import { verifyTargetEnrollmentProof } from './targetEnrollmentProof'
import { loadControllerRuntimeKey } from './controllerRuntimeKeys'
import { SshManager } from '../ssh/manager'
import { createControllerSshResolver } from './controllerSshResolver'
import { observeProductTarget } from './controllerTargetProbe'

export function assertProductPostgresTargetManifest(bytes: Buffer): void {
  try {
    const manifest = JSON.parse(bytes.toString('utf8')),
      policy = CONTROLLER_POSTGRES_IO_ASSET_TRANSITION[0]
    if (manifest.format !== 1 || manifest.node_major !== 22 || !Array.isArray(manifest.files))
      throw Error()
    const entries = manifest.files.filter(
      (file: { path?: unknown }) => file?.path === policy.path.replace(/^payload\//, '')
    )
    if (
      entries.length !== 1 ||
      entries[0].size !== policy.after.size ||
      entries[0].sha256 !== policy.after.sha256
    )
      throw Error()
  } catch {
    throw new ProductPostgresError('PRODUCT_POSTGRES_HELPER_UPGRADE_REQUIRED')
  }
}

/** Selection only: no deploy, policy activation, provisioning or credential output.
 * Positive receipt lookup remains available while the target is offline.
 */
export class ProductPostgresCommands {
  private readonly selection: ProductPostgresSelection
  constructor(
    private readonly db: Database.Database,
    cipher: AesGcmCredentialCipher,
    private readonly directory: string,
    private readonly controllerId: string,
    private readonly administratorId: string,
    private readonly bundle: VerifiedControllerBundle,
    private readonly options: {
      /** Internal test composition only; not accepted through CLI/IPC. */
      inspectTarget?: (scope: ProductEnvironmentScope, signal: AbortSignal) => Promise<Buffer>
    } = {}
  ) {
    this.selection = new ProductPostgresSelection(db, cipher)
  }

  lookup(input: unknown): ReturnType<ProductPostgresSelection['lookup']> {
    return this.selection.lookup(input, this.controllerId, this.administratorId)
  }
  async review(input: unknown, parentSignal?: AbortSignal): Promise<ProductPostgresReview> {
    const before = this.selection.review(input, this.controllerId, this.administratorId),
      signal = parentSignal
        ? AbortSignal.any([parentSignal, AbortSignal.timeout(40000)])
        : AbortSignal.timeout(40000)
    if (signal.aborted) throw new ProductPostgresError('PRODUCT_POSTGRES_UNAVAILABLE')
    let manifest: Buffer
    try {
      manifest = await (this.options.inspectTarget
        ? this.options.inspectTarget(before.scope, signal)
        : this.inspect(before.scope, signal))
    } catch (error) {
      if (error instanceof ProductPostgresError) throw error
      throw new ProductPostgresError('PRODUCT_POSTGRES_UNAVAILABLE')
    }
    if (signal.aborted) throw new ProductPostgresError('PRODUCT_POSTGRES_UNAVAILABLE')
    const after = this.selection.review(input, this.controllerId, this.administratorId)
    if (canonicalH2Json(before) !== canonicalH2Json(after))
      throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
    assertProductPostgresTargetManifest(manifest)
    return after
  }
  async select(input: unknown, signal?: AbortSignal): Promise<ProductPostgresSelectionResult> {
    if (signal?.aborted) throw new ProductPostgresError('PRODUCT_POSTGRES_UNAVAILABLE')
    if (!this.lookup(input).result) await this.review(postgresSelectionSchema.parse(input), signal)
    if (signal?.aborted) throw new ProductPostgresError('PRODUCT_POSTGRES_UNAVAILABLE')
    return this.selection.select(input, this.controllerId, this.administratorId)
  }
  private async inspect(scope: ProductEnvironmentScope, signal: AbortSignal): Promise<Buffer> {
    const repository = new TargetEnrollmentRepository(this.db),
      row = repository.get(scope)
    if (!row || row.state !== 'enrolled')
      throw new ProductPostgresError('PRODUCT_POSTGRES_HELPER_UPGRADE_REQUIRED')
    const payload = readEnrolledProductTarget(
      this.db,
      this.directory,
      this.controllerId,
      scope.app_id,
      scope.ownership_generation,
      row.manifest_sha256
    )
    if (canonicalH2Json(payload.target) !== canonicalH2Json(scope.target))
      throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
    // The local candidate must itself contain the supported helper; a manifest label is insufficient.
    const runtime = readVerifiedControllerBundleFile(
        this.bundle,
        'target-helper/target_product_runtime.py'
      ),
      policy = CONTROLLER_POSTGRES_IO_ASSET_TRANSITION[0].after
    if (
      runtime.length !== policy.size ||
      createHash('sha256').update(runtime).digest('hex') !== policy.sha256
    )
      throw new ProductPostgresError('PRODUCT_POSTGRES_HELPER_UPGRADE_REQUIRED')
    const ssh = new SshManager(
        createControllerSshResolver(this.db, this.controllerId, this.directory)
      ),
      key = loadControllerRuntimeKey(this.directory, scope)
    try {
      const observed = await observeProductTarget(
        this.db,
        this.controllerId,
        payload,
        ssh,
        false,
        signal
      )
      assertProductPostgresTargetManifest(observed.manifest)
      const script = readVerifiedControllerBundleFile(
          this.bundle,
          'target-helper/target_enrollment.py'
        ).toString('utf8'),
        opened = await ssh.openProductBootstrapChannel(
          scope.target.vps_id,
          { text: script, sha256: createHash('sha256').update(script).digest('hex') },
          {
            signal,
            timeoutMs: 20000,
            expectedIdentity: {
              vpsId: scope.target.vps_id,
              host: scope.target.host,
              port: scope.target.port,
              username: scope.target.username,
              authType: scope.target.auth_type,
              hostFingerprint: scope.target.host_fingerprint
            }
          }
        )
      repository.assertCurrent(payload, false)
      const identity = opened.identity,
        target = scope.target
      if (
        identity.vpsId !== target.vps_id ||
        identity.host !== target.host ||
        identity.port !== target.port ||
        identity.username !== target.username ||
        identity.authType !== target.auth_type ||
        identity.hostFingerprint !== target.host_fingerprint
      ) {
        opened.channel.destroy()
        throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
      }
      // inspect never creates/replaces remote state; actual helper bytes, key and receipt must match.
      const response = (await exchangeProductBootstrapJson(
        opened.channel,
        JSON.stringify({
          format: 1,
          operation: 'inspect',
          payload,
          key: key.toString('base64'),
          manifest: observed.manifest.toString('utf8'),
          helpers: {}
        }),
        signal
      )) as { state?: string; proof?: unknown }
      repository.assertCurrent(payload, false)
      const current = repository.get(scope)
      if (
        !response ||
        Object.keys(response).sort().join(',') !== 'proof,state' ||
        response.state !== 'enrolled' ||
        !verifyTargetEnrollmentProof(payload, response.proof, key) ||
        !current ||
        current.state !== 'enrolled' ||
        current.last_error_code ||
        current.manifest_sha256 !== row.manifest_sha256 ||
        current.target_binding_json !== row.target_binding_json
      )
        throw new ProductPostgresError('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
      return observed.manifest
    } finally {
      key.fill(0)
      await ssh.disconnectAll()
    }
  }
}
