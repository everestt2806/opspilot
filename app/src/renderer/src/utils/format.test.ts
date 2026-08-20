import { describe, expect, it } from 'vitest'

import { relativeTime } from './format'

const NOW = Date.parse('2026-08-20T10:00:00Z')

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString()
}

describe('relativeTime', () => {
  it('mo ta dung muc do thoi gian', () => {
    expect(relativeTime(ago(5_000), NOW)).toBe('vừa xong')
    expect(relativeTime(ago(45_000), NOW)).toBe('45 giây trước')
    expect(relativeTime(ago(5 * 60_000), NOW)).toBe('5 phút trước')
    expect(relativeTime(ago(3 * 3_600_000), NOW)).toBe('3 giờ trước')
    expect(relativeTime(ago(2 * 86_400_000), NOW)).toBe('2 ngày trước')
  })

  it('thoi gian tuong lai xem nhu vua xong', () => {
    expect(relativeTime(ago(-30_000), NOW)).toBe('vừa xong')
  })
})
