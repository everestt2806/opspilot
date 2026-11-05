import type { ChildProcess } from 'node:child_process'

/** Signals only the process group created by a detached Linux Git child; falls back to its child elsewhere. */
export function signalChildProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform === 'linux' && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // The owned group can already have exited; still signal the direct child below.
    }
  }
  try {
    child.kill(signal)
  } catch {
    // Callers wait for close before treating termination and cleanup as complete.
  }
}
