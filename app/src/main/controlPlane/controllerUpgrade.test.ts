import { describe, expect, it } from 'vitest'
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
