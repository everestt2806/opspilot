import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import type { ProductClaimToken } from '../../../../docs/contracts/product-auto-deploy'
import type { ProductDeployRepository } from '../db/productDeployRepository'
import type { ProductRuntimeRepository } from '../db/productRuntimeRepository'
import type { SshManager } from '../ssh/manager'
import { ProductRuntimeExecutor } from './productRuntimeExecutor'
import { ProductSnapshotPreparationError } from './productSnapshotPreparation'
import type { PreparedProductGitSnapshot } from './productSnapshotPreparation'
import type { ProductDeployPipelineOptions } from './productRuntimePipeline'
import { executeProductDeployPipeline } from './productRuntimePipeline'

vi.mock('./productPipelineSourceRender', async (original) => ({
  ...(await original<typeof import('./productPipelineSourceRender')>()),
  validatePreflightSourceAndPlan: vi.fn()
}))
vi.mock('./productRuntimePipeline', async (original) => ({
  ...(await original<typeof import('./productRuntimePipeline')>()),
  executeProductDeployPipeline: vi.fn()
}))

describe('ProductRuntimeExecutor prewrite boundary', () => {
  it.each(['resource_unavailable', 'resource_unknown'] as const)(
    'defers %s before pipeline writes and cleans snapshot',
    async (reason) => {
      vi.mocked(executeProductDeployPipeline).mockClear()
      const database = new Database(':memory:'),
        cleanup = vi.fn()
      try {
        const executor = new ProductRuntimeExecutor({
          database,
          repository: {
            readClaimExecutionState: () => 'prewrite'
          } as unknown as ProductDeployRepository,
          runtimeRepository: { getTerminal: () => null } as unknown as ProductRuntimeRepository,
          ssh: {} as SshManager,
          targetOptions: () => ({}) as ProductDeployPipelineOptions,
          prepareSnapshot: async () => ({ cleanup }) as unknown as PreparedProductGitSnapshot,
          admitTarget: async () => ({ state: 'deferred', reason })
        })
        const result = await executor.execute(
          { attempt_id: 'unit-attempt' } as ProductClaimToken,
          new AbortController().signal
        )
        expect(result).toEqual({
          state: 'prewrite_failure',
          disposition: 'transient_failure',
          safeErrorCode: reason === 'resource_unknown' ? 'RESOURCE_UNKNOWN' : 'RESOURCE_UNAVAILABLE'
        })
        expect(executeProductDeployPipeline).not.toHaveBeenCalled()
        expect(cleanup).toHaveBeenCalledOnce()
      } finally {
        database.close()
      }
    }
  )
  it.each([
    ['prewrite', 'snapshot_timeout', 'prewrite_failure', 'transient_failure'],
    ['dispatch_unknown', 'snapshot_timeout', 'dispatch_marker_committed', undefined],
    ['prewrite', 'snapshot_source_changed', 'prewrite_obsolete', undefined],
    ['prewrite', 'snapshot_root_invalid', 'prewrite_failure', 'permanent_failure']
  ] as const)(
    'classifies %s / %s without SSH or raw error output',
    async (state, code, expected, disposition) => {
      const database = new Database(':memory:')
      const targetOptions = vi.fn()
      const ssh = { connect: vi.fn() }
      const repository = { readClaimExecutionState: vi.fn(() => state) }
      const runtimeRepository = { getTerminal: vi.fn(() => null) }
      try {
        const executor = new ProductRuntimeExecutor({
          database,
          repository: repository as unknown as ProductDeployRepository,
          runtimeRepository: runtimeRepository as unknown as ProductRuntimeRepository,
          ssh: ssh as unknown as SshManager,
          targetOptions,
          prepareSnapshot: async () => {
            throw new ProductSnapshotPreparationError(code)
          }
        })
        const claim = { attempt_id: 'unit-attempt' } as ProductClaimToken
        const result = await executor.execute(claim, new AbortController().signal)
        expect(result.state).toBe(expected)
        if (disposition) expect(result).toHaveProperty('disposition', disposition)
        expect(targetOptions).not.toHaveBeenCalled()
        expect(ssh.connect).not.toHaveBeenCalled()
        expect(database.prepare('SELECT COUNT(*) AS n FROM sqlite_master').get()).toEqual({ n: 0 })
      } finally {
        database.close()
      }
    }
  )
})
