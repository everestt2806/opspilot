import { z } from 'zod'

const nullableNumber = z.number().finite().nullable()

export const metricLineSchema = z.object({
  seq: z.number().int().positive(),
  ts: z.string().datetime({ offset: true }),
  cpu_pct: nullableNumber,
  mem_mb: nullableNumber,
  mem_pct: nullableNumber,
  mem_limit_mb: nullableNumber,
  latency_ms: nullableNumber,
  http_error_rate: z.number().min(0).max(1).finite().nullable(),
  db_response_ms: nullableNumber,
  container_up: z.union([z.literal(0), z.literal(1)]),
  host_cpu_pct: nullableNumber,
  host_mem_pct: nullableNumber,
  collector_version: z.string().min(1)
})

export type MetricLine = z.infer<typeof metricLineSchema>

export interface ParsedMetricLine {
  metric: MetricLine | null
  raw: string
  byteLength: number
  warning?: string
}

export function parseMetricContent(content: string): ParsedMetricLine[] {
  const lines = content.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines.map((raw) => {
    const byteLength = Buffer.byteLength(`${raw}\n`, 'utf8')
    try {
      const value: unknown = JSON.parse(raw)
      const metric = metricLineSchema.parse(value)
      return { metric, raw, byteLength }
    } catch {
      return { metric: null, raw, byteLength, warning: 'Dòng metric JSON không hợp lệ' }
    }
  })
}

export function completeByteLength(content: string): number {
  const lastNewline = content.lastIndexOf('\n')
  return lastNewline < 0 ? 0 : Buffer.byteLength(content.slice(0, lastNewline + 1), 'utf8')
}
