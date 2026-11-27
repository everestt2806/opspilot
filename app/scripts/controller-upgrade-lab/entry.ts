import {
  executeControllerInstallation,
  renderControllerUnit
} from '../../src/main/controlPlane/controllerInstallation'
import {
  executeControllerUpgrade,
  renderUpgradedControllerUnit
} from '../../src/main/controlPlane/controllerUpgrade'
export { executeControllerUpgrade, renderControllerUnit, renderUpgradedControllerUnit }
export { verifyControllerRelease } from '../../src/main/controlPlane/controllerRelease'

if (require.main === module)
  void (async (): Promise<void> => {
    const nonce = process.env.OPSPILOT_UPGRADE_LAB_NONCE
    if (!nonce || !/^[a-f0-9]{12}$/.test(nonce)) throw Error('LAB_NONCE_REQUIRED')
    const root = '/opt/opspilot-controller-upgrade-lab-' + nonce
    const paths = {
      state: root + '/state',
      installation: root + '/installation',
      data: root + '/data',
      unit: '/etc/systemd/system/opspilot-upgrade-lab-' + nonce + '.service',
      account: 'opsup' + nonce
    }
    let bytes = ''
    for await (const chunk of process.stdin) {
      bytes += chunk
      if (Buffer.byteLength(bytes) > 4096) throw Error('LAB_INPUT_LIMIT')
    }
    const input = JSON.parse(bytes)
    const result = ['upgrade', 'inspect-upgrade', 'recover-upgrade', 'rollback-upgrade'].includes(
      input.operation
    )
      ? await executeControllerUpgrade(input, paths, {
          afterEffect: (phase) => {
            if (process.env.OPSPILOT_UPGRADE_LAB_CRASH === phase)
              process.kill(process.pid, 'SIGKILL')
          },
          schemaEffect: (phase) => {
            if (process.env.OPSPILOT_UPGRADE_LAB_CRASH_SCHEMA === phase)
              process.kill(process.pid, 'SIGKILL')
          }
        })
      : await executeControllerInstallation(input, paths)
    console.log(JSON.stringify(result))
  })().catch((error: unknown) => {
    console.log(
      JSON.stringify({
        error:
          error instanceof Error && /^CONTROLLER_INSTALL_[A-Z_]+$/.test(error.message)
            ? error.message
            : 'LAB_UPGRADE_FAILED'
      })
    )
    process.exitCode = 1
  })
