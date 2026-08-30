import type { MetricSample, MonitorSetting } from '@shared/ipc'

export function evaluateRule(
  sample: MetricSample,
  setting: MonitorSetting
): { violated: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (sample.cpu_pct !== null && sample.cpu_pct > setting.rule_cpu_pct) reasons.push('cpu_pct')
  if (sample.mem_pct !== null && sample.mem_pct > setting.rule_mem_pct) reasons.push('mem_pct')
  if (sample.latency_ms !== null && sample.latency_ms > setting.rule_latency_ms)
    reasons.push('latency_ms')
  if (sample.http_error_rate !== null && sample.http_error_rate > setting.rule_error_rate)
    reasons.push('http_error_rate')
  if (sample.container_up === 0) reasons.push('container_up')
  return { violated: reasons.length > 0, reasons }
}
