import { describe, it, expect } from 'vitest'
import type { InstalledControllerAdminRequest } from '../../../../docs/contracts/product-installed-controller-admin'
import {
  executeInstalledControllerAdmin,
  installedControllerAdminSchema
} from './controllerInstalledAdmin'
import { assertControllerUpgradeAdminReady } from './controllerUpgradeProtocol'
const request = (): InstalledControllerAdminRequest => ({
  format: 1,
  operation: 'admin',
  authority: {
    request_key: '11111111-1111-4111-8111-111111111111',
    release_sha256: 'a'.repeat(64),
    installer_sha256: 'b'.repeat(64),
    controller_id: '22222222-2222-4222-8222-222222222222',
    runtime_uid: 1001,
    payload_sha256: 'c'.repeat(64)
  },
  command: { operation: 'status', payload: {} }
})
describe('trusted installed admin boundary', () => {
  const current = {
    format: 1,
    request_key: '11111111-1111-4111-8111-111111111111',
    installation_request_key: '33333333-3333-4333-8333-333333333333',
    controller_id: '22222222-2222-4222-8222-222222222222',
    parent_upgrade_key: null,
    parent_release_sha256: 'a'.repeat(64),
    release_sha256: 'b'.repeat(64),
    payload_sha256: 'c'.repeat(64),
    runtime_release_sha256: 'b'.repeat(64),
    runtime_payload_sha256: 'c'.repeat(64),
    runtime_upgrade_key: '11111111-1111-4111-8111-111111111111',
    phase: 'active',
    is_current: true,
    service_state: 'running',
    runtime_uid: 1001,
    artifact_path: '/opt/controller/payload/control-plane.cjs',
    node_path: '/opt/controller/node',
    data_directory: '/var/lib/controller'
  }
  it.each([
    { is_current: false },
    { service_state: 'maintenance' },
    { service_state: 'stopped' },
    { phase: 'commit_pending' },
    { phase: 'rollback_commit_pending' },
    { runtime_uid: 0 }
  ])('rejects unsettled or non-current admin evidence %#', (patch) => {
    expect(() => assertControllerUpgradeAdminReady({ ...current, ...patch })).toThrow(
      'ADMIN_NOT_READY'
    )
  })
  it('admits only current running settled operation evidence, including explicit rollback outcome', () => {
    expect(() => assertControllerUpgradeAdminReady(current)).not.toThrow()
    expect(() =>
      assertControllerUpgradeAdminReady({ ...current, phase: 'rolled_back' })
    ).not.toThrow()
  })
  it('accepts a strict revision authority while rejecting caller paths and incomplete parents', () => {
    const value = request()
    value.authority.revision = {
      installation_request_key: '33333333-3333-4333-8333-333333333333',
      parent_upgrade_key: null,
      parent_release_sha256: 'd'.repeat(64)
    }
    expect(installedControllerAdminSchema.safeParse(value).success).toBe(true)
    expect(
      installedControllerAdminSchema.safeParse({
        ...value,
        authority: {
          ...value.authority,
          revision: { ...value.authority.revision, artifact_path: '/foreign' }
        }
      }).success
    ).toBe(false)
    expect(
      installedControllerAdminSchema.safeParse({
        ...value,
        authority: {
          ...value.authority,
          revision: { ...value.authority.revision, parent_release_sha256: undefined }
        }
      }).success
    ).toBe(false)
  })
  it.each(['uid', 'gid', 'path', 'command', 'pin', 'uuid'] as const)(
    'rejects caller %s override',
    async (kind) => {
      const value: Record<string, unknown> = request()
      if (kind === 'uid') (value.authority as Record<string, unknown>).runtime_uid = 0
      if (kind === 'gid') (value.authority as Record<string, unknown>).gid = 0
      if (kind === 'path') value.artifact_path = '/foreign'
      if (kind === 'command') value.command = { operation: 'exec', payload: { command: 'id' } }
      if (kind === 'pin') (value.authority as Record<string, unknown>).release_sha256 = 'untrusted'
      if (kind === 'uuid') (value.authority as Record<string, unknown>).request_key = 'arbitrary'
      expect(installedControllerAdminSchema.safeParse(value).success).toBe(false)
      await expect(executeInstalledControllerAdmin(value)).rejects.toThrow(
        'CONTROLLER_INSTALL_ADMIN_INPUT_INVALID'
      )
    }
  )
  it.runIf(process.platform !== 'linux')(
    'does not spawn a service administrator on unsupported hosts',
    async () => {
      await expect(executeInstalledControllerAdmin(request())).rejects.toThrow(
        'CONTROLLER_INSTALL_ROOT_LINUX_NODE22_REQUIRED'
      )
    }
  )
})
