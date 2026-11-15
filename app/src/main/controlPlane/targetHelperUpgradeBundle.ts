import { createHash } from 'node:crypto'
import { readVerifiedControllerBundleFile, verifyControllerBundle } from './controllerBundle'

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
    canonical.length !== 36931 ||
    createHash('sha256').update(canonical).digest('hex') !==
      'ae2c290726b6fc497489bca962036ac14806bf588086d181498cbc8dcd886c7b'
  )
    throw Error('TARGET_HELPER_UPGRADE_BOOTSTRAP_REQUIRED')
  return { bundle, script: bytes.toString('utf8') }
}
