import type Database from 'better-sqlite3'
import type { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import type {
  ProductEnvironmentScope,
  ProductEnvironmentReview,
  ProductEnvironmentSelectionResult
} from '../../../../docs/contracts/product-environment'
import { ProductEnvironmentSelection } from './productEnvironmentSelection'
import { environmentSelectionSchema, ProductEnvironmentError } from './productEnvironment'
import { TargetEnrollmentRepository } from './targetEnrollmentRepository'
import { readEnrolledProductTarget } from './targetEnrollment'
import { SshManager } from '../ssh/manager'
import { createControllerSshResolver } from './controllerSshResolver'
import { observeProductTarget } from './controllerTargetProbe'
import { canonicalH2Json } from './productH2Proof'
import { assertProductEnvironmentTargetManifest } from './productEnvironmentTarget'

/** CLI cùng UID: chỉ capability mới cần SSH; receipt dương tính vẫn đọc được khi target offline. */
export class ProductEnvironmentCommands {
  private readonly selection: ProductEnvironmentSelection
  constructor(
    private readonly db: Database.Database,
    cipher: AesGcmCredentialCipher,
    private readonly directory: string,
    private readonly controllerId: string,
    private readonly administratorId: string,
    private readonly options: {
      /** Chỉ composition test nội bộ, không nhận qua CLI/IPC. */
      inspectTarget?: (scope: ProductEnvironmentScope, signal: AbortSignal) => Promise<Buffer>
    } = {}
  ) {
    this.selection = new ProductEnvironmentSelection(db, cipher)
  }
  lookup(input: unknown): ReturnType<ProductEnvironmentSelection['lookup']> {
    return this.selection.lookup(input, this.controllerId, this.administratorId)
  }
  async review(input: unknown, parentSignal?: AbortSignal): Promise<ProductEnvironmentReview> {
    const before = this.selection.review(input, this.controllerId, this.administratorId),
      signal = parentSignal
        ? AbortSignal.any([parentSignal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000)
    if (signal.aborted) throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_UNAVAILABLE')
    let manifest: Buffer
    try {
      manifest = await (this.options.inspectTarget
        ? this.options.inspectTarget(before.scope, signal)
        : this.inspect(before.scope, signal))
    } catch (error) {
      if (error instanceof ProductEnvironmentError) throw error
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_UNAVAILABLE')
    }
    if (signal.aborted) throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_UNAVAILABLE')
    const after = this.selection.review(input, this.controllerId, this.administratorId)
    if (canonicalH2Json(before) !== canonicalH2Json(after))
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_SOURCE_CHANGED')
    assertProductEnvironmentTargetManifest(manifest)
    return after
  }
  async select(input: unknown, signal?: AbortSignal): Promise<ProductEnvironmentSelectionResult> {
    // Exact body/admin receipt được xác minh trước mọi network hoặc selection mutation.
    if (this.lookup(input).result)
      return this.selection.select(input, this.controllerId, this.administratorId)
    const request = environmentSelectionSchema.parse(input)
    await this.review(
      {
        format: 1,
        controller_id: request.scope.controller_id,
        app_id: request.scope.app_id,
        expected_ownership_generation: request.scope.ownership_generation,
        expected_source_generation: request.expected_source_generation,
        expected_source_config_sha256: request.expected_source_config_sha256,
        expected_target_security_revision: request.scope.target.ssh_security_revision
      },
      signal
    )
    return this.selection.select(input, this.controllerId, this.administratorId)
  }
  private async inspect(scope: ProductEnvironmentScope, signal: AbortSignal): Promise<Buffer> {
    const repository = new TargetEnrollmentRepository(this.db),
      row = repository.get(scope)
    if (!row || row.state !== 'enrolled')
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_HELPER_UPGRADE_REQUIRED')
    const payload = readEnrolledProductTarget(
      this.db,
      this.directory,
      this.controllerId,
      scope.app_id,
      scope.ownership_generation,
      row.manifest_sha256
    )
    if (canonicalH2Json(payload.target) !== canonicalH2Json(scope.target))
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED')
    const ssh = new SshManager(
      createControllerSshResolver(this.db, this.controllerId, this.directory)
    )
    try {
      const observed = await observeProductTarget(
        this.db,
        this.controllerId,
        payload,
        ssh,
        false,
        signal
      )
      const current = repository.get(scope)
      if (
        !current ||
        current.state !== 'enrolled' ||
        current.manifest_sha256 !== row.manifest_sha256 ||
        current.target_binding_json !== row.target_binding_json
      )
        throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED')
      return observed.manifest
    } finally {
      ssh.disconnectAll()
    }
  }
}
