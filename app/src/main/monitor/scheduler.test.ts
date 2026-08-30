import { describe, expect, it, vi } from 'vitest'
import { MonitorScheduler } from './scheduler'
describe('MonitorScheduler', () => {
  it('bỏ tick chồng và dọn timer', async () => {
    let release!: () => void
    const work = new Promise<void>((resolve) => {
      release = resolve
    })
    const scheduler = new MonitorScheduler(
      vi.fn(() => work),
      1000
    )
    const first = scheduler.tick()
    const second = scheduler.tick()
    expect(scheduler.active).toBe(false)
    release()
    await first
    await second
    scheduler.start()
    expect(scheduler.active).toBe(true)
    scheduler.stop()
    expect(scheduler.active).toBe(false)
  })

  it('stop chờ poll đang chạy', async () => {
    let release!: () => void
    const work = new Promise<void>((resolve) => {
      release = resolve
    })
    const scheduler = new MonitorScheduler(
      vi.fn(() => work),
      1000
    )
    const tick = scheduler.tick()
    const stopping = scheduler.stop()
    let done = false
    void stopping.then(() => {
      done = true
    })
    await Promise.resolve()
    expect(done).toBe(false)
    release()
    await tick
    await stopping
    expect(done).toBe(true)
  })
})
