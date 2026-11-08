import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import catalog from '../../../control-plane-runtime/bundle-files.json'
import type { ControllerReleaseManifest } from '../../../../docs/contracts/product-controller-release'
import {
  controllerRuntimeLock,
  productionPackages,
  releaseSha256 as sha,
  verifyControllerRelease
} from './controllerRelease'
import { buildControllerRelease } from './controllerReleaseBuilder'

let root: string
let manifest: { -readonly [Key in keyof ControllerReleaseManifest]: ControllerReleaseManifest[Key] }
function put(path: string, bytes: Buffer): void {
  mkdirSync(dirname(join(root, path)), { recursive: true, mode: 0o700 })
  writeFileSync(join(root, path), bytes, { mode: path === 'node' ? 0o700 : 0o600 })
  manifest.files = [
    ...manifest.files,
    {
      path,
      size: bytes.length,
      sha256: sha(bytes),
      mode: (path === 'node' ? 0o700 : 0o600) as 384 | 448
    }
  ].sort((a, b) => (a.path < b.path ? -1 : 1))
}
function seal(): string {
  const bytes = Buffer.from(JSON.stringify(manifest))
  writeFileSync(join(root, 'release-manifest.json'), bytes, { mode: 0o600 })
  return sha(bytes)
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'opspilot-release-'))
  manifest = {
    format: 1,
    platform: 'linux-x64-glibc',
    node_version: '22.23.4',
    node_abi: '127',
    minimum_glibc: '2.39',
    payload_sha256: '',
    lock_sha256: sha(controllerRuntimeLock),
    packages: productionPackages().map(({ path, name, version }) => ({ path, name, version })),
    files: []
  }
  const elf = Buffer.alloc(64)
  Buffer.from('7f454c46020101', 'hex').copy(elf)
  elf.writeUInt16LE(62, 18)
  put('node', elf)
  put('runtime-lock.json', controllerRuntimeLock)
  for (const entry of manifest.packages)
    put(entry.path + '/package.json', Buffer.from(JSON.stringify(entry)))
  const payloadFiles = ['control-plane.cjs', ...Object.keys(catalog)].sort().map((path) => {
    const bytes = Buffer.from('SYNTHETIC_PASSIVE_FILE:' + path)
    put('payload/' + path, bytes)
    return { path, size: bytes.length, sha256: sha(bytes) }
  })
  const payload = Buffer.from(
    JSON.stringify({
      format: 1,
      node_major: 22,
      entrypoint: 'control-plane.cjs',
      files: payloadFiles
    })
  )
  put('payload/bundle-manifest.json', payload)
  manifest.payload_sha256 = sha(payload)
})
afterEach(() => {
  if (
    dirname(resolve(root)) !== resolve(tmpdir()) ||
    !basename(root).startsWith('opspilot-release-')
  )
    throw Error('INVALID_FIXTURE_CLEANUP')
  rmSync(root, { recursive: true, force: true })
})

describe('Passive Linux controller release verification', () => {
  it('verifies exact package and approved payload without executing synthetic ELF/JS', () => {
    expect(verifyControllerRelease(root, seal())).toEqual(manifest)
  })
  it.each(['', 'a'.repeat(64), 'A'.repeat(64), 'a'.repeat(64) + '\n'])(
    'rejects independent pin %j',
    (pin) => {
      seal()
      expect(() => verifyControllerRelease(root, pin)).toThrow(
        'CONTROLLER_RELEASE_VERIFICATION_FAILED'
      )
    }
  )
  it.each(['changed', 'extra', 'empty-dir', 'hardlink', 'missing', 'mode'])(
    'rejects filesystem tamper %s',
    (kind) => {
      const pin = seal()
      const file = join(root, 'node')
      if (kind === 'changed') writeFileSync(file, 'MZ_WINDOWS')
      if (kind === 'extra') writeFileSync(join(root, '.env'), 'SYNTHETIC')
      if (kind === 'empty-dir') mkdirSync(join(root, 'unknown'))
      if (kind === 'hardlink') linkSync(file, join(root, 'other'))
      if (kind === 'missing') rmSync(file)
      if (kind === 'mode' && process.platform !== 'win32') chmodSync(file, 0o777)
      if (kind !== 'mode' || process.platform !== 'win32')
        expect(() => verifyControllerRelease(root, pin)).toThrow(
          'CONTROLLER_RELEASE_VERIFICATION_FAILED'
        )
    }
  )
  it.each([
    'platform',
    'node',
    'abi-type',
    'glibc',
    'glibc-type',
    'lock',
    'dev',
    'version',
    'missing-package',
    'duplicate-package',
    'traversal',
    'duplicate-file',
    'extra-key',
    'native-windows',
    'native-arm',
    'node-executable',
    'oversize',
    'payload'
  ])('rejects malformed metadata/platform even with a matching new pin: %s', (kind) => {
    const changed = manifest as unknown as Record<string, unknown>
    if (kind === 'platform') changed.platform = 'win32-x64'
    if (kind === 'node') changed.node_version = '24.0.0'
    if (kind === 'abi-type') changed.node_abi = 127
    if (kind === 'glibc') changed.minimum_glibc = 'latest'
    if (kind === 'glibc-type') changed.minimum_glibc = ['2.39']
    if (kind === 'lock') changed.lock_sha256 = 'a'.repeat(64)
    if (kind === 'dev')
      changed.packages = [
        ...manifest.packages,
        { path: 'node_modules/esbuild', name: 'esbuild', version: '0.28.1' }
      ]
    if (kind === 'version')
      changed.packages = manifest.packages.map((v, i) => (i ? v : { ...v, version: '0.0.1' }))
    if (kind === 'missing-package') changed.packages = []
    if (kind === 'duplicate-package')
      changed.packages = [...manifest.packages, manifest.packages[0]]
    if (kind === 'traversal')
      changed.files = [{ ...manifest.files[0], path: '../outside' }, ...manifest.files.slice(1)]
    if (kind === 'duplicate-file') changed.files = [manifest.files[0], ...manifest.files]
    if (kind === 'extra-key') changed.secret = 'SYNTHETIC'
    if (kind === 'node-executable')
      changed.files = manifest.files.map((v) => ({ ...v, mode: 0o600 }))
    if (kind === 'oversize')
      changed.files = manifest.files.map((v) => ({ ...v, size: 257 * 1024 * 1024 }))
    if (kind === 'payload') changed.payload_sha256 = 'a'.repeat(64)
    if (kind.startsWith('native-')) {
      const bytes =
        kind === 'native-windows' ? Buffer.from('MZ_WINDOWS') : readFileSync(join(root, 'node'))
      if (kind === 'native-arm') bytes.writeUInt16LE(183, 18)
      put('node_modules/better-sqlite3/prebuilds/linux-x64.node', bytes)
    }
    expect(() => verifyControllerRelease(root, seal())).toThrow(
      'CONTROLLER_RELEASE_VERIFICATION_FAILED'
    )
  })
  it('builder refuses unsupported Windows host before creating destination', () => {
    if (process.platform !== 'win32') return
    expect(() =>
      buildControllerRelease({ modules: root, artifact: root, payloadPin: '', output: root })
    ).toThrow('CONTROLLER_RELEASE_BUILD_REQUIRES_LINUX_X64_GLIBC_NODE22')
  })
})
