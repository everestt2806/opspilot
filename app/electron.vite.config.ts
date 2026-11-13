import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { controllerInstallerCatalogSchema } from './src/main/controlPlane/controllerInstallerCatalog'
import approvedUpgrade from './control-plane-runtime/desktop-upgrade-release.json'
import approvedSpa from './control-plane-runtime/desktop-spa-release.json'
import approvedSpaRetained from './control-plane-runtime/desktop-spa-retained-release.json'

const catalogFile = resolve('resources/controller-releases/catalog.json')
const originalCatalog = existsSync(catalogFile)
  ? controllerInstallerCatalogSchema.parse(JSON.parse(readFileSync(catalogFile, 'utf8')))
  : { format: 1, releases: [] }
const approvedUpgrades = [approvedUpgrade, approvedSpa, approvedSpaRetained]
for (const approved of approvedUpgrades) {
  const conflicting = originalCatalog.releases.find((v) => v.release_id === approved.release_id)
  if (conflicting && JSON.stringify(conflicting) !== JSON.stringify(approved))
    throw Error('CONTROLLER_UPGRADE_CATALOG_CONFLICT')
}
const installerCatalog = controllerInstallerCatalogSchema.parse({
  format: 1,
  releases: [
    ...originalCatalog.releases.filter(
      (v) => !approvedUpgrades.some((entry) => entry.release_id === v.release_id)
    ),
    ...approvedUpgrades
  ]
})
const mlManifestFile = resolve('resources/ml-runtime/manifest.json')
const mlRuntimePin = existsSync(mlManifestFile)
  ? createHash('sha256').update(readFileSync(mlManifestFile)).digest('hex')
  : ''

export default defineConfig({
  main: {
    define: {
      __OPSPILOT_CONTROLLER_INSTALLER_CATALOG__: JSON.stringify(installerCatalog),
      __OPSPILOT_ML_RUNTIME_SHA256__: JSON.stringify(mlRuntimePin)
    },
    plugins: [
      {
        name: 'controller-installer-catalog',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'controller-installer-catalog.json',
            source: JSON.stringify(installerCatalog)
          })
        }
      }
    ],
    build: {
      rollupOptions: {
        preserveEntrySignatures: 'strict',
        input: {
          index: resolve('src/main/index.ts'),
          controllerResourceVerifier: resolve(
            'src/main/controlPlane/controllerInstallerCatalog.ts'
          ),
          mlResourceVerifier: resolve('src/main/mlRuntime.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()]
  }
})
