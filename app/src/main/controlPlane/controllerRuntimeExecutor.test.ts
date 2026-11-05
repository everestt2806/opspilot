import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ProductClaimToken } from '../../../../docs/contracts/product-auto-deploy'
import type { ProductDeployRepository } from '../db/productDeployRepository'
import type { SshManager } from '../ssh/manager'
import { ControllerRuntimeExecutorRouter } from './controllerRuntimeExecutor'

describe('Controller runtime key routing failure boundary', () => {
  it.each(['prewrite', 'dispatch_unknown', 'database_error'])(
    'does not prepare source or open SSH with missing key: %s',
    async (state) => {
      const directory = mkdtempSync(join(tmpdir(), 'opspilot-router-'))
      const database = new Database(':memory:')
      const repository = {
        readClaimExecutionState: () => {
          if (state === 'database_error') throw new Error('DB_UNAVAILABLE')
          return state
        }
      }
      const ssh = { connect: vi.fn() }
      const prepareSnapshot = vi.fn()
      const targetOptions = vi.fn()
      try {
        const router = new ControllerRuntimeExecutorRouter({
          database,
          secretDirectory: directory,
          repository: repository as unknown as ProductDeployRepository,
          ssh: ssh as unknown as SshManager,
          prepareSnapshot,
          targetOptions
        })
        const claim = {
          controller_id: 'test-controller',
          app_id: 1,
          ownership_generation: 1,
          attempt_id: 'missing-material'
        } as ProductClaimToken
        const result = await router.execute(claim, new AbortController().signal)
        expect(result).toEqual(
          state === 'prewrite'
            ? {
                state: 'prewrite_failure',
                disposition: 'permanent_failure',
                safeErrorCode: 'INVALID_SOURCE_CONFIG'
              }
            : { state: 'dispatch_marker_committed' }
        )
        expect(
          router.verifyCompletion(claim, {
            state: 'runtime_settled',
            attempt_id: claim.attempt_id,
            commit_id: 'untrusted',
            outcome: 'succeeded'
          })
        ).toBe(false)
        expect(prepareSnapshot).not.toHaveBeenCalled()
        expect(targetOptions).not.toHaveBeenCalled()
        expect(ssh.connect).not.toHaveBeenCalled()
        expect(database.prepare('SELECT COUNT(*) AS n FROM sqlite_master').get()).toEqual({ n: 0 })
      } finally {
        database.close()
        rmSync(directory, { recursive: true })
      }
    }
  )
})
