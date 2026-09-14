import { describe, expect, it } from 'vitest'

import { withAppLock } from './appLock'

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

describe('shared deploy/monitor app lock', () => {
  it('serializes monitor and deployment jobs for one app while allowing other apps', async () => {
    const events: string[] = []
    let running = 0
    let maxRunning = 0
    const job = async (name: string): Promise<void> => {
      running += 1
      maxRunning = Math.max(maxRunning, running)
      events.push(`${name}:start`)
      await wait(5)
      events.push(`${name}:end`)
      running -= 1
    }
    await Promise.all([withAppLock(1, () => job('monitor')), withAppLock(1, () => job('deploy'))])
    expect(maxRunning).toBe(1)
    expect(events).toEqual(['monitor:start', 'monitor:end', 'deploy:start', 'deploy:end'])

    await Promise.all([withAppLock(1, () => job('a')), withAppLock(2, () => job('b'))])
    expect(maxRunning).toBe(2)
  })
})
