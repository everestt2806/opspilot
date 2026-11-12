import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'
import { controllerInstallerCatalogSchema } from './src/main/controlPlane/controllerInstallerCatalog'
import approvedUpgrade from './control-plane-runtime/desktop-upgrade-release.json'

const catalogFile = resolve('resources/controller-releases/catalog.json')
const originalCatalog = existsSync(catalogFile)
  ? controllerInstallerCatalogSchema.parse(JSON.parse(readFileSync(catalogFile, 'utf8')))
  : { format: 1, releases: [] }
const conflicting = originalCatalog.releases.find(
  (v) => v.release_id === approvedUpgrade.release_id
)
if (conflicting && JSON.stringify(conflicting) !== JSON.stringify(approvedUpgrade))
  throw Error('CONTROLLER_UPGRADE_CATALOG_CONFLICT')
const installerCatalog = controllerInstallerCatalogSchema.parse({
  format: 1,
  releases: [
    ...originalCatalog.releases.filter((v) => v.release_id !== approvedUpgrade.release_id),
    approvedUpgrade
  ]
})

export default defineConfig({
  main: {
    define: { __OPSPILOT_CONTROLLER_INSTALLER_CATALOG__: JSON.stringify(installerCatalog) },
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
          controllerResourceVerifier: resolve('src/main/controlPlane/controllerInstallerCatalog.ts')
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
