import type { OpenControllerDatabase } from './controllerDatabase'
import type { ProductDeployRepository } from '../db/productDeployRepository'
import type { VerifiedControllerBundle } from './controllerBundle'
import type { ProductStartupRecoveryReport } from '../../../../docs/contracts/product-controller-readiness'
import { verifyControllerBundle } from './controllerBundle'
import { loadControllerCredentialCipher } from './controllerSecrets'
import { createControllerSshResolver } from './controllerSshResolver'
import { SshManager } from '../ssh/manager'
import { ControllerRuntimeExecutorRouter } from './controllerRuntimeExecutor'
import { ControllerResourceAdmission } from './controllerResources'
import { ControllerTargetAdmission } from './controllerTargetAdmission'
import { ControllerStartupRecovery } from './controllerStartupRecovery'
import { TargetEnrollmentRepository } from './targetEnrollmentRepository'
import { readEnrolledProductTarget } from './targetEnrollment'
import { ControlPlaneJobWorker } from './queueWorker'

export interface ControllerExecutionRuntime {
  worker: ControlPlaneJobWorker
  initialize(signal: AbortSignal): Promise<ProductStartupRecoveryReport>
  isReady(): boolean
  close(): Promise<void>
}

/** Chỉ composition có chủ đích mới cấp executor; không tự provision key/target hoặc enable app. */
export function createControllerExecutionRuntime(
  opened: OpenControllerDatabase,
  repository: ProductDeployRepository,
  bundle: VerifiedControllerBundle
): ControllerExecutionRuntime {
  if (process.platform !== 'linux') throw new Error('CONTROLLER_EXECUTION_REQUIRES_LINUX')
  loadControllerCredentialCipher(opened.dataDirectory)
  const ssh = new SshManager(
    createControllerSshResolver(opened.database, opened.controllerId, opened.dataDirectory)
  )
  const recovery = new ControllerStartupRecovery(
    opened.database,
    opened.dataDirectory,
    opened.controllerId,
    bundle
  )
  const targetAdmission = new ControllerTargetAdmission(
    opened.database,
    opened.dataDirectory,
    opened.controllerId,
    ssh
  )
  const executor = new ControllerRuntimeExecutorRouter({
    database: opened.database,
    repository,
    ssh,
    secretDirectory: opened.dataDirectory,
    admitTarget: (claim, signal) => targetAdmission.check(claim, signal),
    targetOptions: (claim) => {
      const approved = verifyControllerBundle(bundle.entrypoint, bundle.manifest_sha256)
      const enrollment = new TargetEnrollmentRepository(opened.database).get(claim)
      if (!enrollment) throw new Error('TARGET_ENROLLMENT_NOT_READY')
      const installed = readEnrolledProductTarget(
        opened.database,
        opened.dataDirectory,
        opened.controllerId,
        claim.app_id,
        claim.ownership_generation,
        enrollment.manifest_sha256
      )
      return {
        vps_id: installed.target.vps_id,
        target_helper_path: installed.helper_path,
        target_state_root: installed.state_root,
        collector_directory: approved.collector_directory,
        templates_directory: approved.templates_directory
      }
    }
  })
  return {
    worker: new ControlPlaneJobWorker({
      repository,
      controllerId: opened.controllerId,
      executor,
      admission: new ControllerResourceAdmission(opened.dataDirectory, () => recovery.isReady())
    }),
    initialize: (signal) => recovery.run(signal),
    isReady: () => recovery.isReady(),
    close: () => ssh.disconnectAll()
  }
}
