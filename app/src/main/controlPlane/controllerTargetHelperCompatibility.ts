import {
  CONTROLLER_SPA_ASSET_TRANSITION,
  CONTROLLER_ENVIRONMENT_ASSET_TRANSITION
} from './controllerUpgradeAssets'

type Asset = { path: string; size: number; sha256: string }
/** Chỉ đọc compatibility; caller vẫn xác minh SQL pin, actual remote bytes và HMAC proof. */
export function assertRetainedTargetHelpers(
  framework: string,
  current: readonly Asset[],
  historical: readonly Asset[]
): void {
  for (const file of current) {
    const previous = historical.filter((entry) => entry.path === file.path)
    if (previous.length !== 1) throw Error('TARGET_ENROLLMENT_HELPER_UPGRADE_REQUIRED')
    if (previous[0].size === file.size && previous[0].sha256 === file.sha256) continue
    const policy = CONTROLLER_SPA_ASSET_TRANSITION[0]
    const environment = CONTROLLER_ENVIRONMENT_ASSET_TRANSITION[0]
    if (
      ['express', 'static-spa', 'nextjs'].includes(framework) &&
      file.path === environment.path.replace(/^payload\//, '') &&
      file.size === environment.after.size &&
      file.sha256 === environment.after.sha256 &&
      ((previous[0].size === environment.before.size &&
        previous[0].sha256 === environment.before.sha256) ||
        (framework === 'express' &&
          previous[0].size === policy.before.size &&
          previous[0].sha256 === policy.before.sha256))
    )
      continue
    if (
      framework !== 'express' ||
      file.path !== policy.path.replace(/^payload\//, '') ||
      file.size !== policy.after.size ||
      file.sha256 !== policy.after.sha256 ||
      previous[0].size !== policy.before.size ||
      previous[0].sha256 !== policy.before.sha256
    )
      throw Error('TARGET_ENROLLMENT_HELPER_UPGRADE_REQUIRED')
  }
}
