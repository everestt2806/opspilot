import { useEffect, useState } from 'react'
import type { Vps, VpsResources } from '@shared/ipc'

/** Khoảng thời gian (ms) coi kết quả đọc tài nguyên trong phiên là "Vừa kiểm tra" trước khi hết hạn. */
export const VPS_CHECKED_NOW_TTL_MS = 60_000

/** Trạng thái 4 cửa của "xem tài nguyên" một hàng VPS:
 *  `undefined` = empty (chưa kiểm tra trong phiên). Tách riêng để test fixture không cần IPC. */
export type RowResourceState =
  | { status: 'loading' }
  | { status: 'success'; data: VpsResources; fetchedAt?: number }
  | { status: 'error'; message: string; fetchedAt?: number }

export type VpsHonestStatusKey =
  'checking' | 'checked_now' | 'check_failed' | 'stale' | 'unknown' | 'recent_past'

export type RowDisplayStatus = VpsHonestStatusKey

export interface VpsStatusDetails {
  key: VpsHonestStatusKey
  source: 'session_probe' | 'db_record'
  isFresh: boolean
  checkedAt?: number
}

/** Hook định kỳ kích hoạt re-render để cập nhật trạng thái khi TTL hết hạn */
export function useTicker(intervalMs = 5000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
    }, intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/** RAM used percent derives from MemAvailable (same value used by deploy precheck). */
export function resourcePercents(res: VpsResources): { ram: number; disk: number; cpu: number } {
  return {
    ram: clampPercent(((res.ram_total_mb - res.ram_free_mb) / res.ram_total_mb) * 100),
    disk: clampPercent(((res.disk_total_gb - res.disk_free_gb) / res.disk_total_gb) * 100),
    cpu: clampPercent((res.load_avg_1m / res.cpu_count) * 100)
  }
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

export function formatMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}

export function formatGb(gb: number): string {
  return `${Math.round(gb)} GB`
}

/** Đánh giá trạng thái trung thực của VPS:
 *  - Kết quả `vps:get-resources` thành công trong phiên: "Vừa kiểm tra" (`checked_now`), hết hạn sau `ttlMs`.
 *  - Khi hết hạn: quay về trạng thái DB tương ứng (`recent_past`, `stale` hoặc `unknown`).
 *  - Lỗi đọc tài nguyên: "Không thể kiểm tra" (`check_failed`), không tự kết luận offline.
 *  - DB `last_status` / `last_seen_at` là kết quả quá khứ:
 *    + >24h: "Chưa kiểm tra gần đây" (`stale`). Mốc 24h là quy tắc hiển thị.
 *    + null, sai định dạng hoặc thời điểm tương lai (>1m): "Chưa rõ" (`unknown`).
 *    + <=24h: "Đã kiểm tra gần đây" (`recent_past`). Không tính là `checked_now`.
 */
export function evaluateVpsStatus(
  vps: Vps,
  state: RowResourceState | undefined,
  now = Date.now(),
  ttlMs = VPS_CHECKED_NOW_TTL_MS
): VpsStatusDetails {
  if (state?.status === 'loading') {
    return { key: 'checking', source: 'session_probe', isFresh: false }
  }
  if (state?.status === 'success') {
    const isExpired =
      state.fetchedAt !== undefined &&
      (now - state.fetchedAt > ttlMs || now < state.fetchedAt - 60_000)
    if (!isExpired) {
      return {
        key: 'checked_now',
        source: 'session_probe',
        isFresh: true,
        checkedAt: state.fetchedAt
      }
    }
    // Hết hạn trong phiên: tiếp tục đối chiếu với bản ghi DB bên dưới
  }
  if (state?.status === 'error') {
    return {
      key: 'check_failed',
      source: 'session_probe',
      isFresh: false,
      checkedAt: state.fetchedAt
    }
  }

  // Chưa kiểm tra trong phiên hiện tại: đối chiếu bản ghi quá khứ trong DB
  if (!vps.last_seen_at) {
    return { key: 'unknown', source: 'db_record', isFresh: false }
  }

  const seenMs = Date.parse(vps.last_seen_at)
  if (Number.isNaN(seenMs)) {
    return { key: 'unknown', source: 'db_record', isFresh: false }
  }

  // Thời điểm tương lai (vượt quá 60s sai số đồng hồ)
  if (seenMs > now + 60_000) {
    return { key: 'unknown', source: 'db_record', isFresh: false }
  }

  const diffMs = now - seenMs
  if (diffMs < 0) {
    return { key: 'unknown', source: 'db_record', isFresh: false }
  }

  // Quá 24 giờ
  if (diffMs > 24 * 60 * 60 * 1000) {
    return { key: 'stale', source: 'db_record', isFresh: false }
  }

  return { key: 'recent_past', source: 'db_record', isFresh: false }
}

/** Tag trạng thái hàng theo quy tắc trung thực dùng chung */
export function rowDisplayStatus(
  vps: Vps,
  state: RowResourceState | undefined,
  now = Date.now(),
  ttlMs = VPS_CHECKED_NOW_TTL_MS
): RowDisplayStatus {
  return evaluateVpsStatus(vps, state, now, ttlMs).key
}

export function isVpsCheckedNow(
  vps: Vps,
  state: RowResourceState | undefined,
  now = Date.now(),
  ttlMs = VPS_CHECKED_NOW_TTL_MS
): boolean {
  return rowDisplayStatus(vps, state, now, ttlMs) === 'checked_now'
}

export function isVpsCheckFailed(
  vps: Vps,
  state: RowResourceState | undefined,
  now = Date.now(),
  ttlMs = VPS_CHECKED_NOW_TTL_MS
): boolean {
  return rowDisplayStatus(vps, state, now, ttlMs) === 'check_failed'
}
