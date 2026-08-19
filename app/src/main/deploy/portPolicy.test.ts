import { describe, expect, it } from 'vitest'

import { allocatePort, PORT_RANGE } from './portPolicy'

describe('allocatePort', () => {
  it('chon port nho nhat trong dai khi chua dung port nao', () => {
    expect(allocatePort([])).toBe(PORT_RANGE.first)
  })

  it('bo qua cac port da dung', () => {
    expect(allocatePort([30000, 30001, 30002])).toBe(30003)
    expect(allocatePort([30000, 30001, 30004])).toBe(30002)
  })

  it('bao PORT_EXHAUSTED khi het port trong dai', () => {
    const all = Array.from(
      { length: PORT_RANGE.last - PORT_RANGE.first + 1 },
      (_value, index) => PORT_RANGE.first + index
    )
    expect(() => allocatePort(all)).toThrow('PORT_EXHAUSTED')
  })
})
