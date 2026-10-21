import { createServer } from 'node:net'
import { spawn } from 'node:child_process'

import { describe, expect, it } from 'vitest'

import {
  assertLoopbackPortAvailable,
  stopOwnedChild,
  validScoreSet
} from '../../../scripts/ml-ready-6-http'

describe('ML-READY-6 HTTP harness guards', () => {
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

  it('stops and awaits only the owned service child', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      windowsHide: true
    })
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve())
      child.once('error', reject)
    })
    await stopOwnedChild(child)
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
  })
})
