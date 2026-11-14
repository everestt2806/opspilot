export { initializeDatabase, closeDatabase } from '../../src/main/db'
export { ProductDeployRepository } from '../../src/main/db/productDeployRepository'
export { ProductRuntimeRepository } from '../../src/main/db/productRuntimeRepository'
export { SshManager } from '../../src/main/ssh/manager'
export {
  enrollProductTarget,
  readEnrolledProductTarget
} from '../../src/main/controlPlane/targetEnrollment'
export { TargetEnrollmentRepository } from '../../src/main/controlPlane/targetEnrollmentRepository'
export { ControllerClientAuth } from '../../src/main/controlPlane/controllerClientAuth'
export { ControllerCommands } from '../../src/main/controlPlane/controllerCommands'
export { ControllerHttpClient } from '../../src/main/controlPlane/controllerHttpClient'
export { ControllerReadApi } from '../../src/main/controlPlane/controllerReadApi'
export { ControllerReadCursor } from '../../src/main/controlPlane/controllerReadCursor'
export { AesGcmCredentialCipher } from '../../src/main/crypto/credentialCipher'
export { DesktopControllerVault } from '../../src/main/controlPlane/desktopControllerVault'
export { DesktopControllerEnrollment } from '../../src/main/controlPlane/desktopControllerEnrollment'
export { DesktopControllerService } from '../../src/main/controlPlane/desktopControllerService'
export { initializeController } from '../../src/main/controlPlane/controllerDatabase'
export { ControllerStartupRecovery } from '../../src/main/controlPlane/controllerStartupRecovery'
export { ControllerTargetAdmission } from '../../src/main/controlPlane/controllerTargetAdmission'
export {
  ControllerResourceAdmission,
  measureControllerResources
} from '../../src/main/controlPlane/controllerResources'
export { verifyControllerBundle } from '../../src/main/controlPlane/controllerBundle'
export { createControllerSshResolver } from '../../src/main/controlPlane/controllerSshResolver'
export { ProductRuntimeExecutor } from '../../src/main/controlPlane/productRuntimeExecutor'
export { ControlPlaneJobWorker } from '../../src/main/controlPlane/queueWorker'
export {
  createControllerRuntimeKey,
  loadControllerRuntimeKey
} from '../../src/main/controlPlane/controllerRuntimeKeys'
export {
  ControllerRuntimeExecutorRouter,
  openControllerRuntimeRepository
} from '../../src/main/controlPlane/controllerRuntimeExecutor'
export {
  initializeControllerSecretKey,
  loadControllerCredentialCipher,
  encryptControllerCredential
} from '../../src/main/controlPlane/controllerSecrets'
export {
  executeProductDeployPipeline,
  recoverProductRuntimeSession
} from '../../src/main/controlPlane/productRuntimePipeline'
export { DesktopControllerCommands } from '../../src/main/controlPlane/desktopControllerCommands'
export { ProductProjectRegistration } from '../../src/main/controlPlane/projectRegistration'
export { ProductEnvironmentRuntime } from '../../src/main/controlPlane/productEnvironmentRuntime'
export { ProductEnvironmentSelection } from '../../src/main/controlPlane/productEnvironmentSelection'
export { ProductEnvironmentRepository } from '../../src/main/db/productEnvironmentRepository'
export { canonicalH2Json } from '../../src/main/controlPlane/productH2Proof'
