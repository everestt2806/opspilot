import {
  CONTROLLER_ENVIRONMENT_ASSET_TRANSITION,
  CONTROLLER_POSTGRES_ASSET_TRANSITION
} from './controllerUpgradeAssets'
import { ProductEnvironmentError } from './productEnvironment'

/** Manifest đã được probe đối chiếu SQL pin; guard transport vẫn kiểm actual bytes/HMAC. */
export function assertProductEnvironmentTargetManifest(manifest: Buffer): void {
  try {
    const value = JSON.parse(manifest.toString('utf8')),
      policy = CONTROLLER_ENVIRONMENT_ASSET_TRANSITION[0]
    if (value.format !== 1 || value.node_major !== 22 || !Array.isArray(value.files)) throw Error()
    const entries = value.files.filter(
      (file: { path?: unknown }) => file?.path === policy.path.replace(/^payload\//, '')
    )
    if (
      entries.length !== 1 ||
      ![policy.after, CONTROLLER_POSTGRES_ASSET_TRANSITION[0].after].some(
        (pin) => entries[0].size === pin.size && entries[0].sha256 === pin.sha256
      )
    )
      throw Error()
  } catch {
    throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_HELPER_UPGRADE_REQUIRED')
  }
}
