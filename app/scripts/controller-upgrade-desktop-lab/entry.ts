import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { DesktopControllerUpgrades } from '../../src/main/controlPlane/desktopControllerUpgrade'
import { DesktopControllerInstallations } from '../../src/main/controlPlane/desktopControllerInstallation'
import { SshManager } from '../../src/main/ssh/manager'
import { initializeDatabase } from '../../src/main/db'
import { controllerBootstrapScript } from '../../src/main/controlPlane/controllerSshBootstrap'
export { DesktopControllerUpgrades, DesktopControllerInstallations, SshManager, initializeDatabase }
export { closeDatabase } from '../../src/main/db'
export { VpsRepository } from '../../src/main/db/vpsRepository'
export { AesGcmCredentialCipher } from '../../src/main/crypto/credentialCipher'
export { loadSecret } from '../../src/main/crypto/credentials'
export { renderControllerUnit } from '../../src/main/controlPlane/controllerInstallation'
export { renderUpgradedControllerUnit } from '../../src/main/controlPlane/controllerUpgrade'
export {
  transferControllerRelease,
  callControllerBootstrap,
  callControllerUpgrade,
  controllerBootstrapScript
} from '../../src/main/controlPlane/controllerSshBootstrap'
export function labScript(nonce: string): { text: string; sha256: string } {
  if (!/^[a-f0-9]{12}$/.test(nonce)) throw Error('LAB_NONCE_REQUIRED')
  const root = '/opt/opspilot-controller-upgrade-desktop-lab-' + nonce
  const text = controllerBootstrapScript()
    .text.replace(
      'TRANSFER_ROOT = "/var/lib/opspilot-controller-transfer"',
      'TRANSFER_ROOT = ' + JSON.stringify(join(root, 'transfer'))
    )
    .replace(
      'upgrades = "/var/lib/opspilot-controller-upgrades"',
      'upgrades = ' + JSON.stringify(join(root, 'upgrade-transfers'))
    )
    .replace(
      /INSTALLATION_PATHS = \([\s\S]*?\n\)/,
      'INSTALLATION_PATHS = ' +
        JSON.stringify([
          root + '/state',
          root + '/installation',
          root + '/data',
          '/etc/systemd/system/opspilot-upgrade-desktop-' + nonce + '.service'
        ])
    )
  const diagnostic = text.replace(
    '    ) as error:\n        code = (',
    '    ) as error:\n        import sys\n        trace = error.__traceback__\n        while trace.tb_next: trace = trace.tb_next\n        sys.stderr.write(json.dumps({"fixture_error":type(error).__name__,"line":trace.tb_lineno,"errno":getattr(error,"errno",None)})+"\\n")\n        code = ('
  )
  return { text: diagnostic, sha256: createHash('sha256').update(diagnostic).digest('hex') }
}
if (require.main === module)
  void (async (): Promise<void> => {
    let text = ''
    for await (const chunk of process.stdin) {
      text += chunk
      if (text.length > 32768) throw Error('LAB_INPUT_LIMIT')
    }
    const input = JSON.parse(text)
    if (!/^[a-f0-9]{12}$/.test(input.nonce)) throw Error('LAB_NONCE_REQUIRED')
    const root = '/opt/opspilot-controller-upgrade-desktop-lab-' + input.nonce
    const db = initializeDatabase(join(root, 'desktop'))
    const ssh = new SshManager(() => ({ ...input.principal, secret: input.private_key }))
    try {
      const bootstrapScript = labScript(input.nonce)
      const installations = new DesktopControllerInstallations(db, ssh, [input.original], {
        bootstrapScript
      })
      const upgrades = new DesktopControllerUpgrades(db, installations, ssh, [input.target], {
        bootstrapScript
      })
      const before = upgrades.list(input.installation_key)
      const result = await upgrades.inspect(input.upgrade_key)
      console.log(
        JSON.stringify({
          before,
          result,
          schema: db.prepare('SELECT MAX(version) n FROM schema_version').get()
        })
      )
    } finally {
      await ssh.disconnectAll()
      db.close()
    }
  })().catch(() => {
    console.log(JSON.stringify({ error: 'LAB_COLD_INSPECT_FAILED' }))
    process.exitCode = 1
  })
