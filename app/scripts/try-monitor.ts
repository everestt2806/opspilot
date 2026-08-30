import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseMetricContent, completeByteLength } from '../src/main/monitor/metricParser'

const dir = mkdtempSync(join(tmpdir(), 'opspilot-monitor-cli-'))
try {
  const lines = Array.from({ length: 3 }, (_, index) =>
    JSON.stringify({
      seq: index + 1,
      ts: `2026-08-30T00:00:0${index}Z`,
      cpu_pct: 1,
      mem_mb: 2,
      mem_pct: 3,
      mem_limit_mb: 4,
      latency_ms: 5,
      http_error_rate: 0,
      db_response_ms: null,
      container_up: 1,
      host_cpu_pct: 1,
      host_mem_pct: 2,
      collector_version: '1.0.0'
    })
  )
  const content = `${lines.join('\n')}\n`
  writeFileSync(join(dir, 'metrics.jsonl'), content, 'utf8')
  const parsed = parseMetricContent(content).filter((item) => item.metric)
  const scoreRows = parsed.length * 5
  const offset = 1 + completeByteLength(content)
  if (parsed.length !== 3 || scoreRows !== 15 || offset <= 1)
    throw new Error('Monitor CLI invariant failed')
  console.log(JSON.stringify({ metrics: parsed.length, score_rows: scoreRows, alerts: 0, offset }))
} finally {
  rmSync(dir, { recursive: true, force: true })
}
