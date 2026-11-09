import { describe, it, expect } from 'vitest'
import type { InstalledControllerAdminRequest } from '../../../../docs/contracts/product-installed-controller-admin'
import {
  executeInstalledControllerAdmin,
  installedControllerAdminSchema
} from './controllerInstalledAdmin'
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
