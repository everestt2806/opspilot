import * as net from 'node:net'

import type { VpsDiagnosis } from '@shared/ipc'

import type { SshConnectionInfo } from './manager'

const PROBE_TIMEOUT_MS = 3_000
const SECONDARY_PROBE_TIMEOUT_MS = 2_000
/** Cổng phụ để phân biệt "máy tắt / firewall chặn tất cả" với "chỉ cổng SSH bị chặn". */
const SECONDARY_PORTS = [80, 443]

export type TcpProbeOutcome = 'open' | 'refused' | 'timeout' | 'resolve_failed' | 'unreachable'

/** Phân loại lỗi kết nối tầng TCP/tên miền — pure, test không cần socket. */
export function classifyNetError(error: unknown): TcpProbeOutcome {
  const message = error instanceof Error ? error.message : String(error)
  if (/ECONNREFUSED/.test(message)) {
    return 'refused'
  }
  if (/ENOTFOUND|EAI_AGAIN|ENXIO|ENODATA/.test(message)) {
    return 'resolve_failed'
  }
  return 'unreachable'
}

/** Thử mở TCP tới host:port, trả kết quả phân loại. Luôn đóng socket trước khi trả về. */
export function probeTcp(
  host: string,
  port: number,
  timeoutMs: number = PROBE_TIMEOUT_MS
): Promise<TcpProbeOutcome> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    let settled = false
    let timer: NodeJS.Timeout | null = null

    const finish = (outcome: TcpProbeOutcome): void => {
      if (settled) {
        return
      }
      settled = true
      if (timer) {
        clearTimeout(timer)
      }
      socket.destroy()
      resolve(outcome)
    }

    timer = setTimeout(() => finish('timeout'), timeoutMs)
    socket.once('connect', () => finish('open'))
    socket.once('error', (error) => finish(classifyNetError(error)))
  })
}

export interface HostProbe {
  primary: TcpProbeOutcome
  /** Có cổng phụ nào trả lời (open hoặc refused) — tức là máy còn sống. */
  secondaryResponded: boolean
}

/** Probe cổng SSH trước; nếu timeout thì thử thêm 80/443 để phân biệt nguyên nhân. */
export async function probeHost(
  config: SshConnectionInfo,
  probe: typeof probeTcp = probeTcp
): Promise<HostProbe> {
  const primary = await probe(config.host, config.port)
  if (primary !== 'timeout') {
    return { primary, secondaryResponded: false }
  }
  const secondary = await Promise.all(
    SECONDARY_PORTS.map((port) => probe(config.host, port, SECONDARY_PROBE_TIMEOUT_MS))
  )
  return {
    primary,
    secondaryResponded: secondary.some((outcome) => outcome === 'open' || outcome === 'refused')
  }
}

