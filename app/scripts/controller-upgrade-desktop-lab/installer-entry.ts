import { executeControllerInstallation } from '../../src/main/controlPlane/controllerInstallation'
import { executeControllerUpgrade } from '../../src/main/controlPlane/controllerUpgrade'
void (async (): Promise<void> => {
  const nonce = process.env.OPSPILOT_SERVICE_LAB_NONCE
  if (!nonce || !/^[a-f0-9]{12}$/.test(nonce)) throw Error('LAB_NONCE_REQUIRED')
  const root = '/opt/opspilot-controller-upgrade-desktop-lab-' + nonce
  let bytes = ''
  for await (const part of process.stdin) {
    bytes += part
    if (bytes.length > 4096) throw Error('LAB_INPUT_LIMIT')
  }
  const input = JSON.parse(bytes)
  const paths = {
    state: root + '/state',
    installation: root + '/installation',
    data: root + '/data',
    unit: '/etc/systemd/system/opspilot-upgrade-desktop-' + nonce + '.service',
    account: 'opsud' + nonce
  }
  const result = ['upgrade', 'inspect-upgrade', 'recover-upgrade', 'rollback-upgrade'].includes(
    input.operation
  )
    ? await executeControllerUpgrade(input, paths)
    : await executeControllerInstallation(input, paths)
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
