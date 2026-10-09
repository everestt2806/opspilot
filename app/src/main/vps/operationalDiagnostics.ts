import type { VpsOperationalDiagnostics } from '@shared/ipc'

import { AppError } from '../errors'
import type { SshManager } from '../ssh/manager'

const COMMAND_TIMEOUT_MS = 5_000
const MAX_OUTPUT_CHARS = 16_384
const MAX_PROCESSES = 10

const COMMANDS = {
  pressure: 'cat /proc/pressure/memory',
  oom: 'awk \'$1 == "oom_kill" { print; found = 1; exit } END { if (!found) exit 3 }\' /proc/vmstat',
  processes: 'ps -eo pid,rss,comm --sort=-rss | head -n 11'
} as const

export function parseMemoryPressure(output: string): VpsOperationalDiagnostics['memory_pressure'] {
  const some = parseAvg10Line(output, 'some')
  const full = parseAvg10Line(output, 'full')
  if (some === null || full === null) return null
  return { some_avg10: some, full_avg10: full }
}

export function parseOomKillCount(output: string): number | null {
  const matches = [...output.matchAll(/^\s*oom_kill\s+(\d+)\s*$/gm)]
  if (matches.length !== 1) return null
  const count = Number(matches[0]?.[1])
  return Number.isSafeInteger(count) && count >= 0 ? count : null
}

export function parseTopProcesses(
  output: string
): VpsOperationalDiagnostics['top_processes'] | null {
  if (output.length > MAX_OUTPUT_CHARS) return null
  const lines = output.trim().split(/\r?\n/)
  if (lines.length === 1 && lines[0] === '') return null
  if (!/^\s*PID\s+RSS\s+COMMAND\s*$/i.test(lines[0] ?? '')) return null

  const processes: Array<{ pid: number; name: string; rss_mb: number }> = []
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/)
    if (!match) return null
    const pid = Number(match[1])
    const rssKb = Number(match[2])
    const name = match[3]?.trim()
    if (
      !Number.isSafeInteger(pid) ||
      pid <= 0 ||
      !Number.isSafeInteger(rssKb) ||
      rssKb < 0 ||
      !name ||
      /[\r\n\0]/.test(name)
    ) {
      return null
    }
    processes.push({ pid, name, rss_mb: Math.round((rssKb / 1024) * 100) / 100 })
    if (processes.length === MAX_PROCESSES) break
  }

  return processes
}

export async function readVpsOperationalDiagnostics(
  ssh: Pick<SshManager, 'exec'>,
  vpsId: number
): Promise<VpsOperationalDiagnostics> {
  if (!Number.isSafeInteger(vpsId) || vpsId <= 0) {
    throw new AppError('VALIDATION', 'VPS không hợp lệ. Hãy tải lại danh sách rồi thử lại.')
  }

  // SshManager resolves the saved VPS before connecting; unknown IDs remain VALIDATION errors.
  const pressureOutput = await executeReadOnlySource(ssh, vpsId, COMMANDS.pressure)
  const oomOutput = await executeReadOnlySource(ssh, vpsId, COMMANDS.oom)
  const processOutput = await executeReadOnlySource(ssh, vpsId, COMMANDS.processes)

  const processes = processOutput === null ? null : parseTopProcesses(processOutput)
  return {
    sampled_at: new Date().toISOString(),
    top_processes_available: processes !== null,
    top_processes: processes ?? [],
    memory_pressure: pressureOutput === null ? null : parseMemoryPressure(pressureOutput),
    oom_kill_count: oomOutput === null ? null : parseOomKillCount(oomOutput)
  }
}

async function executeReadOnlySource(
  ssh: Pick<SshManager, 'exec'>,
  vpsId: number,
  command: string
): Promise<string | null> {
  const result = await ssh.exec(vpsId, command, {
    timeoutMs: COMMAND_TIMEOUT_MS,
    logCommand: false,
    retryOnReconnect: false
  })
  if (result.code < 0 || result.code === 255) {
    throw new AppError('SSH_HOST_UNREACHABLE', 'Kết nối SSH bị ngắt khi đọc chẩn đoán VPS.')
  }
  if (result.code !== 0 || result.stdout.length > MAX_OUTPUT_CHARS) return null
  return result.stdout
}

function parseAvg10Line(output: string, source: 'some' | 'full'): number | null {
  const matches = [...output.matchAll(new RegExp(`^${source}\\s+([^\\r\\n]+)$`, 'gm'))]
  if (matches.length !== 1) return null
  const valueMatch = matches[0]?.[1]?.match(/(?:^|\s)avg10=(\d+(?:\.\d+)?)(?:\s|$)/)
  if (!valueMatch) return null
  const value = Number(valueMatch[1])
  return Number.isFinite(value) && value >= 0 ? value : null
}
