import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const modules = process.env.OPSPILOT_R1_MODULES
const output = process.env.OPSPILOT_R1_ARTIFACT
if (!modules || !output) throw new Error('R1_MODULES_AND_ARTIFACT_REQUIRED')
const esbuild = createRequire(resolve(modules, 'package.json'))('esbuild')
mkdirSync(dirname(resolve(output)), { recursive: true })
await esbuild.build({
  entryPoints: [resolve(import.meta.dirname, 'entry.ts')],
  outfile: resolve(output),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external',
  plugins: [
    {
      name: 'migration-sql-raw-loader',
      setup(build) {
        build.onResolve({ filter: /\.(?:sql|py)\?raw$/ }, (args) => ({
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
console.log('R1_BUILD_OK')
