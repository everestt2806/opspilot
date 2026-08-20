import dayjs from 'dayjs'

/** Thời gian tương đối theo quy tắc UX #5: "2 phút trước" — tooltip hiện giờ tuyệt đối riêng. */
export function relativeTime(iso: string, nowMs: number = Date.now()): string {
  const diffMs = nowMs - dayjs(iso).valueOf()
  if (diffMs < 10_000) return 'vừa xong'
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return `${seconds} giây trước`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} phút trước`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} giờ trước`
  return `${Math.floor(hours / 24)} ngày trước`
}

/** Giờ địa phương để hiển thị tuyệt đối trong tooltip. */
export function localDateTime(iso: string): string {
  return dayjs(iso).format('DD/MM/YYYY HH:mm:ss')
}
