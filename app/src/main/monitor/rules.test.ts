import { describe, expect, it } from 'vitest'
import { evaluateRule } from './rules'

const setting = { rule_cpu_pct: 90, rule_mem_pct: 90, rule_latency_ms: 2000, rule_error_rate: 0.5 } as never
const sample = { cpu_pct: 90, mem_pct: null, latency_ms: 2000, http_error_rate: 0.5, container_up: 1 } as never
describe('evaluateRule', () => {
  it('dùng strict threshold và null không vi phạm', () => expect(evaluateRule(sample, setting)).toEqual({ violated: false, reasons: [] }))
  it('container down luôn vi phạm', () => expect(evaluateRule({ ...sample, container_up: 0 }, setting).reasons).toEqual(['container_up']))
})
