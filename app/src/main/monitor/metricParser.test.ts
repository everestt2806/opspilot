import { describe, expect, it } from 'vitest'

import { completeByteLength, parseMetricContent } from './metricParser'

const line = (seq: number, version = '1.0.0'): string =>
  JSON.stringify({
    seq,
    ts: '2026-08-30T00:00:00Z',
    cpu_pct: 1,
    mem_mb: 2,
    mem_pct: 3,
    mem_limit_mb: 4,
    latency_ms: null,
    http_error_rate: 0,
    db_response_ms: null,
    container_up: 1,
    host_cpu_pct: null,
    host_mem_pct: null,
    collector_version: version
  })

describe('metric parser', () => {
  it('tính offset theo byte UTF-8 và giữ dòng partial', () => {
    const content = `${line(1)}\n${line(2)}\n{"seq":3,"collector_version":"dở`
    expect(completeByteLength(content)).toBe(Buffer.byteLength(`${line(1)}\n${line(2)}\n`, 'utf8'))
    expect(parseMetricContent(content.slice(0, content.lastIndexOf('\n') + 1))).toHaveLength(2)
  })

  it('consume dòng JSON hỏng nhưng không chặn dòng sau', () => {
    const result = parseMetricContent(`${line(1)}\n{oops}\n${line(2)}\n`)
    expect(result.map((item) => item.metric?.seq ?? null)).toEqual([1, null, 2])
    expect(result[1]?.warning).toBeTruthy()
  })
})