/** Phân lớp nguyên nhân từ kết quả probe TCP — trả null khi TCP mở (nên thử SSH tiếp). */
export function diagnoseFromProbe(probe: HostProbe): VpsDiagnosis | null {
  switch (probe.primary) {
    case 'resolve_failed':
    case 'unreachable':
      return {
        code: 'HOST_NOT_FOUND',
        title: 'Không tìm thấy máy chủ ở địa chỉ này',
        cause: 'Địa chỉ VPS không phân giải được hoặc không có đường mạng tới nó từ máy của bạn.',
        fixes: [
          'Kiểm tra lại địa chỉ IP/domain trong hồ sơ VPS',
          'Kiểm tra mạng của máy bạn (VPN, proxy, DNS)',
          'Nếu IP mới mua: hỏi nhà cung cấp xem IP đã kích hoạt chưa'
        ]
      }
    case 'refused':
      return {
        code: 'PORT_CLOSED',
        title: 'Máy chủ từ chối kết nối vào cổng SSH',
        cause:
          'Máy VPS còn sống và trả lời "từ chối", nghĩa là cổng bạn nhập không có dịch vụ SSH nghe.',
        fixes: [
          'Kiểm tra đúng cổng SSH (mặc định là 22)',
          'Vào dashboard của nhà cung cấp, bật dịch vụ SSH/sshd cho máy',
          'Kiểm tra quy tắc firewall đã mở đúng cổng SSH đang dùng'
        ]
      }
    case 'timeout':
      return probe.secondaryResponded
        ? {
            code: 'PORT_TIMEOUT',
            title: 'Cổng SSH im lặng nhưng máy còn sống',
            cause:
              'Cổng SSH không phản hồi trong khi các cổng khác (80/443) vẫn trả lời — nhiều khả năng firewall chỉ chặn cổng SSH, hoặc SSH đang nghe ở cổng khác.',
            fixes: [
              'Mở quy tắc firewall cho cổng SSH (TCP) trên dashboard nhà cung cấp',
              'Kiểm tra máy đang mở đúng cổng SSH mà bạn nhập',
              'Thử cổng SSH khác nếu nhà cung cấp đổi cổng mặc định'
            ]
          }
        : {
            code: 'PORT_TIMEOUT',
            title: 'Mọi cổng đều im lặng — nghi firewall chặn toàn bộ inbound',
            cause:
              'Không cổng nào (SSH, 80, 443) phản hồi dù máy có thể đang chạy. Đây là triệu chứng điển hình của tường lửa chặn hết truy cập từ ngoài vào.',
            fixes: [
              'Mở dashboard nhà cung cấp: kiểm tra máy đang ở trạng thái Running',
              'Thêm quy tắc firewall cho cổng SSH (22) — ví dụ WiService chặn toàn bộ inbound theo mặc định',
              'Nếu đã có quy tắc: kiểm tra lại IP rồi liên hệ nhà cung cấp'
            ]
          }
    case 'open':
      return null
  }
}

/** Phân lớp lỗi từ tầng SSH sau khi TCP đã mở (auth sai / handshake giữa chừng). */
export function diagnoseFromSshError(code: string): VpsDiagnosis | null {
  switch (code) {
    case 'SSH_AUTH_FAILED':
      return {
        code: 'SSH_AUTH_FAILED',
        title: 'Sai mật khẩu hoặc private key',
        cause: 'Máy nhận kết nối nhưng từ chối thông tin đăng nhập bạn gửi.',
        fixes: [
          'Nhập lại mật khẩu / private key của tài khoản VPS',
          'Nếu dùng key: dán đủ nội dung file, gồm cả dòng BEGIN/END',
          'Nếu máy đã tắt đăng nhập bằng mật khẩu: chỉ key đúng mới vào được'
        ]
      }
    case 'SSH_TIMEOUT':
      return {
        code: 'SSH_HANDSHAKE_TIMEOUT',
        title: 'Cổng trả lời nhưng không phải SSH (hoặc mạng quá chậm)',
        cause: 'TCP mở được nhưng dịch vụ trên cổng không trả lời bản tin SSH đúng hạn.',
        fixes: [
          'Kiểm tra cổng này có đúng là SSH không',
          'Kiểm tra đường mạng tới VPS (ping, tốc độ)',
          'Thử lại sau vài phút nếu mạng đang nghẽn'
        ]
      }
    case 'SSH_HOST_UNREACHABLE':
      return {
        code: 'PORT_CLOSED',
        title: 'Kết nối bị ngắt ngay khi bắt tay',
        cause:
          'TCP mở được nhưng dịch vụ phía bên kia đóng kết nối ngay — thường là cổng không phải SSH.',
        fixes: ['Xác nhận lại cổng SSH', 'Kiểm tra trạng thái sshd trên máy (console dashboard)']
      }
    default:
      return null
  }
}

/** Chạy trước khi thử SSH: kết luận được ngay từ TCP thì trả chẩn đoán, không thì null. */
export async function preDiagnose(config: SshConnectionInfo): Promise<VpsDiagnosis | null> {
  return diagnoseFromProbe(await probeHost(config))
}
