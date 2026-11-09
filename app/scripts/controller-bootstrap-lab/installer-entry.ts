import { executeControllerInstallation } from '../../src/main/controlPlane/controllerInstallation'
import { executeInstalledControllerAdmin } from '../../src/main/controlPlane/controllerInstalledAdmin'

/** Baked fixture namespace only. Production JSON never accepts paths or account overrides. */
void (async (): Promise<void> => {
  const nonce = process.env.OPSPILOT_SERVICE_LAB_NONCE
  if (!nonce || !/^[a-f0-9]{12}$/.test(nonce)) throw Error('LAB_NONCE_REQUIRED')
  const root = '/opt/opspilot-controller-service-lab-' + nonce
  let bytes = Buffer.alloc(0)
  for await (const part of process.stdin) {
    if (bytes.length + part.length > 512 * 1024) throw Error('CONTROLLER_INSTALL_INPUT_INVALID')
    bytes = Buffer.concat([bytes, part])
  }
  const request = JSON.parse(bytes.toString('utf8'))
  const paths = {
    state: root + '/state',
    installation: root + '/installation',
    data: root + '/data',
    unit: '/etc/systemd/system/opspilot-lab-' + nonce + '.service',
    account: 'opslab' + nonce
  }
  const result = await (request.operation === 'admin'
    ? executeInstalledControllerAdmin(request, paths)
    : executeControllerInstallation(request, paths))
  console.log(JSON.stringify(result))
})().catch((error: unknown) => {
  console.log(
    JSON.stringify({
      error:
        error instanceof Error && /^CONTROLLER_INSTALL_[A-Z_]+$/.test(error.message)
          ? error.message
          : 'CONTROLLER_INSTALL_LAB_FAILED'
    })
  )
  process.exitCode = 1
})
