import { createHash } from 'node:crypto'
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import catalog from '../../../control-plane-runtime/bundle-files.json'
import type { ProductControllerBundleManifest } from '../../../../docs/contracts/product-controller-bundle'
import { verifyControllerBundle } from './controllerBundle'

let root: string
let artifact: string
let manifest: ProductControllerBundleManifest
const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')
const writeManifest = (value: unknown = manifest): string => {
  const bytes = JSON.stringify(value)
  writeFileSync(join(root, 'bundle-manifest.json'), bytes)
  return sha(bytes)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'opspilot-bundle-'))
  artifact = join(root, 'control-plane.cjs')
  const names = ['control-plane.cjs', ...Object.keys(catalog)].sort()
  manifest = {
    format: 1,
    node_major: 22,
    entrypoint: 'control-plane.cjs',
    files: names.map((path) => {
      const content = `SYNTHETIC_BUNDLE_FILE:${path}`
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), content)
      return { path, size: Buffer.byteLength(content), sha256: sha(content) }
    })
  }
})
afterEach(() => rmSync(root, { recursive: true }))

describe('Pinned controller release bundle', () => {
  it('verifies exact catalog from an absolute artifact path without DB/SSH/env mutation', () => {
    const before = process.env.OPSPILOT_TEMPLATES_DIR
    const pin = writeManifest()
    expect(verifyControllerBundle(artifact, pin)).toEqual({
      state: 'bundle_verified',
      manifest_sha256: pin,
      root_directory: root,
      entrypoint: artifact,
      templates_directory: join(root, 'templates'),
      collector_directory: join(root, 'collector'),
      target_helper_path: join(root, 'target-helper', 'target_guarded_ssh_helper.py'),
      files: 12
    })
    expect(process.env.OPSPILOT_TEMPLATES_DIR).toBe(before)
    expect(readFileSync(join(root, 'bundle-manifest.json'), 'utf8')).not.toContain('secret')
  })

  it.each(['', 'a'.repeat(64), 'A'.repeat(64), 'a'.repeat(64) + '\n', '../untrusted'])(
    'requires an independently supplied exact digest %#',
    (pin) => {
      writeManifest()
      expect(() => verifyControllerBundle(artifact, pin)).toThrow(
        /^CONTROLLER_BUNDLE_VERIFICATION_FAILED$/
      )
    }
  )

  it.each(['changed', 'missing', 'extra', 'empty-directory', 'hardlink'])(
    'refuses altered filesystem content: %s',
    (kind) => {
      const pin = writeManifest()
      const file = join(root, 'collector/collect.py')
      if (kind === 'changed') writeFileSync(file, 'CHANGED')
      if (kind === 'missing') rmSync(file)
      if (kind === 'extra') writeFileSync(join(root, '.env'), 'SYNTHETIC_UNIT_MATERIAL')
      if (kind === 'empty-directory') mkdirSync(join(root, 'unexpected'))
      if (kind === 'hardlink') linkSync(file, join(root, 'other-link'))
      expect(() => verifyControllerBundle(artifact, pin)).toThrow(
        /^CONTROLLER_BUNDLE_VERIFICATION_FAILED$/
      )
    }
  )

  it.each([
    'format',
    'node',
    'entrypoint',
    'traversal',
    'duplicate',
    'missing',
    'size',
    'digest',
    'extra-key'
  ])('refuses an invalid manifest even with its correct digest: %s', (kind) => {
    const changed = JSON.parse(JSON.stringify(manifest))
    if (kind === 'format') changed.format = 2
    if (kind === 'node') changed.node_major = 24
    if (kind === 'entrypoint') changed.entrypoint = '../control-plane.cjs'
    if (kind === 'traversal') changed.files[0].path = '../outside'
    if (kind === 'duplicate') changed.files[1] = changed.files[0]
    if (kind === 'missing') changed.files.pop()
    if (kind === 'size') changed.files[0].size = 8 * 1024 * 1024 + 1
    if (kind === 'digest') changed.files[0].sha256 = 'B'.repeat(64)
    if (kind === 'extra-key') changed.extra = 'unknown'
    const pin = writeManifest(changed)
    expect(() => verifyControllerBundle(artifact, pin)).toThrow(
      /^CONTROLLER_BUNDLE_VERIFICATION_FAILED$/
    )
  })

  it('rejects oversized or invalid JSON manifests before trusting file records', () => {
    for (const content of ['{', ' '.repeat(32 * 1024 + 1)]) {
      writeFileSync(join(root, 'bundle-manifest.json'), content)
      expect(() => verifyControllerBundle(artifact, sha(content))).toThrow(
        /^CONTROLLER_BUNDLE_VERIFICATION_FAILED$/
      )
    }
  })
})
