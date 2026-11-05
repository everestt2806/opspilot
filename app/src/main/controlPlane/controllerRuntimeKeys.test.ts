import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createControllerRuntimeKey, loadControllerRuntimeKey } from './controllerRuntimeKeys'

describe('Runtime key identity input boundary', () => {
  it.each([
    { controller_id: '' },
    { controller_id: '-leading' },
    { controller_id: 'controller\n' },
    { controller_id: '../escape' },
    { app_id: -1 },
    { ownership_generation: 0 },
    { app_id: Number.MAX_SAFE_INTEGER + 1 }
  ])('rejects invalid identity before touching key files: %j', (invalid) => {
    const directory = mkdtempSync(join(tmpdir(), 'opspilot-key-identity-'))
    const identity = { controller_id: 'controller', app_id: 1, ownership_generation: 1, ...invalid }
    try {
      expect(() => createControllerRuntimeKey(directory, identity)).toThrow(
        /^CONTROLLER_RUNTIME_KEY_IDENTITY_INVALID$/
      )
      expect(() => loadControllerRuntimeKey(directory, identity)).toThrow(
        /^CONTROLLER_RUNTIME_KEY_IDENTITY_INVALID$/
      )
      expect(readdirSync(directory)).toEqual([])
    } finally {
      expect(dirname(realpathSync(directory))).toBe(realpathSync(tmpdir()))
      rmSync(directory, { recursive: true })
    }
  })
})
