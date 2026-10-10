import * as http from 'node:http'

import type { VpsDiagnosis } from '@shared/ipc'

/**
 * TK-A19 — hậu-kiểm sau HEALTHCHECK: app "healthy" nội bộ (loopback trên VPS) vẫn có thể không
 * truy cập được từ Internet vì firewall dashboard nhà cung cấp chặn inbound (WiService chặn toàn
 * bộ theo mặc định — xem docs/08). Module này:
 *   1. Quyết định lệnh `ufw allow <port>/tcp` CÓ ĐIỀU KIỆN (chỉ khi ufw đang bật) — tầng automate
 *      được qua ssh exec. ufw tắt (mặc định dự án) -> no-op, không làm hỏng deploy.
 *   2. Dựng `VpsDiagnosis` code `PORT_BLOCKED_EXTERNAL` khi loopback pass nhưng probe từ máy user fail.
 *
 * Toàn bộ logic quyết định là THUẦN (không I/O) để test không cần VPS/mạng; phần probe HTTP và
 * ssh exec được inject hoặc gói mỏng ở cuối file.
 */

const EXTERNAL_PROBE_TIMEOUT_MS = 5_000
const EXTERNAL_PROBE_ATTEMPTS = 3

// ── 1. ufw có điều kiện (thuần) ──────────────────────────────────────────────

export type UfwState = 'active' | 'inactive' | 'unknown'

/**
 * Phân loại output `ufw status`. `Status: active` -> active; `Status: inactive` -> inactive;
 * không khớp (chưa cài ufw, lỗi sudo…) -> unknown. Thuần, không phân biệt hoa/thường.
 */
export function parseUfwState(statusStdout: string): UfwState {
  const text = statusStdout.toLowerCase()
  if (/status:\s*active/.test(text)) {
    return 'active'
  }
  if (/status:\s*inactive/.test(text)) {
    return 'inactive'
  }
  return 'unknown'
}

/** Lệnh mở đúng một cổng app (idempotent — ufw allow chạy lại không lỗi). Chỉ mở TCP cổng đó. */
export function ufwAllowCommand(hostPort: number): string {
  if (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65535) {
    throw new Error(`host_port không hợp lệ: ${hostPort}`)
  }
  return `ufw allow ${hostPort}/tcp`
}

export interface UfwDecision {
  /** Có chạy lệnh allow không (chỉ khi ufw active). */
  shouldAllow: boolean
  /** Câu tiếng Việt ghi vào log deploy. */
  logMessage: string
  /** Lệnh sẽ chạy khi shouldAllow=true. */
  command: string | null
}

/**
 * Quyết định từ trạng thái ufw + cổng: active -> mở cổng; inactive -> no-op (mặc định dự án đã tắt
 * ufw, docs/08); unknown -> no-op an toàn (không đoán). Thuần.
 */
export function decideUfw(state: UfwState, hostPort: number): UfwDecision {
  switch (state) {
    case 'active':
      return {
        shouldAllow: true,
        command: ufwAllowCommand(hostPort),
        logMessage: `ufw đang bật — mở cổng ${hostPort}/tcp cho app.`
      }
    case 'inactive':
      return {
        shouldAllow: false,
        command: null,
        logMessage: `ufw đang tắt (mặc định dự án) — bỏ qua, không cần mở cổng ${hostPort}.`
      }
    case 'unknown':
      return {
        shouldAllow: false,
        command: null,
        logMessage: 'Không xác định được trạng thái ufw — bỏ qua mở cổng để không làm hỏng deploy.'
      }
  }
}

// ── 2. Chẩn đoán reachability ngoài (thuần) ──────────────────────────────────

export type ExternalProbeOutcome = 'reachable' | 'unreachable'

/**
 * Dựng chẩn đoán khi loopback pass nhưng external fail. Thuần — nhận cổng, trả `VpsDiagnosis`
 * code `PORT_BLOCKED_EXTERNAL` với hướng dẫn tiếng Việt (mở dashboard, kiểm ufw, dùng tunnel).
 */
