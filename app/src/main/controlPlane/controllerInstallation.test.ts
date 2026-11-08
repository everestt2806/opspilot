import { describe, expect, it } from 'vitest'
import {
  controllerInstallerPaths,
  executeControllerInstallation,
  parseControllerInstallationRequest,
  renderControllerUnit
} from './controllerInstallation'

const request = {
  format: 1,
  operation: 'install',
  request_key: '11111111-1111-4111-8111-111111111111',
  consent: true,
  release_directory: '/private/release',
  release_sha256: 'a'.repeat(64)
}
describe('Controller installation contract and privilege boundary', () => {
  it('accepts only explicit install/inspect/same-pin recover shapes', () => {
    expect(parseControllerInstallationRequest(request)).toEqual(request)
    expect(
      parseControllerInstallationRequest({
        format: 1,
        operation: 'inspect',
        request_key: request.request_key
      }).operation
    ).toBe('inspect')
    expect(
      parseControllerInstallationRequest({
        format: 1,
        operation: 'recover',
        request_key: request.request_key,
        consent: true,
        release_sha256: request.release_sha256
      }).operation
    ).toBe('recover')
  })
  it.each([
    { ...request, consent: false },
    { ...request, consent: undefined },
    { ...request, operation: 'restart' },
    { ...request, request_key: '../escape' },
    { ...request, release_directory: '/private/../release' },
    { ...request, release_directory: '/path with spaces' },
    { ...request, release_directory: '/private/release\n' },
    { ...request, release_sha256: 'A'.repeat(64) },
    { ...request, release_sha256: 'a'.repeat(64) + '\n' },
    { ...request, uid: 0 },
    { ...request, command: 'id' },
    { ...request, service: 'other.service' },
    { ...request, secret: 'SYNTHETIC' },
    { format: 1, operation: 'recover', request_key: request.request_key, consent: true },
    { format: 1, operation: 'inspect', request_key: request.request_key, consent: true },
    null,
    []
  ])('rejects malformed input/override without mutation %#', (value) => {
    expect(() => parseControllerInstallationRequest(value)).toThrow(
      'CONTROLLER_INSTALL_INPUT_INVALID'
    )
  })
  it('renders explicit non-root sandboxed system unit and no public API settings', () => {
    const unit = renderControllerUnit(controllerInstallerPaths, request.request_key)
    expect(unit).toContain('User=opspilot-controller\nGroup=opspilot-controller')
    expect(unit).toContain('ProtectSystem=strict\nProtectHome=true')
    expect(unit).toContain('StandardInput=file:/opt/opspilot-controller/execution.json')
    expect(unit).toContain(
      '/runtime/node /opt/opspilot-controller/runtime/payload/control-plane.cjs run-product --data-dir /var/lib/opspilot-controller'
    )
    expect(unit).not.toContain('User=root')
    expect(unit).not.toContain('0.0.0.0')
    expect(unit).not.toContain('sudo')
  })
  it.each([
    { ...controllerInstallerPaths, account: 'root;whoami' },
    { ...controllerInstallerPaths, account: 'root' },
    { ...controllerInstallerPaths, data: '/var/lib/../other' },
    { ...controllerInstallerPaths, unit: '/etc/systemd/system/other\n.service' }
  ])('rejects unsafe trusted platform configuration before rendering', (paths) => {
    expect(() => renderControllerUnit(paths, request.request_key)).toThrow(
      'CONTROLLER_INSTALL_PATHS_INVALID'
    )
  })
  it('refuses unsupported desktop host before touching root paths', async () => {
    if (process.platform !== 'win32') return
    await expect(executeControllerInstallation(request)).rejects.toThrow(
      'CONTROLLER_INSTALL_ROOT_LINUX_NODE22_REQUIRED'
    )
  })
})
