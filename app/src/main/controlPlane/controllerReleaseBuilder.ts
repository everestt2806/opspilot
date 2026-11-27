import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import {
  CONTROLLER_RELEASE_LIMITS as limits,
  CONTROLLER_RELEASE_MANIFEST,
  type ControllerReleaseManifest
} from '../../../../docs/contracts/product-controller-release'
import { readVerifiedControllerBundleFile, verifyControllerBundle } from './controllerBundle'
import {
  assertLinuxX64Elf,
  assertReleaseDirectory,
  controllerRuntimeLock,
  productionPackages,
  readReleaseFile,
  releasePath,
  releaseSha256,
  scanRelease,
  verifyControllerRelease
} from './controllerRelease'

/** Developer/CI tool, không gọi từ IPC. Input modules + Node là trusted build environment. */
export function buildControllerRelease(input: {
  modules: string
  artifact: string
  payloadPin: string
  output: string
}): { directory: string; manifest_sha256: string; files: number; bytes: number } {
  const glibc = (process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header
    .glibcVersionRuntime
  if (
    process.platform !== 'linux' ||
    process.arch !== 'x64' ||
    process.versions.node.split('.')[0] !== '22' ||
    !glibc ||
    !/^\d+\.\d+$/.test(glibc)
  )
    throw Error('CONTROLLER_RELEASE_BUILD_REQUIRES_LINUX_X64_GLIBC_NODE22')
  if (
    ![input.modules, input.artifact, input.output].every(isAbsolute) ||
    basename(input.artifact) !== 'control-plane.cjs'
  )
    throw Error('INVALID_RELEASE_BUILD_INPUT')
  const output = resolve(input.output)
  if (existsSync(output)) throw Error('RELEASE_DESTINATION_EXISTS')
  assertReleaseDirectory(dirname(output))
  assertReleaseDirectory(input.modules)
  const bundle = verifyControllerBundle(input.artifact, input.payloadPin)
  const packageRecords = productionPackages().filter((item) => {
    const path = join(dirname(input.modules), item.path)
    if (!existsSync(path) && item.optional) return false
    assertReleaseDirectory(path)
    const metadata = JSON.parse(readReleaseFile(join(path, 'package.json'), limits.file).toString())
    if (metadata.name !== item.name || metadata.version !== item.version)
      throw Error('RUNTIME_LOCK_MISMATCH')
    return true
  })
  // Smoke chỉ trusted build inputs. Không chạy candidate để tự xác minh.
  const require = createRequire(join(input.modules, 'package.json'))
  const Database = require('better-sqlite3')
  const db = new Database(':memory:')
  try {
    if (db.prepare('SELECT 1 AS ok').get().ok !== 1) throw Error('RUNTIME_SQLITE_FAILED')
  } finally {
    db.close()
  }
  for (const name of ['ssh2', 'tar', 'zod']) require(name)

  const stage = output + '.building-' + randomBytes(8).toString('hex')
  mkdirSync(stage, { mode: 0o700 })
  const records: Array<{ path: string; size: number; sha256: string; mode: 384 | 448 }> = []
  let total = 0
  const put = (path: string, bytes: Buffer): void => {
    const cap = path === 'node' ? limits.node : limits.file
    total += bytes.length
    if (
      !releasePath(path) ||
      records.length >= limits.files ||
      bytes.length > cap ||
      total > limits.total
    )
      throw Error('RELEASE_BUILD_LIMIT')
    if (path === 'node' || path.endsWith('.node')) assertLinuxX64Elf(bytes)
    const mode = path === 'node' ? 0o700 : 0o600
    mkdirSync(dirname(join(stage, path)), { mode: 0o700, recursive: true })
    writeFileSync(join(stage, path), bytes, { mode, flag: 'wx' })
    chmodSync(join(stage, path), mode)
    records.push({ path, size: bytes.length, sha256: releaseSha256(bytes), mode })
  }
  // Không xóa stage khi lỗi: giữ bounded evidence, không đụng destination cũ.
  put('node', readReleaseFile(process.execPath, limits.node))
  put('runtime-lock.json', controllerRuntimeLock)
  for (const path of scanRelease(bundle.root_directory))
    put('payload/' + path, readVerifiedControllerBundleFile(bundle, path))
  function copyPackage(source: string, relative: string, nested = ''): void {
    if (nested.length > 512 || nested.split('/').length > 32) throw Error('RELEASE_BUILD_LIMIT')
    assertReleaseDirectory(source)
    for (const name of readdirSync(source)) {
      const local = nested + name
      if (
        [
          'node_modules',
          'test',
          'tests',
          '__tests__',
          'fixtures',
          'docs',
          'doc',
          'examples',
          'example',
          'bench',
          'benchmark',
          'benchmarks',
          '.github',
          '.git',
          '.bin',
          'obj.target'
        ].includes(name)
      )
        continue
      if (
        relative === 'node_modules/better-sqlite3' &&
        nested === 'prebuilds/' &&
        name !== 'linux-x64.node'
      )
        continue
      const file = join(source, name)
      const info = lstatSync(file)
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()))
        throw Error('UNSAFE_MODULE_ENTRY')
      if (info.isDirectory()) copyPackage(file, relative, local + '/')
      else {
        if (local.split('/').includes('build') && !local.endsWith('.node')) continue
        if (
          /\.(?:o|a|obj|pdb|dll|exe|dylib|db|sqlite3?|map|pem|key|p12|pfx|log)$/.test(name) ||
          name.startsWith('.env')
        )
          continue
        // node-gyp tạo hardlink trong trusted build tree; output luôn copy bytes sang inode mới.
        put(relative + '/' + local, readReleaseFile(file, limits.file, true))
      }
    }
  }
  for (const item of packageRecords) copyPackage(join(dirname(input.modules), item.path), item.path)
  const manifest: ControllerReleaseManifest = {
    format: 1,
    platform: 'linux-x64-glibc',
    node_version: process.versions.node,
    node_abi: process.versions.modules,
    minimum_glibc: glibc,
    payload_sha256: input.payloadPin,
    lock_sha256: releaseSha256(controllerRuntimeLock),
    packages: packageRecords.map(({ path, name, version }) => ({ path, name, version })),
    files: records.sort((a, b) => (a.path < b.path ? -1 : 1))
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n')
  if (manifestBytes.length > limits.manifest) throw Error('RELEASE_BUILD_LIMIT')
  writeFileSync(join(stage, CONTROLLER_RELEASE_MANIFEST), manifestBytes, {
    mode: 0o600,
    flag: 'wx'
  })
  const pin = releaseSha256(manifestBytes)
  verifyControllerRelease(stage, pin)
  if (existsSync(output)) throw Error('RELEASE_DESTINATION_EXISTS')
  renameSync(stage, output)
  return { directory: output, manifest_sha256: pin, files: records.length, bytes: total }
}
