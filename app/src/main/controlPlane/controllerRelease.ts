import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import approvedLock from '../../../control-plane-runtime/package-lock.json'
import {
  CONTROLLER_RELEASE_LIMITS as limits,
  CONTROLLER_RELEASE_MANIFEST,
  type ControllerReleaseManifest
} from '../../../../docs/contracts/product-controller-release'
import { verifyControllerBundle } from './controllerBundle'

export const controllerRuntimeLock = Buffer.from(JSON.stringify(approvedLock) + '\n')
export const releaseSha256 = (value: Buffer): string =>
  createHash('sha256').update(value).digest('hex')

export function releasePath(value: string): boolean {
  return (
    value.length <= 512 &&
    !/[^A-Za-z0-9_@+./-]/.test(value) &&
    value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
  )
}

/** Không chạy binary/import candidate; pin do caller lấy từ build tin cậy. */
export function verifyControllerRelease(
  directory: string,
  pin: string,
  ownerUid = process.getuid?.()
): ControllerReleaseManifest {
  try {
    if (!isAbsolute(directory) || !/^[a-f0-9]{64}$/.test(pin) || pin.length !== 64) throw Error()
    const root = resolve(directory)
    const bytes = readReleaseFile(
      join(root, CONTROLLER_RELEASE_MANIFEST),
      limits.manifest,
      false,
      ownerUid
    )
    if (releaseSha256(bytes) !== pin) throw Error()
    const manifest = JSON.parse(bytes.toString('utf8')) as ControllerReleaseManifest
    if (
      !manifest ||
      Object.keys(manifest).sort().join(',') !==
        'files,format,lock_sha256,minimum_glibc,node_abi,node_version,packages,payload_sha256,platform' ||
      manifest.format !== 1 ||
      manifest.platform !== 'linux-x64-glibc' ||
      typeof manifest.node_version !== 'string' ||
      manifest.node_version.length > 32 ||
      manifest.node_version.trim() !== manifest.node_version ||
      !/^22\.\d+\.\d+$/.test(manifest.node_version) ||
      typeof manifest.node_abi !== 'string' ||
      manifest.node_abi.trim() !== manifest.node_abi ||
      !/^\d{1,4}$/.test(manifest.node_abi) ||
      typeof manifest.minimum_glibc !== 'string' ||
      manifest.minimum_glibc.trim() !== manifest.minimum_glibc ||
      !/^\d{1,3}\.\d{1,3}$/.test(manifest.minimum_glibc) ||
      typeof manifest.payload_sha256 !== 'string' ||
      manifest.payload_sha256.length !== 64 ||
      !/^[a-f0-9]{64}$/.test(manifest.payload_sha256) ||
      manifest.lock_sha256 !== releaseSha256(controllerRuntimeLock) ||
      !Array.isArray(manifest.files) ||
      !manifest.files.length ||
      manifest.files.length > limits.files ||
      !Array.isArray(manifest.packages)
    )
      throw Error()
    const packages = productionPackages()
    const presentPackages = new Set<string>()
    for (const item of manifest.packages) {
      if (
        !item ||
        Object.keys(item).sort().join(',') !== 'name,path,version' ||
        presentPackages.has(item.path)
      )
        throw Error()
      const locked = packages.find((entry) => entry.path === item.path)
      if (!locked || locked.name !== item.name || locked.version !== item.version) throw Error()
      presentPackages.add(item.path)
    }
    if (packages.some((item) => !item.optional && !presentPackages.has(item.path))) throw Error()
    let total = 0
    const paths: string[] = []
    for (const item of manifest.files) {
      if (
        !item ||
        Object.keys(item).sort().join(',') !== 'mode,path,sha256,size' ||
        typeof item.path !== 'string' ||
        !releasePath(item.path) ||
        (paths.length > 0 && item.path <= paths[paths.length - 1]) ||
        !Number.isSafeInteger(item.size) ||
        item.size < 0 ||
        item.size > (item.path === 'node' ? limits.node : limits.file) ||
        !/^[a-f0-9]{64}$/.test(item.sha256) ||
        item.sha256.length !== 64 ||
        item.mode !== (item.path === 'node' ? 0o700 : 0o600)
      )
        throw Error()
      total += item.size
      if (total > limits.total) throw Error()
      if (
        !['node', 'runtime-lock.json'].includes(item.path) &&
        !item.path.startsWith('payload/') &&
        ![...presentPackages].some((entry) => item.path.startsWith(entry + '/'))
      )
        throw Error()
      const content = readReleaseFile(
        join(root, item.path),
        item.path === 'node' ? limits.node : limits.file,
        false,
        ownerUid
      )
      if (content.length !== item.size || releaseSha256(content) !== item.sha256) throw Error()
      if (item.path === 'node' || item.path.endsWith('.node')) assertLinuxX64Elf(content)
      if (
        process.platform !== 'win32' &&
        (lstatSync(join(root, item.path)).mode & 0o777) !== item.mode
      )
        throw Error()
      paths.push(item.path)
    }
    if (
      !paths.includes('node') ||
      !paths.includes('runtime-lock.json') ||
      releaseSha256(
        readReleaseFile(join(root, 'runtime-lock.json'), limits.manifest, false, ownerUid)
      ) !== manifest.lock_sha256
    )
      throw Error()
    for (const item of manifest.packages) {
      const metadata = JSON.parse(
        readReleaseFile(
          join(root, item.path, 'package.json'),
          limits.file,
          false,
          ownerUid
        ).toString()
      )
      if (metadata.name !== item.name || metadata.version !== item.version) throw Error()
    }
    const actual = scanRelease(root, ownerUid)
    const expected = [...paths, CONTROLLER_RELEASE_MANIFEST].sort()
    if (actual.join('\n') !== expected.join('\n')) throw Error()
    verifyControllerBundle(
      join(root, 'payload/control-plane.cjs'),
      manifest.payload_sha256,
      ownerUid
    )
    return manifest
  } catch {
    throw new Error('CONTROLLER_RELEASE_VERIFICATION_FAILED')
  }
}

