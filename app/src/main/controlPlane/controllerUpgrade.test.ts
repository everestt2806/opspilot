import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { CONTROLLER_SPA_ASSET_TRANSITION } from './controllerUpgradeAssets'
import { assertRetainedTargetHelpers } from './controllerTargetHelperCompatibility'
import {
  parseControllerUpgradeRequest,
  renderUpgradedControllerUnit,
  assertControllerUpgradeCompatibility,
  executeControllerUpgrade
} from './controllerUpgrade'
import { controllerInstallerPaths } from './controllerInstallation'
import type { ControllerReleaseManifest } from '../../../../docs/contracts/product-controller-release'

const input = {
  format: 1,
  operation: 'upgrade',
  consent: true,
  request_key: '11111111-1111-4111-8111-111111111111',
  installation_request_key: '22222222-2222-4222-8222-222222222222',
  controller_id: '33333333-3333-4333-8333-333333333333',
  parent_upgrade_key: null,
  parent_release_sha256: 'a'.repeat(64),
  release_sha256: 'b'.repeat(64),
  release_directory: '/private/release'
}
describe('Trusted controller upgrade boundary', () => {
  it('chỉ nhận đúng asset pair R7a/R7b và giữ chốt Node/dependency/template khác', () => {
    const old = {
      format: 1,
      platform: 'linux-x64-glibc',
      node_version: '22.23.4',
      node_abi: '127',
      minimum_glibc: '2.39',
      lock_sha256: 'a'.repeat(64),
      payload_sha256: 'b'.repeat(64),
      packages: [],
      files: [
        { path: 'node', size: 100, mode: 0o700, sha256: 'c'.repeat(64) },
        ...CONTROLLER_SPA_ASSET_TRANSITION.map((entry) => ({
          path: entry.path,
          mode: entry.mode,
          ...entry.before
        }))
      ]
    } satisfies ControllerReleaseManifest
    const next = {
      ...old,
      files: [
        old.files[0],
        ...CONTROLLER_SPA_ASSET_TRANSITION.map((entry) => ({
          path: entry.path,
          mode: entry.mode,
          ...entry.after
        }))
      ]
    }
    expect(() => assertControllerUpgradeCompatibility(old, next)).not.toThrow()
    expect(() => assertControllerUpgradeCompatibility(next, old)).toThrow('INCOMPATIBLE_RELEASE')
    for (const index of [0, 1, 2])
      for (const patch of [{ sha256: 'f'.repeat(64) }, { size: 1 }, { mode: 0o700 }] as const) {
        if (index === 0 && patch.mode === 0o700) continue
        expect(() =>
          assertControllerUpgradeCompatibility(old, {
            ...next,
            files: next.files.map((file, i) => (i === index ? { ...file, ...patch } : file))
          })
        ).toThrow('INCOMPATIBLE_RELEASE')
      }
    expect(() =>
      assertControllerUpgradeCompatibility(old, {
        ...next,
        files: [next.files[0], old.files[1], next.files[2]]
      })
    ).toThrow('INCOMPATIBLE_RELEASE')
    expect(() =>
      assertControllerUpgradeCompatibility(old, {
        ...next,
        files: [
          ...next.files,
          {
            path: 'payload/templates/other.Dockerfile',
            size: 1,
            mode: 0o600,
            sha256: 'd'.repeat(64)
          }
        ]
      })
    ).toThrow('INCOMPATIBLE_RELEASE')
    expect(() =>
      assertControllerUpgradeCompatibility(old, { ...next, lock_sha256: 'e'.repeat(64) })
    ).toThrow('INCOMPATIBLE_RELEASE')
    expect(() =>
      assertControllerUpgradeCompatibility(old, { ...next, node_version: '22.24.0' })
    ).toThrow('INCOMPATIBLE_RELEASE')
  })
  it('policy R7b giữ đúng frozen helper/template đã nghiệm thu, không tự chấp nhận helper env chưa release', () => {
    for (const entry of CONTROLLER_SPA_ASSET_TRANSITION) {
      const bytes = entry.path.endsWith('.py')
        ? gunzipSync(
            Buffer.from(
              JSON.parse(
                readFileSync(new URL('./fixtures/r7b-runtime.json', import.meta.url), 'utf8')
              ).gzip_base64,
              'base64'
            )
          )
        : readFileSync(new URL('../../../../templates/static-spa.Dockerfile', import.meta.url))
      expect(bytes.length).toBe(entry.after.size)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.after.sha256)
    }
    const current = readFileSync(new URL('./target_product_runtime.py', import.meta.url))
    expect(createHash('sha256').update(current).digest('hex')).not.toBe(
      CONTROLLER_SPA_ASSET_TRANSITION[0].after.sha256
    )
    const path = 'target-helper/target_product_runtime.py'
    expect(() =>
      assertRetainedTargetHelpers(
        'express',
        [
          { path, size: current.length, sha256: createHash('sha256').update(current).digest('hex') }
        ],
        [{ path, ...CONTROLLER_SPA_ASSET_TRANSITION[0].after }]
      )
    ).toThrow('TARGET_ENROLLMENT_HELPER_UPGRADE_REQUIRED')
  })
  it('allows explicit recovery staging but never accepts it for inspection or rollback', () => {
    expect(parseControllerUpgradeRequest({ ...input, operation: 'recover-upgrade' })).toMatchObject(
      { operation: 'recover-upgrade', release_directory: input.release_directory }
    )
    expect(() =>
      parseControllerUpgradeRequest({ ...input, operation: 'rollback-upgrade' })
    ).toThrow('INPUT_INVALID')
    expect(() =>
      parseControllerUpgradeRequest({
        ...input,
        operation: 'recover-upgrade',
        release_directory: '/tmp/../outside'
      })
    ).toThrow('INPUT_INVALID')
  })
  it('accepts explicit upgrade and inspect/recover/rollback with the same immutable authority', () => {
    expect(parseControllerUpgradeRequest(input)).toEqual(input)
    const { release_directory: _path, consent: _consent, ...authority } = input
    void _path
    void _consent
    expect(
      parseControllerUpgradeRequest({ ...authority, operation: 'inspect-upgrade' }).operation
    ).toBe('inspect-upgrade')
    for (const operation of ['recover-upgrade', 'rollback-upgrade'])
      expect(
        parseControllerUpgradeRequest({ ...authority, operation, consent: true }).operation
      ).toBe(operation)
  })
  it.each([
    { ...input, consent: false },
    { ...input, command: 'id' },
    { ...input, uid: 0 },
    { ...input, unit: '/other.service' },
    { ...input, release_directory: '/private/../elsewhere' },
    { ...input, release_directory: '/path with spaces' },
    { ...input, request_key: input.installation_request_key },
    { ...input, parent_upgrade_key: input.request_key },
    { ...input, release_sha256: input.parent_release_sha256 },
    { ...input, release_sha256: 'B'.repeat(64) },
    { ...input, operation: 'inspect-upgrade' },
    null
  ])('rejects missing consent, overrides and changed authority shape %#', (value) => {
    expect(() => parseControllerUpgradeRequest(value)).toThrow(
      'CONTROLLER_INSTALL_UPGRADE_INPUT_INVALID'
    )
  })
  it('keeps the original data/account and directs only the service runtime/config to a root revision', () => {
    const unit = renderUpgradedControllerUnit(
      controllerInstallerPaths,
      input.installation_request_key,
      input.request_key
    )
    expect(unit).toContain('/revisions/' + input.request_key + '/runtime/node')
    expect(unit).toContain(
      'StandardInput=file:/opt/opspilot-controller/revisions/' +
        input.request_key +
        '/execution.json'
    )
    expect(unit).toContain('ReadWritePaths=/var/lib/opspilot-controller\n')
    expect(unit).toContain('User=opspilot-controller\n')
    expect(unit).not.toContain('User=root\n')
  })
  it('allows only entrypoint/bundle digest changes; dependency, Node and helper drift are rejected', () => {
    const old = {
      format: 1,
      platform: 'linux-x64-glibc',
      node_version: '22.23.4',
      node_abi: '127',
      minimum_glibc: '2.39',
      lock_sha256: 'a'.repeat(64),
      payload_sha256: 'b'.repeat(64),
      packages: [],
      files: [
        { path: 'node', size: 1, mode: 0o700, sha256: 'c'.repeat(64) },
        { path: 'payload/control-plane.cjs', size: 2, mode: 0o600, sha256: 'd'.repeat(64) },
        {
          path: 'payload/target-helper/target_product_runtime.py',
          size: 3,
          mode: 0o600,
          sha256: 'e'.repeat(64)
        }
      ]
    } satisfies ControllerReleaseManifest
    expect(() =>
      assertControllerUpgradeCompatibility(old, {
        ...old,
        files: old.files.map((f) =>
          f.path.endsWith('.cjs') ? { ...f, size: 4, sha256: 'f'.repeat(64) } : f
        )
      })
    ).not.toThrow()
    expect(() => assertControllerUpgradeCompatibility(old, { ...old, node_abi: '128' })).toThrow(
      'INCOMPATIBLE_RELEASE'
    )
    expect(() =>
      assertControllerUpgradeCompatibility(old, { ...old, lock_sha256: '0'.repeat(64) })
    ).toThrow('INCOMPATIBLE_RELEASE')
    expect(() =>
      assertControllerUpgradeCompatibility(old, {
        ...old,
        files: old.files.map((f) => (f.path.endsWith('.py') ? { ...f, sha256: 'f'.repeat(64) } : f))
      })
    ).toThrow('INCOMPATIBLE_RELEASE')
  })
  it('refuses a desktop host before touching installed root state', async () => {
    if (process.platform !== 'win32') return
    await expect(executeControllerUpgrade(input)).rejects.toThrow(
      'CONTROLLER_INSTALL_ROOT_LINUX_NODE22_REQUIRED'
    )
  })
})
