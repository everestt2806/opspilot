import { createHash } from 'node:crypto'
import { readVerifiedControllerBundleFile, verifyControllerBundle } from './controllerBundle'
import {
  CONTROLLER_HELPER_UPGRADE_BOOTSTRAP_TRANSITION,
  CONTROLLER_POSTGRES_BOOTSTRAP_TRANSITION
} from './controllerUpgradeAssets'

/** Reviewed e3a bootstrap capability. Bundle verifier still pins exact original file bytes. */
export function verifyTargetHelperUpgradeBundle(
  artifact: string,
  manifestSha256: string
): {
  bundle: ReturnType<typeof verifyControllerBundle>
  script: string
} {
  const bundle = verifyControllerBundle(artifact, manifestSha256)
  const bytes = readVerifiedControllerBundleFile(bundle, 'target-helper/target_enrollment.py')
  const canonical = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'))
  if (
    bytes.length > 64 * 1024 ||
    ![
      CONTROLLER_HELPER_UPGRADE_BOOTSTRAP_TRANSITION[0].after,
      CONTROLLER_POSTGRES_BOOTSTRAP_TRANSITION[0].after
    ].some(
      (pin) =>
        canonical.length === pin.size &&
        createHash('sha256').update(canonical).digest('hex') === pin.sha256
    )
  )
    throw Error('TARGET_HELPER_UPGRADE_BOOTSTRAP_REQUIRED')
  return { bundle, script: bytes.toString('utf8') }
}
