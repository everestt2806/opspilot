import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'

const modules = process.env.OPSPILOT_CONTROL_PLANE_MODULES
const output = process.env.OPSPILOT_CONTROLLER_INSTALLER_OUTPUT
if (!modules || !output) throw Error('INSTALLER_BUILD_INPUT_REQUIRED')
const require = createRequire(import.meta.url)
const esbuild = require(resolve(modules, 'esbuild'))
mkdirSync(dirname(resolve(output)), { recursive: true, mode: 0o700 })
await esbuild.build({
  entryPoints: [resolve(import.meta.dirname, '../src/main/controlPlane/controllerInstallerCli.ts')],
  outfile: resolve(output),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external'
})
console.log(
  JSON.stringify({
    state: 'trusted_installer_built',
    sha256: createHash('sha256').update(readFileSync(output)).digest('hex')
  })
)
