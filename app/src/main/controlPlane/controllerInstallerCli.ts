import { executeControllerInstallation } from './controllerInstallation'

/** Không có path/service/UID override hoặc secret/env fallback. */
export async function runControllerInstallerCli(): Promise<void> {
  let bytes = Buffer.alloc(0)
  const timer = setTimeout(() => process.stdin.destroy(Error('INPUT_TIMEOUT')), 15000)
  try {
    if (process.argv.length !== 2 || process.stdin.isTTY)
      throw Error('CONTROLLER_INSTALL_INPUT_INVALID')
    for await (const chunk of process.stdin) {
      if (bytes.length + chunk.length > 4096) throw Error('CONTROLLER_INSTALL_INPUT_INVALID')
      bytes = Buffer.concat([bytes, chunk])
    }
    clearTimeout(timer)
    const result = await executeControllerInstallation(JSON.parse(bytes.toString('utf8')))
    console.log(JSON.stringify(result))
  } catch (error) {
    const code =
      error instanceof Error && /^CONTROLLER_INSTALL_[A-Z_]+$/.test(error.message)
        ? error.message
        : 'CONTROLLER_INSTALL_INPUT_INVALID'
    console.log(JSON.stringify({ error: code }))
    process.exitCode = 1
  } finally {
    clearTimeout(timer)
  }
}

if (require.main === module) void runControllerInstallerCli()
