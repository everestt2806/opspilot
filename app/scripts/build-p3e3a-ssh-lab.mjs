import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const appRoot = resolve(import.meta.dirname, '..')
const outputFile = resolve(
  process.env.OPSPILOT_P3E3A_LAB_ARTIFACT ?? '/var/tmp/opspilot-p3e3a-lab.cjs'
)
const modules = resolve(
  process.env.OPSPILOT_P3E3A_MODULES ?? '/var/tmp/opspilot-p3e3a-runtime/node_modules'
)
const esbuild = createRequire(resolve(modules, 'package.json'))('esbuild')
mkdirSync(resolve(outputFile, '..'), { recursive: true })
await esbuild.build({
  entryPoints: [resolve(appRoot, 'scripts/p3e3a-guarded-ssh-lab-entry.ts')],
  outfile: outputFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external',
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
console.log(`P3E3A_LAB_BUILD_OK ${outputFile}`)
