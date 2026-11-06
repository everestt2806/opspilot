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
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import catalog from '../../../control-plane-runtime/bundle-files.json'
import {
  PRODUCT_CONTROLLER_BUNDLE_MANIFEST,
  PRODUCT_CONTROLLER_BUNDLE_MAX_MANIFEST_BYTES,
  PRODUCT_CONTROLLER_BUNDLE_MAX_FILE_BYTES,
  PRODUCT_CONTROLLER_BUNDLE_MAX_TOTAL_BYTES,
  type ProductControllerBundleManifest
} from '../../../../docs/contracts/product-controller-bundle'

export type VerifiedControllerBundle = Readonly<{
  state: 'bundle_verified'
  manifest_sha256: string
  root_directory: string
  entrypoint: string
  templates_directory: string
  collector_directory: string
  target_helper_path: string
  files: number
}>

/** Chỉ đọc gói offline với digest đã pin độc lập; không tạo DB hoặc activate/enroll. */
export function verifyControllerBundle(
  artifactPath: string,
  expectedDigest: string
): VerifiedControllerBundle {
  try {
    if (typeof artifactPath !== 'string' || !isAbsolute(artifactPath))
      throw new Error('INVALID_ARTIFACT_PATH')
    if (
      typeof expectedDigest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(expectedDigest) ||
      expectedDigest.length !== 64
    )
      throw new Error('INVALID_PIN')
    const artifact = resolve(artifactPath)
    const root = dirname(artifact)
    const entrypoint = basename(artifact)
    if (/[^A-Za-z0-9_.-]/.test(entrypoint)) throw new Error('INVALID_ENTRYPOINT')
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.cjs$/.test(entrypoint)) throw new Error('INVALID_ENTRYPOINT')
    assertDirectory(root)
    const manifestBytes = readCheckedFile(
      join(root, PRODUCT_CONTROLLER_BUNDLE_MANIFEST),
      PRODUCT_CONTROLLER_BUNDLE_MAX_MANIFEST_BYTES
    )
    if (digest(manifestBytes) !== expectedDigest) throw new Error('MANIFEST_PIN_MISMATCH')
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as ProductControllerBundleManifest
    if (
      !manifest ||
      Object.keys(manifest).sort().join(',') !== 'entrypoint,files,format,node_major' ||
      manifest.format !== 1 ||
      manifest.node_major !== 22 ||
      manifest.entrypoint !== entrypoint ||
      !Array.isArray(manifest.files)
    )
      throw new Error('INVALID_MANIFEST')
    const expectedFiles = [entrypoint, ...Object.keys(catalog)].sort()
    if (manifest.files.length !== expectedFiles.length) throw new Error('INVALID_FILE_SET')
    let total = 0
    for (let index = 0; index < expectedFiles.length; index += 1) {
      const entry = manifest.files[index]
      if (
        !entry ||
        Object.keys(entry).sort().join(',') !== 'path,sha256,size' ||
        entry.path !== expectedFiles[index] ||
        !Number.isSafeInteger(entry.size) ||
        entry.size < 1 ||
        entry.size > PRODUCT_CONTROLLER_BUNDLE_MAX_FILE_BYTES ||
        typeof entry.sha256 !== 'string' ||
        entry.sha256.length !== 64 ||
        !/^[a-f0-9]{64}$/.test(entry.sha256)
      )
        throw new Error('INVALID_FILE_RECORD')
      total += entry.size
      if (total > PRODUCT_CONTROLLER_BUNDLE_MAX_TOTAL_BYTES) throw new Error('BUNDLE_TOO_LARGE')
      assertDirectory(dirname(join(root, entry.path)))
      const content = readCheckedFile(
        join(root, entry.path),
        PRODUCT_CONTROLLER_BUNDLE_MAX_FILE_BYTES
      )
      if (content.length !== entry.size || digest(content) !== entry.sha256)
        throw new Error('FILE_MISMATCH')
    }
    const present = scan(root)
    if (
      present.sort().join('\n') !==
      [...expectedFiles, PRODUCT_CONTROLLER_BUNDLE_MANIFEST].sort().join('\n')
    )
      throw new Error('UNEXPECTED_BUNDLE_CONTENT')
    return {
      state: 'bundle_verified',
      manifest_sha256: expectedDigest,
      root_directory: root,
      entrypoint: artifact,
      templates_directory: join(root, 'templates'),
      collector_directory: join(root, 'collector'),
      target_helper_path: join(root, 'target-helper', 'target_guarded_ssh_helper.py'),
      files: expectedFiles.length
    }
  } catch {
    throw new Error('CONTROLLER_BUNDLE_VERIFICATION_FAILED')
  }
}

