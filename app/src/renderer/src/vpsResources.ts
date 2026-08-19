import type { Vps, VpsResources } from '@shared/ipc'

/** Trạng thái 4 cửa của "xem tài nguyên" một hàng VPS:
 *  `undefined` = empty (chưa kiểm tra). Tách riêng để test fixture không cần IPC. */
export type RowResourceState =
  | { status: 'loading' }
  | { status: 'success'; data: VpsResources }
  | { status: 'error'; message: string }

export type RowDisplayStatus = 'checking' | 'online' | 'offline' | 'unknown'

/** Phần trăm dùng: RAM, Disk, tải CPU (load/cpu_count) — mỗi giá trị trong [0, 100]. */
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

/** Tag trạng thái hàng: ưu tiên trạng thái tài nguyên live, rồi mới tới `last_status` trong DB. */
export function rowDisplayStatus(vps: Vps, state: RowResourceState | undefined): RowDisplayStatus {
  if (state?.status === 'loading') return 'checking'
  if (state?.status === 'success') return 'online'
  if (state?.status === 'error') return 'offline'
  if (vps.last_status === 'online') return 'online'
  if (vps.last_status === 'offline') return 'offline'
  return 'unknown'
}
