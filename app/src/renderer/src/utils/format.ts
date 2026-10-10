import dayjs from 'dayjs'

export type RelativeTimeLocale = 'en' | 'vi' | 'cn' | 'zh-CN' | 'jp' | 'ja-JP'

interface TimeLabels {
  justNow: string
  secondsAgo: (s: number) => string
  minutesAgo: (m: number) => string
  hoursAgo: (h: number) => string
  daysAgo: (d: number) => string
}

const TIME_LABELS: Record<'en' | 'vi' | 'cn' | 'jp', TimeLabels> = {
  en: {
    justNow: 'just now',
    secondsAgo: (s) => `${s} seconds ago`,
    minutesAgo: (m) => `${m} minutes ago`,
    hoursAgo: (h) => `${h} hours ago`,
    daysAgo: (d) => `${d} days ago`
  },
  vi: {
    justNow: 'vừa xong',
    secondsAgo: (s) => `${s} giây trước`,
    minutesAgo: (m) => `${m} phút trước`,
    hoursAgo: (h) => `${h} giờ trước`,
    daysAgo: (d) => `${d} ngày trước`
  },
  cn: {
    justNow: '刚刚',
    secondsAgo: (s) => `${s} 秒前`,
    minutesAgo: (m) => `${m} 分钟前`,
    hoursAgo: (h) => `${h} 小时前`,
    daysAgo: (d) => `${d} 天前`
  },
  jp: {
    justNow: 'たった今',
    secondsAgo: (s) => `${s} 秒前`,
    minutesAgo: (m) => `${m} 分前`,
    hoursAgo: (h) => `${h} 時間前`,
    daysAgo: (d) => `${d} 日前`
  }
}

function normalizeLocale(locale?: string): 'en' | 'vi' | 'cn' | 'jp' {
  if (!locale) return 'en'
  if (locale === 'vi') return 'vi'
  if (locale === 'cn' || locale.startsWith('zh')) return 'cn'
  if (locale === 'jp' || locale.startsWith('ja')) return 'jp'
  return 'en'
}

/** Thời gian tương đối theo quy tắc UX #5: hỗ trợ 4 ngôn ngữ (en, vi, cn, jp). */
export function relativeTime(
  iso: string,
  nowMs: number = Date.now(),
  locale: string = 'en'
): string {
  const diffMs = nowMs - dayjs(iso).valueOf()
  const labels = TIME_LABELS[normalizeLocale(locale)]
  if (diffMs < 10_000) return labels.justNow
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return labels.secondsAgo(seconds)
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return labels.minutesAgo(minutes)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return labels.hoursAgo(hours)
  return labels.daysAgo(Math.floor(hours / 24))
}

/** Giờ địa phương để hiển thị tuyệt đối trong tooltip. */
export function localDateTime(iso: string): string {
  return dayjs(iso).format('DD/MM/YYYY HH:mm:ss')
}
