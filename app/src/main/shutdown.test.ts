import { describe, expect, it, vi } from 'vitest'
import { shutdownRuntime } from './shutdown'

describe('shutdownRuntime', () => {
  it('giữ thứ tự cleanup và vẫn quit khi scheduler reject', async () => {
    const order: string[] = []
    await shutdownRuntime({
      stopScheduler: async () => {
        order.push('scheduler')
        throw new Error('poll failed')
      },
      stopMl: () => order.push('ml'),
      disconnectSsh: async () => {
        order.push('ssh')
        throw new Error('disconnect failed')
      },
      quit: () => order.push('quit'),
      report: vi.fn((error) => order.push(error instanceof Error ? error.message : String(error)))
    })
    expect(order).toEqual(['scheduler', 'poll failed', 'ml', 'ssh', 'disconnect failed', 'quit'])
  })
})
