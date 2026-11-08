import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Không tự tải Node/dependencies; caller cung cấp môi trường Linux từ approved lock.
if (process.platform !== 'linux' || process.arch !== 'x64' || !process.version.startsWith('v22.'))
  throw Error('LINUX_X64_NODE22_REQUIRED')
const modules = process.env.OPSPILOT_CONTROL_PLANE_MODULES
const artifact = process.env.OPSPILOT_CONTROLLER_RELEASE_ARTIFACT
const pin = process.env.OPSPILOT_CONTROLLER_RELEASE_PAYLOAD_PIN
const output = process.env.OPSPILOT_CONTROLLER_RELEASE_OUTPUT
if (!modules || !artifact || !pin || !output) throw Error('RELEASE_BUILD_INPUT_REQUIRED')
const toolsDirectory = resolve(import.meta.dirname, '../.out-scripts/controller-release-tools')
mkdirSync(toolsDirectory, { recursive: true, mode: 0o700 })
const require = createRequire(import.meta.url)
const esbuild = require(resolve(modules, 'esbuild'))
const tool = resolve(toolsDirectory, 'builder.cjs')
await esbuild.build({
  entryPoints: [
    resolve(import.meta.dirname, '../src/main/controlPlane/controllerReleaseBuilder.ts')
  ],
  outfile: tool,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external'
})
const receipt = require(tool).buildControllerRelease({ modules, artifact, payloadPin: pin, output })
console.log(JSON.stringify({ state: 'release_built_verified', ...receipt }))
