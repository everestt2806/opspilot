import { existsSync, readdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { readReleaseFile, releaseSha256, verifyControllerRelease } from './controllerRelease'
import type { DesktopControllerRelease } from '../../../../docs/contracts/desktop-controller-installation'
import type {
  ControllerInstallerCatalog,
  ControllerInstallerRelease
} from '../../../../docs/contracts/desktop-controller-installer'

const hash = z.string().regex(/^[a-f0-9]{64}$/)
declare const __OPSPILOT_CONTROLLER_INSTALLER_CATALOG__: ControllerInstallerCatalog

export function builtinControllerInstallerCatalog(): ControllerInstallerCatalog {
  return typeof __OPSPILOT_CONTROLLER_INSTALLER_CATALOG__ === 'undefined'
    ? { format: 1, releases: [] }
    : controllerInstallerCatalogSchema.parse(__OPSPILOT_CONTROLLER_INSTALLER_CATALOG__)
}

/** Packaging gate uses compiled Main pins; resource JSON cannot replace them. */
export function verifyPackagedControllerResources(root: string): void {
  const catalog = builtinControllerInstallerCatalog()
  if (!catalog.releases.length) throw Error('CONTROLLER_INSTALLER_RESOURCES_REQUIRED')
  const resources = new ControllerInstallerResources(catalog, root)
  for (const release of catalog.releases) resources.verify(release.release_id)
}
export const controllerInstallerCatalogSchema = z
  .strictObject({
    format: z.literal(1),
    releases: z
      .array(
        z.strictObject({
          release_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/),
          node_version: z.string().regex(/^22\.\d+\.\d+$/),
          minimum_glibc: z.string().regex(/^\d{1,3}\.\d{1,3}$/),
          release_sha256: hash,
          installer_sha256: hash,
          upgrade_supported: z.literal(true).optional()
        })
      )
      .max(8)
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.releases.map((v) => v.release_id)).size !== value.releases.length ||
      new Set(value.releases.map((v) => v.release_sha256 + v.installer_sha256)).size !==
        value.releases.length
    )
      ctx.addIssue({ code: 'custom', message: 'DUPLICATE_CONTROLLER_RELEASE' })
  }) satisfies z.ZodType<ControllerInstallerCatalog>

/** Pins are trusted build input. Runtime catalog.json is deliberately never read here. */
export class ControllerInstallerResources {
  private readonly catalog: ControllerInstallerCatalog
  constructor(
    value: unknown,
    private readonly root: string
  ) {
    if (!isAbsolute(root)) throw Error('CONTROLLER_RESOURCES_INVALID')
    this.catalog = controllerInstallerCatalogSchema.parse(value)
  }
  entries(): DesktopControllerRelease[] {
    return this.catalog.releases.map((v) => ({
      release_id: v.release_id,
      release_sha256: v.release_sha256,
      installer_sha256: v.installer_sha256,
      release_directory: join(this.root, v.release_id, 'release'),
      installer_path: join(this.root, v.release_id, 'installer.cjs')
    }))
  }
  list(): ControllerInstallerRelease[] {
    return this.catalog.releases.map((v) => {
      const entry = this.entries().find((entry) => entry.release_id === v.release_id)!
      let state: ControllerInstallerRelease['state'] = 'available'
      if (!existsSync(entry.release_directory) || !existsSync(entry.installer_path))
        state = 'missing'
      else {
        try {
          this.verify(v.release_id)
        } catch {
          state = 'invalid'
        }
      }
      return {
        release_id: v.release_id,
        node_version: v.node_version,
        minimum_glibc: v.minimum_glibc,
        platform: 'linux-x64-glibc',
        state,
        ...(v.upgrade_supported ? { upgrade_supported: true as const } : {})
      }
    })
  }
  verify(id: string): {
    entry: DesktopControllerRelease
    manifest: ReturnType<typeof verifyControllerRelease>
  } {
    const entry = this.entries().find((v) => v.release_id === id),
      descriptor = this.catalog.releases.find((v) => v.release_id === id)
    if (!entry || !descriptor) throw Error('CONTROLLER_RELEASE_UNAVAILABLE')
    const manifest = verifyControllerRelease(entry.release_directory, entry.release_sha256)
    if (
      manifest.node_version !== descriptor.node_version ||
      manifest.minimum_glibc !== descriptor.minimum_glibc ||
      releaseSha256(readReleaseFile(entry.installer_path, 1024 * 1024)) !==
        entry.installer_sha256 ||
      readdirSync(join(this.root, id)).sort().join(',') !== 'installer.cjs,release'
    )
      throw Error('CONTROLLER_RESOURCES_INVALID')
    return { entry, manifest }
  }
}
