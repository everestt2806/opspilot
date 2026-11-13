import { describe, expect, it } from 'vitest'
import { CONTROLLER_SPA_ASSET_TRANSITION } from './controllerUpgradeAssets'
import { assertRetainedTargetHelpers } from './controllerTargetHelperCompatibility'
const policy = CONTROLLER_SPA_ASSET_TRANSITION[0]
const current = [
  { path: 'target-helper/target_execution_guard.py', size: 100, sha256: 'a'.repeat(64) },
  { path: 'target-helper/target_guarded_ssh_helper.py', size: 200, sha256: 'b'.repeat(64) },
  { path: policy.path.replace(/^payload\//, ''), ...policy.after }
]
const historical = [current[0], current[1], { path: current[2].path, ...policy.before }]
describe('Retained target helper compatibility', () => {
  it('chấp nhận current helpers cho SPA/Express và exact legacy pair riêng cho Express', () => {
    expect(() => assertRetainedTargetHelpers('express', current, historical)).not.toThrow()
    for (const framework of ['express', 'static-spa'])
      expect(() => assertRetainedTargetHelpers(framework, current, current)).not.toThrow()
    for (const framework of ['static-spa', 'nextjs', 'flask', 'unknown'])
      expect(() => assertRetainedTargetHelpers(framework, current, historical)).toThrow(
        'TARGET_ENROLLMENT_HELPER_UPGRADE_REQUIRED'
      )
  })
  it('chặn drift guard/helper, sai current bundle, missing/duplicate thay vì bỏ qua pin', () => {
    for (const index of [0, 1, 2])
      for (const patch of [{ sha256: 'f'.repeat(64) }, { size: 1 }]) {
        expect(() =>
          assertRetainedTargetHelpers(
            'express',
            current,
            historical.map((file, i) => (i === index ? { ...file, ...patch } : file))
          )
        ).toThrow('TARGET_ENROLLMENT_HELPER_UPGRADE_REQUIRED')
      }
    expect(() =>
      assertRetainedTargetHelpers(
        'express',
        current.map((file, i) => (i === 2 ? { ...file, sha256: 'e'.repeat(64) } : file)),
        historical
      )
    ).toThrow('TARGET_ENROLLMENT_HELPER_UPGRADE_REQUIRED')
    expect(() => assertRetainedTargetHelpers('express', current, historical.slice(0, 2))).toThrow(
      'TARGET_ENROLLMENT_HELPER_UPGRADE_REQUIRED'
    )
    expect(() =>
      assertRetainedTargetHelpers('express', current, [...historical, historical[2]])
    ).toThrow('TARGET_ENROLLMENT_HELPER_UPGRADE_REQUIRED')
  })
})
