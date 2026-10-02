import type Database from 'better-sqlite3'

import { logger } from '../logger'
import type { SshManager } from '../ssh/manager'
import type { MonitorRuntime } from './poller'
import { MonitorService } from './service'

export interface SshManagerLike {
  exec?(
    vpsId: number,
    command: string,
    options?: unknown
  ): Promise<{ code: number; stdout: string; stderr: string }>
  metricSnapshot?(
    vpsId: number,
    remotePath: string
  ): Promise<{ generation: string; device?: number; inode?: number; size: number }>
  fileIdentity?(
    vpsId: number,
    remotePath: string
  ): Promise<{ generation: string; device?: number; inode?: number }>
  fileSize?(vpsId: number, remotePath: string): Promise<number>
  readFileTail?(
    vpsId: number,
    remotePath: string,
    fromByte: number
  ): Promise<{ content: string; nextOffset: number }>
}

export interface HeadlessPollerOptions {
  db: Database.Database
  ssh: SshManager | SshManagerLike
  scorer?: MonitorRuntime
  intervalMs?: number
  autoCloseDb?: boolean
  strict?: boolean
}

export class HeadlessPoller {
  private readonly service: MonitorService
  private timer: ReturnType<typeof setInterval> | null = null
  private isPolling = false
  private currentPollPromise: Promise<void> | null = null
  private isDraining = false
  private isClosed = false
  private readonly intervalMs: number

  constructor(private readonly options: HeadlessPollerOptions) {
    // Tắt auto-train vì runner sẽ điều khiển pha train theo đặc tả TK-S6.
    // Bật strict mode (mặc định true) để mọi lỗi đọc metric/DB đều ném ra ngoài, không phát ready/drained giả.
    this.service = new MonitorService(options.db, {
      autoTrain: false,
      strict: options.strict ?? true
    })
    this.intervalMs = Math.max(100, options.intervalMs ?? 5000)
  }

  async start(): Promise<void> {
    if (this.isClosed || this.isDraining) {
      throw new Error('Không thể khởi động poller đã đóng hoặc đang drain')
    }
    // Thực hiện lượt poll đầu tiên ngay khi start. Trong strict mode, nếu lỗi thì ném ra ngoài ngay
    await this.pollOnce()

    // Khởi tạo vòng lặp chu kỳ
    this.timer = setInterval(() => {
      if (!this.isDraining && !this.isClosed) {
        void this.pollOnce().catch((err: unknown) => {
          logger.error('monitor', 'HeadlessPoller tick thất bại', {
            error: err instanceof Error ? err.message : String(err)
          })
        })
      }
    }, this.intervalMs)
  }

  async pollOnce(): Promise<void> {
    if (this.isPolling || this.isClosed) return
    this.isPolling = true
    this.currentPollPromise = (async () => {
      try {
        await this.service.pollAll(this.options.ssh as SshManager, this.options.scorer)
      } finally {
        this.isPolling = false
        this.currentPollPromise = null
      }
    })()
    await this.currentPollPromise
  }

  async drain(): Promise<{ status: 'drained' }> {
    if (this.isClosed) {
      return { status: 'drained' }
    }
    this.isDraining = true

    // 1. Dừng lịch poll
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }

    // 2. Chờ lượt đang chạy kết thúc
    if (this.currentPollPromise) {
      await this.currentPollPromise
    }

    // 3. Poll vét một lần (bắt buộc thành công, không nuốt lỗi để tránh drained giả)
    await this.service.pollAll(this.options.ssh as SshManager, this.options.scorer)

    // 4. Đóng DB nếu autoCloseDb không bị tắt (bắt buộc thành công trước khi báo drained)
    if (this.options.autoCloseDb !== false) {
      this.options.db.close()
    }

    this.isClosed = true
    return { status: 'drained' }
  }

  get active(): boolean {
    return this.timer !== null
  }

  get polling(): boolean {
    return this.isPolling
  }

  get draining(): boolean {
    return this.isDraining
  }

  get closed(): boolean {
    return this.isClosed
  }
}
