import { describe, expect, it } from 'vitest'
import { join } from 'node:path/posix'

describe('VPS metric path', () => {
  it('giữ dấu slash POSIX trên Windows', () => {
    expect(join('/opt/opspilot', 'demo-app', 'metrics', 'metrics.jsonl')).toBe(
      '/opt/opspilot/demo-app/metrics/metrics.jsonl'
    )
  })
})
