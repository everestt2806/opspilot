export class MonitorScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  constructor(
    private readonly pollAll: () => Promise<void>,
    private readonly intervalMs = 30_000
  ) {}
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.tick()
    }, this.intervalMs)
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      await this.pollAll()
    } finally {
      this.running = false
    }
  }
  get active(): boolean {
    return this.timer !== null
  }
}
