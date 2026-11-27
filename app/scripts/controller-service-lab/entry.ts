import { executeControllerInstallation } from '../../src/main/controlPlane/controllerInstallation'
export {
  executeControllerInstallation,
  renderControllerUnit
} from '../../src/main/controlPlane/controllerInstallation'
export { verifyControllerRelease } from '../../src/main/controlPlane/controllerRelease'

// Trusted lab executable, không phải production installer CLI; chỉ nonce fixture /opt riêng.
if (require.main === module) {
  void (async (): Promise<void> => {
    const nonce = process.env.OPSPILOT_SERVICE_LAB_NONCE
    if (!nonce || !/^[a-f0-9]{12}$/.test(nonce)) throw Error('LAB_NONCE_REQUIRED')
    const root = '/opt/opspilot-controller-service-lab-' + nonce
    let input = ''
    for await (const chunk of process.stdin) {
      if (Buffer.byteLength(input) + chunk.length > 4096) throw Error('LAB_INPUT_LIMIT')
      input += chunk
    }
    const result = await executeControllerInstallation(
      JSON.parse(input),
      {
        state: root + '/state',
        installation: root + '/installation',
        data: root + '/data',
        unit: '/etc/systemd/system/opspilot-lab-' + nonce + '.service',
        account: 'opslab' + nonce
      },
      {
        afterEffect: (phase) => {
          if (process.env.OPSPILOT_SERVICE_LAB_CRASH === phase) process.kill(process.pid, 'SIGKILL')
        }
      }
    )
    console.log(JSON.stringify(result))
  })().catch((error: unknown) => {
    console.log(
      JSON.stringify({
        error:
          error instanceof Error && /^CONTROLLER_INSTALL_[A-Z_]+$/.test(error.message)
            ? error.message
            : 'LAB_FAILED'
      })
    )
    process.exitCode = 1
  })
}
