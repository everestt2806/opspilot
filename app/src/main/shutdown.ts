export interface ShutdownRuntime {
  stopScheduler(): Promise<void>
  stopMl(): void
  disconnectSsh(): Promise<void>
  quit(): void
  report(error: unknown): void
}

export async function shutdownRuntime(runtime: ShutdownRuntime): Promise<void> {
  try {
    await runtime.stopScheduler()
  } catch (error) {
    runtime.report(error)
  } finally {
    runtime.stopMl()
    try {
      await runtime.disconnectSsh()
    } catch (error) {
      runtime.report(error)
    } finally {
      runtime.quit()
    }
  }
}
