import type Database from 'better-sqlite3'

import { logger } from '../logger'
import { completeByteLength, parseMetricContent } from './metricParser'
import type { MetricSource } from './metricSource'
import { MonitorRepository } from './repository'
import { AlertTracker } from './alertTracker'
import { evaluateRule } from './rules'
import type { MetricLine } from './metricParser'
import type { MlIngestResponse } from './mlApi'

export interface MetricScorer {
  ingest(deploymentId: number, sample: MetricLine): Promise<MlIngestResponse>
}

export class MonitorPoller {
  constructor(
    private readonly database: Database.Database,
    private readonly repository: MonitorRepository = new MonitorRepository(database),
    private readonly tracker: AlertTracker = new AlertTracker(database),
    private readonly scorer?: MetricScorer
  ) {}

  async poll(
    appId: number,
    deploymentId: number,
    source: MetricSource,
    onSample?: (sampleId: number) => Promise<void> | void
  ): Promise<{ inserted: number; nextOffset: number }> {
    const target = this.repository.getTarget(deploymentId)
    if (!target || target.app_id !== appId) return { inserted: 0, nextOffset: 1 }
    let offset = target.metrics_offset
    const size = await source.size()
    if (size < offset - 1) {
      offset = 1
      logger.info('monitor', 'File metric nhỏ hơn offset, reset về đầu file', { app_id: appId })
    }
    const content = await source.tail(offset)
    const committedBytes = completeByteLength(content)
    if (committedBytes === 0) return { inserted: 0, nextOffset: offset }
    const completeContent = content.slice(0, content.lastIndexOf('\n') + 1)
    const parsed = parseMetricContent(completeContent).filter(
      (item) => item.metric && !this.repository.hasSample(deploymentId, item.metric.seq)
    )
    const mlResults = new Map<number, MlIngestResponse>()
    if (this.scorer) {
      for (const item of parsed) {
        if (!item.metric) continue
        try {
          mlResults.set(item.metric.seq, await this.scorer.ingest(deploymentId, item.metric))
        } catch {
          /* fallback NULL is persisted below */
        }
      }
    }
    let inserted = 0
    const commit = this.database.transaction(() => {
      for (const item of parsed) {
        if (item.warning)
          logger.warn('monitor', item.warning, { app_id: appId, consumed_bytes: item.byteLength })
        if (!item.metric) continue
        const id = this.repository.insertSample({
          deploymentId,
          line: item.metric,
          rawJson: item.raw,
          tsLocal: new Date().toISOString()
        })
        if (id !== 0) {
          inserted += 1
          const sample = this.repository.getMetric(id)
          const rule = evaluateRule(sample, target.setting)
          this.repository.insertScore({
            metricSampleId: id,
            deploymentId,
            ts: sample.ts_vps,
            method: 'rule',
            score: rule.violated ? 1 : 0,
            above: rule.violated,
            detail: JSON.stringify({ reasons: rule.reasons })
          })
          this.tracker.update({
            deploymentId,
            metricSampleId: id,
            ts: sample.ts_vps,
            method: 'rule',
            score: rule.violated ? 1 : 0,
            above: rule.violated,
            threshold: 0,
            consecutive: target.setting.rule_consecutive,
            detail: JSON.stringify({ reasons: rule.reasons })
          })
          for (const method of ['zscore_ewma', 'iforest', 'ocsvm', 'ensemble'] as const)
            this.repository.insertScore({
              metricSampleId: id,
              deploymentId,
              ts: sample.ts_vps,
              method,
              score: mlResults.get(item.metric.seq)?.scores[method] ?? null,
              above: mlResults.get(item.metric.seq)?.above_threshold[method] ?? false,
              detail: JSON.stringify(mlResults.get(item.metric.seq)?.detail?.[method] ?? null)
            })
          for (const method of ['zscore_ewma', 'iforest', 'ocsvm', 'ensemble'] as const) {
            const result = mlResults.get(item.metric.seq)
            const score = result?.scores[method] ?? null
            this.tracker.update({
              deploymentId,
              metricSampleId: id,
              ts: sample.ts_vps,
              method,
              score,
              above: result?.above_threshold[method] ?? false,
              threshold: target.setting.ml_score_threshold,
              consecutive: target.setting.ml_consecutive
            })
          }
          onSample?.(id)
        }
      }
      this.repository.updateOffset(appId, offset + committedBytes)
    })
    commit()
    return { inserted, nextOffset: offset + committedBytes }
  }
}
