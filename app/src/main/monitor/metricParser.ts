import { z } from 'zod'

export const metricLineSchema = z.object({
  seq: z.number().int().positive(),
  ts: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
  cpu_pct: z.number().finite().min(0).nullable(),
  mem_mb: z.number().finite().min(0).nullable(),
  mem_pct: z.number().finite().min(0).max(100).nullable(),
  mem_limit_mb: z.number().finite().min(0).nullable(),
  latency_ms: z.number().finite().min(0).nullable(),
  http_error_rate: z.number().min(0).max(1).finite().nullable(),
  db_response_ms: z.number().finite().min(0).nullable(),
  container_up: z.union([z.literal(0), z.literal(1)]),
  host_cpu_pct: z.number().finite().min(0).max(100).nullable(),
  host_mem_pct: z.number().finite().min(0).max(100).nullable(),
  collector_version: z.string().regex(/^\d+\.\d+\.\d+$/)
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
