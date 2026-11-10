import { createRequire } from 'node:module'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  fsyncSync,
  fstatSync
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

if (!process.version.startsWith('v22.')) throw Error('NODE22_REQUIRED')
const args = process.argv.slice(2)
const keys = ['--release', '--installer', '--release-pin', '--installer-pin', '--id']
if (
  args.length !== keys.length * 2 ||
  keys.some((key) => args.filter((v) => v === key).length !== 1)
)
  throw Error('STAGE_INPUT_INVALID')
const values = Object.fromEntries(keys.map((key) => [key, args[args.indexOf(key) + 1]]))
if (
  !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(values['--id']) ||
  !['--release-pin', '--installer-pin'].every((key) => /^[a-f0-9]{64}$/.test(values[key]))
)
  throw Error('STAGE_INPUT_INVALID')
const app = resolve(import.meta.dirname, '..'),
  root = join(app, 'resources/controller-releases')
const require = createRequire(import.meta.url)
const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
const tool = join(app, '.out-scripts/controller-resource-tools/verifier.cjs')
mkdirSync(dirname(tool), { recursive: true })
await esbuild.build({
  entryPoints: [join(app, 'src/main/controlPlane/controllerInstallerCatalog.ts')],
  outfile: tool,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'bundle'
})
const { ControllerInstallerResources, controllerInstallerCatalogSchema } = require(tool)
const sourceRelease = resolve(values['--release']),
  sourceInstaller = resolve(values['--installer'])
const raw = readFileSync(join(sourceRelease, 'release-manifest.json'))
if (raw.length > 2 * 1024 * 1024) throw Error('STAGE_INPUT_INVALID')
const manifest = JSON.parse(raw)
const descriptor = {
  release_id: values['--id'],
  node_version: manifest.node_version,
  minimum_glibc: manifest.minimum_glibc,
  release_sha256: values['--release-pin'],
  installer_sha256: values['--installer-pin']
}
controllerInstallerCatalogSchema.parse({ format: 1, releases: [descriptor] })
mkdirSync(root, { recursive: true })
if (lstatSync(root).isSymbolicLink()) throw Error('STAGE_OUTPUT_INVALID')
const lockFile = join(root, '.stage.lock'),
  lock = openSync(lockFile, 'wx', 0o600),
  lockInfo = fstatSync(lock)
const nonce = randomUUID(),
  temporary = join(root, '.preparing-' + nonce),
  destination = join(root, descriptor.release_id)
try {
  if (existsSync(destination)) throw Error('RELEASE_ALREADY_STAGED')
  const catalogFile = join(root, 'catalog.json')
  const old = existsSync(catalogFile)
    ? controllerInstallerCatalogSchema.parse(JSON.parse(readFileSync(catalogFile, 'utf8')))
    : { format: 1, releases: [] }
  if (old.releases.some((v) => v.release_id === descriptor.release_id))
    throw Error('RELEASE_ALREADY_STAGED')
  const previous = new ControllerInstallerResources(old, root)
  for (const release of old.releases) previous.verify(release.release_id)
  mkdirSync(temporary, { mode: 0o700 })
  const temporaryRelease = join(temporary, descriptor.release_id)
  mkdirSync(temporaryRelease, { mode: 0o700 })
  cpSync(sourceRelease, join(temporaryRelease, 'release'), {
    recursive: true,
    errorOnExist: true,
    force: false
  })
  cpSync(sourceInstaller, join(temporaryRelease, 'installer.cjs'), {
    errorOnExist: true,
    force: false
  })
  new ControllerInstallerResources({ format: 1, releases: [descriptor] }, temporary).verify(
    descriptor.release_id
  )
  renameSync(temporaryRelease, destination)
  const catalog = controllerInstallerCatalogSchema.parse({
    format: 1,
    releases: [...old.releases, descriptor]
  })
  const file = join(root, '.catalog-' + nonce),
    fd = openSync(file, 'wx', 0o600)
  try {
    writeFileSync(fd, JSON.stringify(catalog, null, 2) + '\n')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(file, catalogFile)
  console.log(
    JSON.stringify({
      state: 'controller_resources_staged',
      release_id: descriptor.release_id,
      release_sha256: descriptor.release_sha256,
      installer_sha256: descriptor.installer_sha256
    })
  )
} finally {
  closeSync(lock)
  // Cleanup is limited to this newly generated staging directory and its original lock inode.
  if (
    resolve(temporary).startsWith(resolve(root) + sep) &&
    temporary === join(root, '.preparing-' + nonce) &&
    existsSync(temporary) &&
    !lstatSync(temporary).isSymbolicLink()
  )
    rmSync(temporary, { recursive: true })
  if (existsSync(lockFile)) {
    const now = lstatSync(lockFile)
    if (
      now.isFile() &&
      !now.isSymbolicLink() &&
      now.ino === lockInfo.ino &&
      now.dev === lockInfo.dev
    )
      rmSync(lockFile)
  }
}
