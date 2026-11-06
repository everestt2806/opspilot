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
      const result = await observeProductTarget(
        this.database,
        this.controllerId,
        payload,
        this.ssh,
        true,
        signal
      )
      assertClaim()
      return assessProductResources(result.resources, true)
    } catch {
      return { state: 'deferred', reason: 'resource_unknown' }
    }
  }
}
