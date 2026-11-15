import type Database from 'better-sqlite3'
import type { ProductClaimToken } from '../../../../docs/contracts/product-auto-deploy'
import type { ProductAdmissionDecision } from '../../../../docs/contracts/product-controller-readiness'
import type { SshManager } from '../ssh/manager'
import { ProductDeployRepository } from '../db/productDeployRepository'
import { TargetEnrollmentRepository } from './targetEnrollmentRepository'
import { readEnrolledProductTarget } from './targetEnrollment'
import { observeProductTarget } from './controllerTargetProbe'
import { assessProductResources } from './controllerResources'
import { canonicalH2Json } from './productH2Proof'
import { assertProductEnvironmentTargetManifest } from './productEnvironmentTarget'

/** Probe thất bại không được biến thành deploy thử để đoán tình trạng target. */
export class ControllerTargetAdmission {
  constructor(
    private readonly database: Database.Database,
    private readonly directory: string,
    private readonly controllerId: string,
    private readonly ssh: SshManager
  ) {}

  async check(claim: ProductClaimToken, signal: AbortSignal): Promise<ProductAdmissionDecision> {
    try {
      if (signal.aborted || claim.controller_id !== this.controllerId)
        throw new Error('ADMISSION_REJECTED')
      const jobs = new ProductDeployRepository(this.database)
      const enrollment = new TargetEnrollmentRepository(this.database)
      const row = enrollment.get(claim)
      if (!row) throw new Error('ADMISSION_REJECTED')
      const payload = readEnrolledProductTarget(
        this.database,
        this.directory,
        this.controllerId,
        claim.app_id,
        claim.ownership_generation,
        row.manifest_sha256
      )
      const assertClaim = (): void => {
        const current = jobs.readGitDispatchTargetBinding(claim)
        if (
          signal.aborted ||
          current.state !== 'ready' ||
          canonicalH2Json(current.binding) !== canonicalH2Json(payload.target)
        )
          throw new Error('ADMISSION_REJECTED')
      }
      assertClaim()
      const source = this.database
        .prepare(
          'SELECT deploy_config_json,config_sha256 FROM product_source_config WHERE app_id=? AND source_generation=?'
        )
        .get(claim.app_id, claim.source_generation) as
        { deploy_config_json: string; config_sha256: string } | undefined
      if (!source || source.config_sha256 !== claim.source_config_sha256)
        throw Error('ADMISSION_REJECTED')
      const needsEnvironment = Object.hasOwn(JSON.parse(source.deploy_config_json), 'environment')
      const result = await observeProductTarget(
        this.database,
        this.controllerId,
        payload,
        this.ssh,
        true,
        signal
      )
      assertClaim()
      if (needsEnvironment) assertProductEnvironmentTargetManifest(result.manifest)
      return assessProductResources(result.resources, true)
    } catch {
      return { state: 'deferred', reason: 'resource_unknown' }
    }
  }
}
