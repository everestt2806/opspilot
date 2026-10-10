import { describe, expect, it } from 'vitest'

import { relativeTime } from './format'

const NOW = Date.parse('2026-08-20T10:00:00Z')

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString()
}

describe('relativeTime', () => {
  it('mo ta dung muc do thoi gian bang tieng Anh (default)', () => {
    expect(relativeTime(ago(5_000), NOW)).toBe('just now')
    expect(relativeTime(ago(45_000), NOW)).toBe('45 seconds ago')
    expect(relativeTime(ago(5 * 60_000), NOW)).toBe('5 minutes ago')
    expect(relativeTime(ago(3 * 3_600_000), NOW)).toBe('3 hours ago')
    expect(relativeTime(ago(2 * 86_400_000), NOW)).toBe('2 days ago')
  })

  it('thoi gian tuong lai xem nhu vua xong', () => {
    expect(relativeTime(ago(-30_000), NOW)).toBe('just now')
  })

  it('ho tro tieng Viet (vi)', () => {
    expect(relativeTime(ago(5_000), NOW, 'vi')).toBe('vừa xong')
    expect(relativeTime(ago(45_000), NOW, 'vi')).toBe('45 giây trước')
    expect(relativeTime(ago(5 * 60_000), NOW, 'vi')).toBe('5 phút trước')
    expect(relativeTime(ago(3 * 3_600_000), NOW, 'vi')).toBe('3 giờ trước')
    expect(relativeTime(ago(2 * 86_400_000), NOW, 'vi')).toBe('2 ngày trước')
  })

  it('ho tro tieng Trung (cn / zh-CN)', () => {
    expect(relativeTime(ago(5_000), NOW, 'cn')).toBe('刚刚')
    expect(relativeTime(ago(45_000), NOW, 'zh-CN')).toBe('45 秒前')
    expect(relativeTime(ago(5 * 60_000), NOW, 'cn')).toBe('5 分钟前')
    expect(relativeTime(ago(3 * 3_600_000), NOW, 'cn')).toBe('3 小时前')
    expect(relativeTime(ago(2 * 86_400_000), NOW, 'zh-CN')).toBe('2 天前')
  })

  it('ho tro tieng Nhat (jp / ja-JP)', () => {
    expect(relativeTime(ago(5_000), NOW, 'jp')).toBe('たった今')
    expect(relativeTime(ago(45_000), NOW, 'ja-JP')).toBe('45 秒前')
    expect(relativeTime(ago(5 * 60_000), NOW, 'jp')).toBe('5 分前')
    expect(relativeTime(ago(3 * 3_600_000), NOW, 'jp')).toBe('3 時間前')
    expect(relativeTime(ago(2 * 86_400_000), NOW, 'ja-JP')).toBe('2 日前')
  })
})
