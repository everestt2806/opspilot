import { copyFileSync, mkdirSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'

const root = resolve(import.meta.dirname, '..')
const runtimeDirectory = resolve(root, 'control-plane-runtime')
const outputFile = resolve(
  process.env.OPSPILOT_CONTROL_PLANE_OUTPUT ?? resolve(runtimeDirectory, 'dist/control-plane.cjs')
)
const buildModules = resolve(
  process.env.OPSPILOT_CONTROL_PLANE_MODULES ?? resolve(runtimeDirectory, 'node_modules')
)
const esbuild = createRequire(import.meta.url)(resolve(buildModules, 'esbuild'))

mkdirSync(dirname(outputFile), { recursive: true })
await esbuild.build({
  entryPoints: [resolve(root, 'src/main/controlPlane/cli.ts')],
  outfile: outputFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external',
  sourcemap: false,
  minify: false,
  plugins: [
    {
      name: 'migration-sql-raw-loader',
      setup(build) {
        build.onResolve({ filter: /\.sql\?raw$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path.replace(/\?raw$/, '')),
          namespace: 'migration-sql'
        }))
        build.onLoad({ filter: /.*/, namespace: 'migration-sql' }, (args) => ({
          contents: readFileSync(args.path, 'utf8'),
          loader: 'text'
        }))
      }
    }
  ]
})
const helperDirectory = resolve(dirname(outputFile), 'target-helper')
mkdirSync(helperDirectory, { recursive: true, mode: 0o700 })
copyFileSync(
  resolve(root, 'src/main/controlPlane/target_guarded_ssh_helper.py'),
  resolve(helperDirectory, 'target_guarded_ssh_helper.py')
)
copyFileSync(
  resolve(root, 'src/main/controlPlane/target_execution_guard.py'),
  resolve(helperDirectory, 'target_execution_guard.py')
)
console.log(`CONTROL_PLANE_BUILD_OK ${outputFile}`)
