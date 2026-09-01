import { logger } from '../logger'

export class MonitorScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private current: Promise<void> | null = null
  private stopping = false
  constructor(
    private readonly pollAll: () => Promise<void>,
    private readonly intervalMs = 30_000
  ) {}
  start(): void {
    if (this.timer || this.stopping) return
    this.timer = setInterval(() => {
      void this.tick().catch((error) => {
        logger.error('monitor', 'Monitor scheduler tick thất bại', {
          error: error instanceof Error ? error.message : String(error)
        })
      })
    }, this.intervalMs)
  }
  async stop(): Promise<void> {
    this.stopping = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await this.current
  }
  async tick(): Promise<void> {
    if (this.running || this.stopping) return
    this.running = true
    this.current = this.pollAll()
    try {
      await this.current
    } finally {
      this.current = null
      this.running = false
      if (!this.timer) this.stopping = false
    }
  }
  get active(): boolean {
    return this.timer !== null
  }
}
