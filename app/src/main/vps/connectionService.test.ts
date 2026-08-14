import { describe, expect, it } from 'vitest'

import { parseResourcesOutput } from './connectionService'

describe('parseResourcesOutput', () => {
  it('phan tich du lieu thuc te tu free/df/nproc/loadavg', () => {
    const resources = parseResourcesOutput(
      [
        'RAM|8388608000 2097152000',
        'DISK|/dev/vda1 40960 8192 32768 21% /',
        'CPU|2',
        'LOAD|1.5'
      ].join('\n')
    )

    expect(resources).toEqual({
      ram_total_mb: 8000,
      ram_free_mb: 2000,
      disk_total_gb: 40,
      disk_free_gb: 32,
      cpu_count: 2,
      load_avg_1m: 1.5
    })
  })

  it('nem loi khi thieu truong bat ky', () => {
    expect(() => parseResourcesOutput('RAM|8388608000 2097152000')).toThrow()
  })
})
