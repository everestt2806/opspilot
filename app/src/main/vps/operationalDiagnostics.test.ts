import { describe, expect, it, vi } from 'vitest'

import { AppError } from '../errors'
import {
  parseMemoryPressure,
  parseOomKillCount,
  parseTopProcesses,
  readVpsOperationalDiagnostics
} from './operationalDiagnostics'

const pressureFixture = [
  'some avg10=0.12 avg60=0.10 avg300=0.08 total=1234',
  'full avg10=0.01 avg60=0.02 avg300=0.03 total=12'
].join('\n')
const processFixture = ['PID RSS COMMAND', '42 2048 node worker name', '7 1024 postgres'].join('\n')

describe('operational diagnostics parsers', () => {
  it('parses memory pressure avg10 values and oom_kill without inventing missing counts', () => {
    expect(parseMemoryPressure(pressureFixture)).toEqual({ some_avg10: 0.12, full_avg10: 0.01 })
    expect(parseOomKillCount('oom_kill 0\n')).toBe(0)
    expect(parseOomKillCount('oom_kill not-a-count\n')).toBeNull()
  })

  it('returns null for unsupported and malformed kernel sources', () => {
    expect(parseMemoryPressure('')).toBeNull()
    expect(parseMemoryPressure('some avg10=NaN\nfull avg10=0.0')).toBeNull()
    expect(parseOomKillCount('nr_page_events 4\n')).toBeNull()
  })

  it('parses process names from comm, converts RSS and bounds output to ten rows', () => {
    const output = [
      'PID RSS COMMAND',
      ...Array.from({ length: 12 }, (_, index) => `${index + 1} ${index * 1024} proc-${index}`)
    ].join('\n')
    const parsed = parseTopProcesses(output)
    expect(parsed).toHaveLength(10)
    expect(parsed?.[1]).toEqual({ pid: 2, name: 'proc-1', rss_mb: 1 })
    expect(parseTopProcesses('ps failed: synthetic')).toBeNull()
    expect(parseTopProcesses('PID RSS COMMAND\nnot a process row')).toBeNull()
  })
})

describe('readVpsOperationalDiagnostics', () => {
  it('runs only fixed read-only commands and returns an ISO timestamp', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, stdout: pressureFixture, stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: 'oom_kill 2\n', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: processFixture, stderr: '' })

    const sample = await readVpsOperationalDiagnostics({ exec } as never, 3)

    expect(sample).toMatchObject({
      top_processes_available: true,
      top_processes: [
        { pid: 42, name: 'node worker name', rss_mb: 2 },
        { pid: 7, name: 'postgres', rss_mb: 1 }
      ],
      memory_pressure: { some_avg10: 0.12, full_avg10: 0.01 },
      oom_kill_count: 2
    })
    expect(new Date(sample.sampled_at).toISOString()).toBe(sample.sampled_at)
    expect(exec).toHaveBeenCalledTimes(3)
    expect(exec.mock.calls.map((call) => call[1])).toEqual([
      'cat /proc/pressure/memory',
      expect.stringContaining('/proc/vmstat'),
      'ps -eo pid,rss,comm --sort=-rss | head -n 11'
    ])
    for (const [, , options] of exec.mock.calls) {
      expect(options).toMatchObject({ timeoutMs: 5000, logCommand: false, retryOnReconnect: false })
    }
    expect(exec.mock.calls[1]?.[1]).toContain('oom_kill')
  })

  it('marks unsupported or malformed sources unavailable while preserving other readings', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'not available' })
      .mockResolvedValueOnce({ code: 0, stdout: 'malformed', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: 'malformed process output', stderr: '' })

    const sample = await readVpsOperationalDiagnostics({ exec } as never, 3)

    expect(sample).toMatchObject({
      top_processes_available: false,
      top_processes: [],
      memory_pressure: null,
      oom_kill_count: null
    })
  })

  it('keeps valid readings when one independent source is unavailable', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, stdout: pressureFixture, stderr: '' })
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'not supported' })
      .mockResolvedValueOnce({ code: 0, stdout: 'PID RSS COMMAND\n', stderr: '' })

    await expect(readVpsOperationalDiagnostics({ exec } as never, 3)).resolves.toMatchObject({
      top_processes_available: true,
      top_processes: [],
      memory_pressure: { some_avg10: 0.12, full_avg10: 0.01 },
      oom_kill_count: null
    })
  })

  it('rejects invalid IDs before invoking SSH and propagates unknown IDs as validation errors', async () => {
    const exec = vi.fn()
    await expect(
      readVpsOperationalDiagnostics({ exec } as never, Number.MAX_SAFE_INTEGER + 1)
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(exec).not.toHaveBeenCalled()

    exec.mockRejectedValueOnce(new AppError('VALIDATION', 'Unknown VPS'))
    await expect(readVpsOperationalDiagnostics({ exec } as never, 999)).rejects.toMatchObject({
      code: 'VALIDATION'
    })
    expect(exec).toHaveBeenCalledOnce()
  })

  it.each(['SSH_AUTH_FAILED', 'SSH_TIMEOUT', 'SSH_HOST_UNREACHABLE'] as const)(
    'propagates SSH error %s instead of returning a fake sample',
    async (code) => {
      const exec = vi.fn().mockRejectedValue(new AppError(code, 'synthetic transport failure'))
      await expect(readVpsOperationalDiagnostics({ exec } as never, 3)).rejects.toMatchObject({
        code
      })
      expect(exec).toHaveBeenCalledOnce()
    }
  )

  it('treats an SSH command with no exit status as a disconnected transport', async () => {
    for (const code of [-1, 255]) {
      const exec = vi.fn().mockResolvedValue({ code, stdout: '', stderr: '' })
      await expect(readVpsOperationalDiagnostics({ exec } as never, 3)).rejects.toMatchObject({
        code: 'SSH_HOST_UNREACHABLE'
      })
    }
  })
})
