import { PassThrough, Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PRODUCT_CONTROLLER_ENROLLMENT_MAX_INPUT_BYTES } from '../../../../docs/contracts/product-controller-bootstrap'
import { readControllerBootstrapInput } from './controllerBootstrapInput'

afterEach(() => vi.useRealTimers())

describe('Controller enrollment bounded stdin', () => {
  it('reads chunked UTF-8 JSON to EOF without environment/argv fallback', async () => {
    const bytes = Buffer.from('{"name":"Máy thử","secret":"SYNTHETIC_UNIT_MATERIAL"}')
    const stream = Readable.from([bytes.subarray(0, 13), bytes.subarray(13)])
    expect(await readControllerBootstrapInput(stream, new AbortController().signal)).toEqual({
      name: 'Máy thử',
      secret: 'SYNTHETIC_UNIT_MATERIAL'
    })
  })

  it.each([
    Buffer.from('{"secret":"SYNTHETIC_UNIT_MATERIAL"'),
    Buffer.from([0xff]),
    Buffer.alloc(PRODUCT_CONTROLLER_ENROLLMENT_MAX_INPUT_BYTES + 1, 32),
    Buffer.alloc(0)
  ])(
    'refuses malformed, invalid UTF-8, oversized or empty input %# without raw details',
    async (input) => {
      await expect(
        readControllerBootstrapInput(Readable.from([input]), new AbortController().signal)
      ).rejects.toThrow(/^CONTROLLER_VPS_INPUT_INVALID$/)
    }
  )

  it('refuses TTY to avoid echoing a secret', async () => {
    const stream = Object.assign(new PassThrough(), { isTTY: true })
    await expect(
      readControllerBootstrapInput(stream, new AbortController().signal)
    ).rejects.toThrow(/^CONTROLLER_VPS_STDIN_REQUIRED$/)
    stream.destroy()
  })

  it('handles abort before and during input without hanging', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      readControllerBootstrapInput(Readable.from([]), controller.signal)
    ).rejects.toThrow(/^CONTROLLER_VPS_ENROLLMENT_ABORTED$/)
    const during = new AbortController()
    const stream = new PassThrough()
    const result = expect(readControllerBootstrapInput(stream, during.signal)).rejects.toThrow(
      /^CONTROLLER_VPS_ENROLLMENT_ABORTED$/
    )
    during.abort()
    await result
    expect(stream.destroyed).toBe(true)
  })

  it('times out incomplete input and clears its timer', async () => {
    vi.useFakeTimers()
    const stream = new PassThrough()
    const result = expect(
      readControllerBootstrapInput(stream, new AbortController().signal)
    ).rejects.toThrow(/^CONTROLLER_VPS_INPUT_INVALID$/)
    await vi.advanceTimersByTimeAsync(30_001)
    await result
    expect(stream.destroyed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
