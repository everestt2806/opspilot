import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  assertLoopbackPortAvailable,
  executeWithCleanup,
  lifecycleCanPass,
  removeOwnedScratch,
  stopOwnedChild,
  validScoreSet
} from '../../../scripts/ml-ready-6-http'

async function idleChild(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    windowsHide: true
  })
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', () => resolve())
    child.once('error', reject)
  })
  return child
}

async function awaitChildExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => child.once('exit', () => resolve()))
}

describe('ML-READY-6 HTTP harness lifecycle', () => {
  it('rejects an occupied explicit loopback port instead of using its listener', async () => {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS_UNAVAILABLE')
    try {
      await expect(assertLoopbackPortAvailable(address.port)).rejects.toThrow(
        'EXPLICIT_LOOPBACK_PORT_BUSY'
      )
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })

  it('requires all four scores to be finite numbers in the contract range', () => {
    expect(validScoreSet({ zscore_ewma: 0, iforest: 0.5, ocsvm: 1, ensemble: 0.5 })).toBe(true)
    expect(validScoreSet({ zscore_ewma: 0, iforest: null, ocsvm: 1, ensemble: 0.5 })).toBe(false)
    expect(validScoreSet({ zscore_ewma: Number.NaN, iforest: 0.5, ocsvm: 1, ensemble: 0.5 })).toBe(
      false
    )
    expect(validScoreSet({ zscore_ewma: 0, iforest: 0.5, ocsvm: 1.01, ensemble: 0.5 })).toBe(false)
  })

  it('reports taskkill failure even when fallback eventually stops the child', async () => {
    const child = await idleChild()
    await expect(
      stopOwnedChild(child, {
        port: 18765,
        timeoutMs: 1_000,
        terminateTree: async () => {
          throw new Error('TASKKILL_FAILED')
        },
        listenerPids: async () => []
      })
    ).rejects.toThrow('SERVICE_CLEANUP_FAILED:TASKKILL_FAILED')
    await awaitChildExit(child)
  })

  it('reports taskkill and fallback failure when the child remains alive past deadline', async () => {
    const child = {
      pid: 54321,
      exitCode: null,
      signalCode: null,
      kill: vi.fn(() => false)
    } as unknown as ChildProcess
    await expect(
      stopOwnedChild(child, {
        port: 18765,
        timeoutMs: 80,
        terminateTree: async () => {
          throw new Error('TASKKILL_FAILED')
        },
        listenerPids: async () => []
      })
    ).rejects.toThrow(
      'SERVICE_CLEANUP_FAILED:TASKKILL_FAILED,PROCESS_TREE_FALLBACK_KILL_FAILED,OWNED_PROCESS_TREE_STOP_DEADLINE_EXCEEDED'
    )
  })

  it('reports the stop deadline and performs a bounded fallback kill', async () => {
    const child = await idleChild()
    await expect(
      stopOwnedChild(child, {
        port: 18765,
        timeoutMs: 100,
        terminateTree: async () => undefined,
        listenerPids: async () => []
      })
    ).rejects.toThrow('OWNED_PROCESS_TREE_STOP_DEADLINE_EXCEEDED')
    await awaitChildExit(child)
  })

  it.each(['startup', 'train', 'restart'])('%s failure still runs final cleanup', async (phase) => {
    const child = await idleChild()
    const execution = await executeWithCleanup(
      async () => {
        throw new Error(`${phase.toUpperCase()}_FAILED`)
      },
      async () => {
        await stopOwnedChild(child, {
          port: 18765,
          terminateTree: async (owned) => {
            owned.kill('SIGKILL')
          },
          listenerPids: async () => []
        })
        return []
      }
    )
    expect(execution.primaryError).toBe(`${phase.toUpperCase()}_FAILED`)
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
    expect(lifecycleCanPass(execution, { service: true, listener: true, scratch: true })).toBe(
      false
    )
  })

  it('does not permit PASS when scratch cleanup fails', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'opspilot-ml-ready-6-test-'))
    const resolved = realpathSync(scratch)
    try {
      const execution = await executeWithCleanup(
        async () => 'completed',
        async () => {
          try {
            removeOwnedScratch(scratch, resolved, tmpdir(), () => {
              throw new Error('SCRATCH_CLEANUP_FAILED')
            })
            return []
          } catch {
            return ['SCRATCH_CLEANUP_FAILED']
          }
        }
      )
      expect(lifecycleCanPass(execution, { service: true, listener: true, scratch: false })).toBe(
        false
      )
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  it('retains the primary failure together with cleanup failures', async () => {
    const execution = await executeWithCleanup(
      async () => {
        throw new Error('TRAIN_FAILED')
      },
      async () => ['SCRATCH_CLEANUP_FAILED', 'PRODUCTION_MODEL_STATE_HASH_FAILED']
    )
    expect(execution.primaryError).toBe('TRAIN_FAILED')
    expect(execution.cleanupErrors).toEqual([
      'SCRATCH_CLEANUP_FAILED',
      'PRODUCTION_MODEL_STATE_HASH_FAILED'
    ])
    expect(
      lifecycleCanPass(execution, { process: true, listener: true, scratch: false, state: false })
    ).toBe(false)
  })

  it.skipIf(process.platform !== 'win32')(
    'kills a real owned Windows process tree and releases its listener',
    async () => {
      const server = createServer()
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string')
        throw new Error('TEST_SERVER_ADDRESS_UNAVAILABLE')
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )

      const listenerScript =
        "const net=require('node:net');const server=net.createServer();server.listen(Number(process.argv[1]),'127.0.0.1',()=>console.log('READY'));setInterval(()=>{},1000)"
      const childScript = `const {spawn}=require('node:child_process');const descendant=spawn(process.execPath,['-e',${JSON.stringify(listenerScript)},process.argv[1]],{stdio:['ignore','pipe','pipe']});descendant.stdout.pipe(process.stdout);descendant.stderr.pipe(process.stderr);setInterval(()=>{},1000)`
      const tree = spawn(process.execPath, ['-e', childScript, String(address.port)], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('TREE_LISTENER_START_TIMEOUT')), 5_000)
          tree.stderr?.on('data', (chunk: Buffer) => {
            clearTimeout(timeout)
            reject(new Error(`TREE_CHILD_ERROR:${chunk.toString().slice(0, 120)}`))
          })
          tree.stdout?.on('data', (chunk: Buffer) => {
            if (chunk.toString().includes('READY')) {
              clearTimeout(timeout)
              resolve()
            }
          })
          tree.once('error', reject)
        })
        await stopOwnedChild(tree, { port: address.port })
        await expect(assertLoopbackPortAvailable(address.port)).resolves.toBeUndefined()
      } finally {
        if (tree.exitCode === null && tree.signalCode === null) {
          await stopOwnedChild(tree, { port: address.port }).catch(() => undefined)
        }
      }
    }
  )
})
