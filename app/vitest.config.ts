import { resolve } from 'path'

import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    // Node test runner kiểm chứng fixture riêng; không phải Vitest suite.
    exclude: [
      ...configDefaults.exclude,
      '.out-scripts/**',
      'scripts/product-docker-lab/runner.test.mjs'
    ],
    environment: 'node',
    setupFiles: ['./src/renderer/src/test/setupTests.ts'],
    testTimeout: 15000
  }
})