/** Linux ELF64 little-endian, EM_X86_64. Kiểm dạng file, không chứng minh ABI bằng header. */
export function assertLinuxX64Elf(bytes: Buffer): void {
  if (
    bytes.length < 64 ||
    bytes.subarray(0, 4).toString('hex') !== '7f454c46' ||
    bytes[4] !== 2 ||
    bytes[5] !== 1 ||
    bytes[6] !== 1 ||
    bytes.readUInt16LE(18) !== 62
  )
    throw new Error('CONTROLLER_RELEASE_NATIVE_PLATFORM')
}

export function productionPackages(): Array<{
  path: string
  name: string
  version: string
  optional: boolean
}> {
  return Object.entries(approvedLock.packages)
    .flatMap(([path, value]) => {
      const entry = value as { version: string; dev?: boolean; optional?: boolean }
      if (!path || entry.dev) return []
      if (!releasePath(path) || !path.startsWith('node_modules/'))
        throw Error('INVALID_RUNTIME_LOCK')
      return [
        {
          path,
          name: path.split('node_modules/').at(-1)!,
          version: entry.version,
          optional: !!entry.optional
        }
      ]
    })
    .sort((a, b) => (a.path < b.path ? -1 : 1))
}

export function assertReleaseDirectory(path: string, ownerUid = process.getuid?.()): void {
  const info = lstatSync(path)
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (process.platform !== 'win32' &&
      ((info.mode & 0o022) !== 0 || (info.uid !== 0 && info.uid !== ownerUid)))
  )
    throw Error('UNSAFE_RELEASE_DIRECTORY')
}

/** Stable bounded read, nlink=1; caller kiểm từng parent trước khi đọc. */
export function readReleaseFile(
  path: string,
  cap: number,
  trustedBuildSource = false,
  ownerUid = process.getuid?.()
): Buffer {
  const before = lstatSync(path)
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    (!trustedBuildSource && before.nlink !== 1) ||
    before.size > cap ||
    (process.platform !== 'win32' &&
      ((before.mode & 0o022) !== 0 || (before.uid !== 0 && before.uid !== ownerUid)))
  )
    throw Error('UNSAFE_RELEASE_FILE')
  // Kiểm ancestor kể cả root; không đi xuyên directory symlink.
  let parent = dirname(path)
  for (;;) {
    assertReleaseDirectory(parent, ownerUid)
    const next = dirname(parent)
    if (next === parent) break
    // /tmp có sticky bit là ancestor hợp lệ; root release vẫn phải private/owned.
    if (process.platform !== 'win32' && (lstatSync(next).mode & 0o1000) !== 0) break
    parent = next
  }
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = fstatSync(fd)
    if (
      !info.isFile() ||
      (!trustedBuildSource && info.nlink !== 1) ||
      info.dev !== before.dev ||
      info.ino !== before.ino ||
      info.size !== before.size ||
      info.size > cap
    )
      throw Error('RELEASE_CHANGED')
    const bytes = Buffer.alloc(info.size)
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null)
      if (!count) throw Error('RELEASE_CHANGED')
      offset += count
    }
    const after = fstatSync(fd)
    if (
      after.size !== info.size ||
      after.mtimeMs !== info.mtimeMs ||
      after.ctimeMs !== info.ctimeMs
    )
      throw Error('RELEASE_CHANGED')
    return bytes
  } finally {
    closeSync(fd)
  }
}

export function scanRelease(root: string, ownerUid = process.getuid?.()): string[] {
  const files: string[] = []
  let entries = 0
  function visit(directory: string, prefix: string, depth: number): void {
    if (depth > 32) throw Error('RELEASE_TOO_DEEP')
    assertReleaseDirectory(directory, ownerUid)
    const names = readdirSync(directory)
    if (!names.length) throw Error('EMPTY_RELEASE_DIRECTORY')
    for (const name of names) {
      if (++entries > limits.files * 2) throw Error('RELEASE_TOO_MANY_FILES')
      const relative = prefix + name
      if (!releasePath(relative)) throw Error('INVALID_RELEASE_PATH')
      const path = join(directory, name)
      const info = lstatSync(path)
      if (info.isDirectory() && !info.isSymbolicLink()) visit(path, relative + '/', depth + 1)
      else if (info.isFile() && !info.isSymbolicLink() && info.nlink === 1) files.push(relative)
      else throw Error('UNSAFE_RELEASE_ENTRY')
    }
  }
  visit(root, '', 0)
  return files.sort()
}
