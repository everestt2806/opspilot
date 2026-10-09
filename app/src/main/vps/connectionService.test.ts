import { describe, expect, it, vi } from 'vitest'

import {
  parseResourcesOutput,
  readVpsResources,
  testConnectionWithCredentials
} from './connectionService'

describe('parseResourcesOutput', () => {
  it('uses MemAvailable for the legacy RAM field and keeps MemFree separate', () => {
    const resources = parseResourcesOutput(
      [
        'RAM|8388608000 321912832 3134371840',
        'DISK|/dev/vda1 40960 8192 32768 21% /',
        'CPU|2',
        'LOAD|1.5'
      ].join('\n')
    )

    expect(resources).toEqual({
      ram_total_mb: 8000,
      ram_free_mb: 2989,
      disk_total_gb: 40,
      disk_free_gb: 32,
      cpu_count: 2,
      load_avg_1m: 1.5
    })
  })

  it('nem loi khi thieu truong bat ky', () => {
    expect(() => parseResourcesOutput('RAM|8388608000 2097152000')).toThrow()
  })

  it('rejects RAM output that does not include MemAvailable', () => {
    const output = [
      'RAM|8388608000 321912832',
      'DISK|/dev/vda1 40960 8192 32768 21% /',
      'CPU|2',
      'LOAD|1.5'
    ].join('\n')
    expect(() => parseResourcesOutput(output)).toThrow('không đầy đủ')
  })
})

describe('readVpsResources', () => {
  it('reads MemTotal, MemFree, and MemAvailable explicitly from procfs', async () => {
    const exec = vi.fn(async (_vpsId: number, command: string) => {
      expect(command).toContain('/proc/meminfo')
      expect(command).toContain('MemFree:')
      expect(command).toContain('MemAvailable:')
      expect(command).not.toContain("free -b | awk 'NR==2{print $2,$4}'")
      return {
        code: 0,
        stdout: [
          'RAM|8388608000 321912832 3134371840',
          'DISK|/dev/vda1 40960 8192 32768 21% /',
          'CPU|2',
          'LOAD|1.5'
        ].join('\n'),
        stderr: ''
      }
    })

    const resources = await readVpsResources({ exec } as never, 1)

    expect(exec).toHaveBeenCalledOnce()
    expect(resources.ram_free_mb).toBe(2989)
  })
})

describe('testConnectionWithCredentials', () => {
  it('refuses a missing fingerprint before probing TCP or SSH', async () => {
    const result = await testConnectionWithCredentials({
      host: 'vps.example.invalid',
      port: 22,
      hostFingerprint: null,
      username: 'test-user',
      authType: 'password',
      secret: ''
    })

    expect(result.ssh_ok).toBe(false)
    expect(result.steps[0]?.detail).toContain('fingerprint SSH SHA256')
    expect(result.diagnosis?.title).toContain('fingerprint SSH')
  })
})