/** Đọc snapshot byte đã đối chiếu pin; caller không chạy code/path mới đọc mà chưa kiểm hash. */
export function readVerifiedControllerBundleFile(
  bundle: VerifiedControllerBundle,
  relative: string
): Buffer {
  const checked = verifyControllerBundle(bundle.entrypoint, bundle.manifest_sha256)
  const manifest = readCheckedFile(
    join(checked.root_directory, PRODUCT_CONTROLLER_BUNDLE_MANIFEST),
    PRODUCT_CONTROLLER_BUNDLE_MAX_MANIFEST_BYTES
  )
  if (digest(manifest) !== checked.manifest_sha256)
    throw new Error('CONTROLLER_BUNDLE_VERIFICATION_FAILED')
  if (relative === PRODUCT_CONTROLLER_BUNDLE_MANIFEST) return manifest
  const record = (JSON.parse(manifest.toString()) as ProductControllerBundleManifest).files.find(
    (item) => item.path === relative
  )
  if (!record) throw new Error('CONTROLLER_BUNDLE_VERIFICATION_FAILED')
  const value = readCheckedFile(
    join(checked.root_directory, relative),
    PRODUCT_CONTROLLER_BUNDLE_MAX_FILE_BYTES
  )
  if (value.length !== record.size || digest(value) !== record.sha256)
    throw new Error('CONTROLLER_BUNDLE_VERIFICATION_FAILED')
  return value
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function safeMetadata(info: { uid: number; mode: number }): void {
  if (
    process.platform !== 'win32' &&
    ((info.mode & 0o022) !== 0 || (info.uid !== 0 && info.uid !== process.getuid?.()))
  )
    throw new Error('UNSAFE_BUNDLE_METADATA')
}

function assertDirectory(directory: string): void {
  const info = lstatSync(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('INVALID_DIRECTORY')
  safeMetadata(info)
}

function readCheckedFile(file: string, cap: number): Buffer {
  const before = lstatSync(file)
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('INVALID_FILE')
  let fd: number | undefined
  try {
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const info = fstatSync(fd)
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.size < 1 ||
      info.size > cap ||
      info.ino !== before.ino ||
      info.dev !== before.dev
    )
      throw new Error('INVALID_FILE')
    safeMetadata(info)
    const bounded = Buffer.alloc(info.size + 1)
    let length = 0
    while (length < bounded.length) {
      const count = readSync(fd, bounded, length, bounded.length - length, null)
      if (!count) break
      length += count
    }
    const content = bounded.subarray(0, length)
    const after = fstatSync(fd)
    if (
      content.length !== info.size ||
      after.size !== info.size ||
      after.mtimeMs !== info.mtimeMs ||
      after.ctimeMs !== info.ctimeMs
    )
      throw new Error('FILE_CHANGED')
    return content
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function scan(root: string, prefix = ''): string[] {
  const files: string[] = []
  for (const name of readdirSync(join(root, prefix))) {
    const relative = prefix ? `${prefix}/${name}` : name
    const file = join(root, relative)
    const info = lstatSync(file)
    if (
      info.isDirectory() &&
      !info.isSymbolicLink() &&
      !prefix &&
      ['target-helper', 'templates', 'collector'].includes(name)
    ) {
      assertDirectory(file)
      files.push(...scan(root, relative))
    } else if (info.isFile() && !info.isSymbolicLink()) files.push(relative)
    else throw new Error('UNEXPECTED_BUNDLE_CONTENT')
  }
  return files
}
