import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { createHash, randomBytes } from 'node:crypto'

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
if (lstatSync(dirname(outputFile)).isSymbolicLink()) throw new Error('INVALID_BUNDLE_DIRECTORY')
try {
  const old = lstatSync(outputFile)
  if (!old.isFile() || old.isSymbolicLink() || old.nlink !== 1)
    throw new Error('INVALID_BUNDLE_DESTINATION')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
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
const catalog = JSON.parse(readFileSync(join(runtimeDirectory, 'bundle-files.json'), 'utf8'))
const directory = dirname(outputFile)
const files = [{ path: basename(outputFile), bytes: readFileSync(outputFile) }]
for (const [path, source] of Object.entries(catalog)) {
  if (/[^A-Za-z0-9_./-]/.test(path)) throw new Error('INVALID_BUNDLE_CATALOG')
  if (!/^(target-helper|templates|collector)\/[A-Za-z0-9_.-]+$/.test(path))
    throw new Error('INVALID_BUNDLE_CATALOG')
  const input = resolve(root, '..', source)
  if (!lstatSync(input).isFile() || lstatSync(input).isSymbolicLink())
    throw new Error('INVALID_BUNDLE_SOURCE')
  const bytes = readFileSync(input)
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('INVALID_BUNDLE_SOURCE')
  const destination = join(directory, path)
  try {
    const old = lstatSync(destination)
    if (!old.isFile() || old.isSymbolicLink() || old.nlink !== 1)
      throw new Error('INVALID_BUNDLE_DESTINATION')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
  if (lstatSync(dirname(destination)).isSymbolicLink()) throw new Error('INVALID_BUNDLE_DIRECTORY')
  const fd = openSync(
    destination,
    constants.O_WRONLY | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0),
    0o600
  )
  try {
    if (!fstatSync(fd).isFile() || fstatSync(fd).nlink !== 1)
      throw new Error('INVALID_BUNDLE_DESTINATION')
    // File đã mở và kiểm trước khi truncate; không đi theo link hoặc đè hardlink khác.
    ftruncateSync(fd, 0)
    writeFileSync(fd, bytes)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  files.push({ path, bytes })
}
files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
if (
  files.some(({ bytes }) => !bytes.length || bytes.length > 8 * 1024 * 1024) ||
  files.reduce((total, { bytes }) => total + bytes.length, 0) > 16 * 1024 * 1024
)
  throw new Error('BUNDLE_TOO_LARGE')
const manifest = Buffer.from(
  JSON.stringify(
    {
      format: 1,
      node_major: 22,
      entrypoint: basename(outputFile),
      files: files.map(({ path, bytes }) => ({
        path,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex')
      }))
    },
    null,
    2
  ) + '\n'
)
const temporary = join(directory, `.bundle-manifest-${randomBytes(6).toString('hex')}.tmp`)
let fd
try {
  fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
  writeFileSync(fd, manifest)
  fsyncSync(fd)
  closeSync(fd)
  fd = undefined
  renameSync(temporary, join(directory, 'bundle-manifest.json'))
  if (process.platform !== 'win32') {
    const parent = openSync(directory, constants.O_RDONLY)
    try {
      fsyncSync(parent)
    } finally {
      closeSync(parent)
    }
  }
} finally {
  if (fd !== undefined) closeSync(fd)
  rmSync(temporary, { force: true })
}
console.log(`CONTROL_PLANE_BUILD_OK ${outputFile}`)
console.log(
  JSON.stringify({
    manifest_sha256: createHash('sha256').update(manifest).digest('hex'),
    files: files.length
  })
)