export function diagnosePortBlockedExternal(hostPort: number): VpsDiagnosis {
  return {
    code: 'PORT_BLOCKED_EXTERNAL',
    title: 'App chạy nhưng bị chặn từ ngoài',
    cause:
      `Container trả lời healthy ngay trên VPS, nhưng cổng ${hostPort} không phản hồi từ Internet — ` +
      'gần như chắc chắn firewall trên dashboard nhà cung cấp đang chặn inbound.',
    fixes: [
      `Mở cổng TCP ${hostPort} trong dashboard nhà cung cấp (mục Firewall/Security) — ví dụ WiService chặn toàn bộ inbound theo mặc định`,
      'Nếu đã bật ufw trên VPS: kiểm tra ufw đã allow cổng này chưa',
      'Chưa mở được dashboard? Dùng nút "Tạo URL public" (tunnel) để demo tạm'
    ]
  }
}

export interface ReachabilityResult {
  externalOk: boolean
  /** Câu tiếng Việt ghi log. */
  logMessage: string
  /** Chỉ có khi loopback pass nhưng external fail. */
  diagnosis: VpsDiagnosis | null
}

/**
 * Kết hợp kết quả loopback (HEALTHCHECK đã có) + external probe -> quyết định báo gì. Thuần.
 * - loopback fail: reachability không kết luận thêm (HEALTHCHECK đã báo lỗi riêng) -> không diagnosis.
 * - loopback ok + external ok: URL dùng được thật.
 * - loopback ok + external fail: dựng PORT_BLOCKED_EXTERNAL.
 */
export function assessReachability(
  loopbackOk: boolean,
  externalOutcome: ExternalProbeOutcome,
  hostPort: number
): ReachabilityResult {
  if (!loopbackOk) {
    return {
      externalOk: false,
      logMessage: 'Bỏ qua kiểm tra truy cập ngoài vì healthcheck nội bộ chưa đạt.',
      diagnosis: null
    }
  }
  if (externalOutcome === 'reachable') {
    return {
      externalOk: true,
      logMessage: `Truy cập từ ngoài: OK — cổng ${hostPort} phản hồi từ Internet.`,
      diagnosis: null
    }
  }
  return {
    externalOk: false,
    logMessage:
      `Truy cập từ ngoài: THẤT BẠI — container healthy nội bộ nhưng cổng ${hostPort} ` +
      'không phản hồi từ Internet (nghi firewall nhà cung cấp chặn inbound).',
    diagnosis: diagnosePortBlockedExternal(hostPort)
  }
}

// ── 3. I/O mỏng: probe HTTP từ máy user ──────────────────────────────────────

/** Một lần GET, trả true nếu nhận được HTTP response bất kỳ (kể cả 4xx/5xx — nghĩa là cổng thông). */
export function probeHttpOnce(
  url: string,
  timeoutMs: number = EXTERNAL_PROBE_TIMEOUT_MS
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      resolve(ok)
    }
    const request = http.get(url, (response) => {
      // Nhận được status = cổng thông tới app; huỷ body để không giữ kết nối.
      response.resume()
      finish(true)
    })
    request.setTimeout(timeoutMs, () => {
      request.destroy()
      finish(false)
    })
    request.once('error', () => finish(false))
  })
}

/**
 * Probe URL vài lần (mặc định 3), coi là reachable nếu BẤT KỲ lần nào thông. Inject `probe` để test.
 */
export async function probeExternalReachable(
  url: string,
  attempts: number = EXTERNAL_PROBE_ATTEMPTS,
  probe: (u: string) => Promise<boolean> = probeHttpOnce
): Promise<ExternalProbeOutcome> {
  for (let i = 0; i < Math.max(1, attempts); i += 1) {
    if (await probe(url)) {
      return 'reachable'
    }
  }
  return 'unreachable'
}
