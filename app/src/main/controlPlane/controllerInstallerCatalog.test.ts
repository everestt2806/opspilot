import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  ControllerInstallerResources,
  controllerInstallerCatalogSchema,
  verifyPackagedControllerResources
} from './controllerInstallerCatalog'
const release = {
  release_id: 'linux-22',
  node_version: '22.23.4',
  minimum_glibc: '2.39',
  release_sha256: 'a'.repeat(64),
  installer_sha256: 'b'.repeat(64)
}
let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'opspilot-resources-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))
it('does not derive trusted pins from resource catalog.json', () => {
  writeFileSync(
    join(root, 'catalog.json'),
    JSON.stringify({ format: 1, releases: [{ ...release, release_sha256: 'f'.repeat(64) }] })
  )
  const value = new ControllerInstallerResources({ format: 1, releases: [release] }, root)
  expect(value.entries()[0].release_sha256).toBe(release.release_sha256)
  expect(value.list()).toMatchObject([{ release_id: 'linux-22', state: 'missing' }])
  expect(value.list()[0]).not.toHaveProperty('release_sha256')
})
it('snapshots build input and rejects invalid resources without executing them', () => {
  const input = { format: 1, releases: [{ ...release }] }
  const value = new ControllerInstallerResources(input, root)
  input.releases[0].installer_sha256 = 'c'.repeat(64)
  mkdirSync(join(root, release.release_id, 'release'), { recursive: true })
  writeFileSync(
    join(root, release.release_id, 'installer.cjs'),
    "throw Error('CANDIDATE_MUST_NOT_RUN')"
  )
  writeFileSync(join(root, release.release_id, 'release', 'release-manifest.json'), '{}')
  expect(value.entries()[0].installer_sha256).toBe(release.installer_sha256)
  expect(value.list()[0].state).toBe('invalid')
  expect(() => value.verify(release.release_id)).toThrow('CONTROLLER_RELEASE_VERIFICATION_FAILED')
})
it.each(['path', 'node', 'libc', 'extra', 'duplicate'] as const)(
  'rejects catalog %s before path resolution',
  (kind) => {
    const item: Record<string, unknown> = { ...release }
    if (kind === 'path') item.release_id = '../other'
    if (kind === 'node') item.node_version = '24.0.0'
    if (kind === 'libc') item.minimum_glibc = 'unknown'
    if (kind === 'extra') item.installer_path = '/user/path'
    const catalog = { format: 1, releases: kind === 'duplicate' ? [item, item] : [item] }
    expect(controllerInstallerCatalogSchema.safeParse(catalog).success).toBe(false)
  }
)
it('allows existing development mode without assets but rejects a packaged app without baked releases', () => {
  expect(new ControllerInstallerResources({ format: 1, releases: [] }, root).list()).toEqual([])
  expect(() => verifyPackagedControllerResources(root)).toThrow(
    'CONTROLLER_INSTALLER_RESOURCES_REQUIRED'
  )
})
