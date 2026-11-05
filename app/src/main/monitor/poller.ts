import type Database from 'better-sqlite3'

import { logger } from '../logger'
import { completeByteLength, parseMetricContent } from './metricParser'
import type { MetricSource } from './metricSource'
import { MonitorRepository } from './repository'
import { AlertTracker, isSampleInRunWindow } from './alertTracker'
import { evaluateRule } from './rules'
import { ActivationRepository } from './activation'
import { withAppLock } from './appLock'
import type { MetricLine } from './metricParser'
import type { MlIngestResponse, MlStatusResponse, MlTrainResponse } from './mlApi'

export interface MetricScorer {
  ingest(deploymentId: number, sample: MetricLine): Promise<MlIngestResponse>
}

export interface MonitorRuntime extends MetricScorer {
  status(deploymentId: number): Promise<MlStatusResponse>
  train(deploymentId: number, samples: MetricLine[]): Promise<MlTrainResponse>
}

function ensembleAbove(result: MlIngestResponse | undefined, threshold: number): boolean {
  if (!result) return false
  return (
    (['zscore_ewma', 'iforest', 'ocsvm'] as const).filter(
      (method) => result.scores[method] !== null && result.scores[method]! > threshold
    ).length >= 2
  )
}

export interface MlStatusReporter {
  report(status: { running: boolean; reason?: string }): void
}
export class MetricSourceError extends Error {}

export class MonitorPoller {
  constructor(
    private readonly database: Database.Database,
    private readonly repository: MonitorRepository = new MonitorRepository(database),
    private readonly tracker: AlertTracker = new AlertTracker(database),
    private readonly scorer?: MetricScorer,
    private readonly mlStatus?: MlStatusReporter
  ) {}

  async poll(
    appId: number,
    deploymentId: number,
    source: MetricSource,
    onSample?: (sampleId: number) => Promise<void> | void
  ): Promise<{ inserted: number; nextOffset: number; sampleIds: number[]; alertIds: number[] }> {
    const result = await withAppLock(appId, () =>
      this.pollUnlocked(appId, deploymentId, source, onSample)
    )
    return {
      inserted: result.inserted,
      nextOffset: result.nextOffset,
      sampleIds: result.sampleIds,
      alertIds: result.alertIds
    }
  }

  private async pollUnlocked(
    appId: number,
    deploymentId: number,
    source: MetricSource,
    onSample?: (sampleId: number) => Promise<void> | void
  ): Promise<{
    inserted: number
    nextOffset: number
    sampleIds: number[]
    alertIds: number[]
    hadWarnings: boolean
    warningRanges: Array<{ start: number; end: number }>
  }> {
    const target = this.repository.getTarget(deploymentId)
    if (!target || target.app_id !== appId)
      return {
        inserted: 0,
        nextOffset: 1,
        sampleIds: [],
        alertIds: [],
        hadWarnings: false,
        warningRanges: []
      }
    const activationRepository = new ActivationRepository(this.database)
    const activationEpoch = (): string =>
      JSON.stringify(
        this.database
          .prepare(
            `SELECT a.current_deployment_id,a.metrics_stream_generation,
       (SELECT COALESCE(MAX(id),0) FROM deployment_activation WHERE app_id=a.id) AS latest_activation,
       (SELECT id FROM deployment_activation WHERE app_id=a.id AND state='active') AS active_activation
       FROM app a WHERE a.id=?`
          )
          .get(appId)
      )
    let expectedActivationEpoch = activationEpoch()
    const assertActivationUnchanged = (): void => {
      if (
        activationRepository.prepared(appId) ||
        activationEpoch() !== expectedActivationEpoch ||
        !this.repository.getTarget(deploymentId)
      ) {
        throw new MetricSourceError(
          'Activation metrics đã thay đổi trong khi đọc; monitor đã fail-closed.'
        )
      }
    }
    const mutateActivation = (change: () => void): void => {
      this.database
        .transaction(() => {
          assertActivationUnchanged()
          change()
          expectedActivationEpoch = activationEpoch()
        })
        .immediate()
    }
    if (activationRepository.prepared(target.app_id)) {
      activationRepository.logFailClosed(target.app_id)
      throw new MetricSourceError('Activation metrics chưa hoàn tất; monitor đã fail-closed.')
    }
    const identity = (await source.identity?.()) ?? { generation: 'legacy' }
    assertActivationUnchanged()
    let offset = target.metrics_offset
    const storedGeneration = (
      this.database
        .prepare('SELECT metrics_stream_generation FROM app WHERE id=?')
        .get(target.app_id) as { metrics_stream_generation: string } | undefined
    )?.metrics_stream_generation
    const activeBeforeIdentity = activationRepository.active(target.app_id)
    if (
      activeBeforeIdentity?.generation === 'pending-first-generation' &&
      activeBeforeIdentity.startOffset === 1 &&
      offset === 1
    ) {
      mutateActivation(() => activationRepository.adoptFirstGeneration(target.app_id, identity))
    } else if (activeBeforeIdentity && storedGeneration !== identity.generation) {
      let recovered = false
      let oldEndOffset = offset
      let gapEndOffset = offset
      let warningRanges: Array<{ start: number; end: number }> = []
      let drainFailure = false
      try {
        const rotated = await source.rotated?.()
        assertActivationUnchanged()
        const rotatedIdentity = await rotated?.identity?.()
        assertActivationUnchanged()
        if (rotated && rotatedIdentity?.generation === storedGeneration) {
          drainFailure = true
          const rotatedSize = await rotated.size()
          assertActivationUnchanged()
          gapEndOffset = rotatedSize + 1
          if (offset >= rotatedSize + 1) {
            oldEndOffset = offset
            recovered = true
          } else {
            const drained = await this.pollUnlocked(appId, deploymentId, rotated, onSample)
            assertActivationUnchanged()
            oldEndOffset = drained.nextOffset
            warningRanges = drained.warningRanges
            recovered = drained.nextOffset >= rotatedSize + 1 && !drained.hadWarnings
          }
          drainFailure = false
        }
      } catch (error) {
        if (drainFailure) throw error
        recovered = false
      }
      mutateActivation(() =>
        activationRepository.rotate(
          target.app_id,
          deploymentId,
          identity,
          oldEndOffset,
          recovered,
          gapEndOffset,
          warningRanges
        )
      )
      offset = 1
    }
    mutateActivation(() =>
      activationRepository.ensureLegacy(target.app_id, deploymentId, offset, identity)
    )
    let size: number
    try {
      size = await source.size()
      assertActivationUnchanged()
    } catch (error) {
      throw new MetricSourceError('Không đọc được kích thước metrics.jsonl', { cause: error })
    }
    if (size < offset - 1) {
      offset = 1
      logger.info('monitor', 'File metric nhỏ hơn offset, reset về đầu file', { app_id: appId })
      this.repository.logAction(
        'ssh_error',
        'failed',
        'Metric file đã xoay vòng, reset offset',
        appId,
        deploymentId
      )
    }
    let content: string
    try {
      content = await source.tail(offset)
      assertActivationUnchanged()
    } catch (error) {
      throw new MetricSourceError('Không đọc được metrics.jsonl', { cause: error })
    }
    const committedBytes = completeByteLength(content)
    if (committedBytes === 0)
      return {
        inserted: 0,
        nextOffset: offset,
        sampleIds: [],
        alertIds: [],
        hadWarnings: false,
        warningRanges: []
      }
    const completeContent = content.slice(0, content.lastIndexOf('\n') + 1)
    const parsed = parseMetricContent(completeContent)
    const warningRanges = parsed
      .filter((item) => Boolean(item.warning))
      .map((item) => ({ start: offset + item.byteStart, end: offset + item.byteEnd }))
    const hadWarnings = warningRanges.length > 0
    for (const item of parsed)
      if (item.warning) {
        logger.warn('monitor', item.warning, {
          app_id: appId,
          byte_range: [offset + item.byteStart, offset + item.byteEnd]
        })
        this.repository.logAction(
          'ssh_error',
          'failed',
          'Dòng metric hỏng đã được tiêu thụ',
          appId,
          deploymentId
        )
      }
    const episodes = activationRepository.episodes(target.app_id, identity.generation)
    let itemOffset = offset
    const routedItems = parsed.map((item) => {
      const startOffset = itemOffset
      itemOffset += item.byteLength
      return { item, routeDeploymentId: activationRepository.route(episodes, startOffset) }
    })
    const newItems = routedItems.filter(
      ({ item, routeDeploymentId }) =>
        item.metric &&
        routeDeploymentId !== null &&
        !this.repository.hasSample(routeDeploymentId, item.metric.seq)
    )
    const mlResults = new Map<number, MlIngestResponse>()
    let ingestFailed = false
    if (this.scorer) {
      for (const { item, routeDeploymentId } of newItems) {
        if (!item.metric || routeDeploymentId === null) continue
        try {
          mlResults.set(item.metric.seq, await this.scorer.ingest(routeDeploymentId, item.metric))
        } catch {
          ingestFailed = true
          this.mlStatus?.report({ running: false, reason: 'ML ingest không phản hồi' })
          /* fallback NULL is persisted below */
        }
      }
      if (newItems.length && !ingestFailed) this.mlStatus?.report({ running: true })
    }
    assertActivationUnchanged()
    let inserted = 0
    const sampleIds: number[] = []
    const alertIds: number[] = []
    const commit = this.database.transaction(() => {
      // C0 có thể xuất hiện trong lúc await nguồn/ML; kiểm lại trong cùng writer transaction.
      assertActivationUnchanged()
      for (const { item, routeDeploymentId } of newItems) {
        if (!item.metric || routeDeploymentId === null) continue
        const id = this.repository.insertSample({
          deploymentId: routeDeploymentId,
          line: item.metric,
          rawJson: item.raw,
          tsLocal: new Date().toISOString()
        })
        if (id !== 0) {
          inserted += 1
          const sample = this.repository.getMetric(id)
          const experimentRunId = this.getMatchingExperimentRunId(routeDeploymentId, sample.ts_vps)
          const rule = evaluateRule(sample, target.setting)
          this.repository.insertScore({
            metricSampleId: id,
            deploymentId: routeDeploymentId,
            ts: sample.ts_vps,
            method: 'rule',
            score: rule.violated ? 1 : 0,
            above: rule.violated,
            detail: JSON.stringify({ reasons: rule.reasons })
          })
          const ruleAlertId = this.tracker.update({
            deploymentId: routeDeploymentId,
            metricSampleId: id,
            ts: sample.ts_vps,
            method: 'rule',
            score: rule.violated ? 1 : 0,
            above: rule.violated,
            threshold: 0,
            consecutive: target.setting.rule_consecutive,
            detail: JSON.stringify({ reasons: rule.reasons }),
            experimentRunId
          })
          if (ruleAlertId) alertIds.push(ruleAlertId)
          for (const method of ['zscore_ewma', 'iforest', 'ocsvm', 'ensemble'] as const)
            this.repository.insertScore({
              metricSampleId: id,
              deploymentId: routeDeploymentId,
              ts: sample.ts_vps,
              method,
              score: mlResults.get(item.metric.seq)?.scores[method] ?? null,
              above:
                method === 'ensemble'
                  ? ensembleAbove(mlResults.get(item.metric.seq), target.setting.ml_score_threshold)
                  : (mlResults.get(item.metric.seq)?.scores[method] ?? null) !== null &&
                    (mlResults.get(item.metric.seq)?.scores[method] ?? 0) >
                      target.setting.ml_score_threshold,
              detail: JSON.stringify(mlResults.get(item.metric.seq)?.detail?.[method] ?? null)
            })
          for (const method of ['zscore_ewma', 'iforest', 'ocsvm', 'ensemble'] as const) {
            const result = mlResults.get(item.metric.seq)
            const score = result?.scores[method] ?? null
            const mlAlertId = this.tracker.update({
              deploymentId: routeDeploymentId,
              metricSampleId: id,
              ts: sample.ts_vps,
              method,
              score,
              above:
                method === 'ensemble'
                  ? ensembleAbove(result, target.setting.ml_score_threshold)
                  : score !== null && score > target.setting.ml_score_threshold,
              threshold: target.setting.ml_score_threshold,
              consecutive: target.setting.ml_consecutive,
              experimentRunId
            })
            if (mlAlertId) alertIds.push(mlAlertId)
          }
          sampleIds.push(id)
        }
      }
      this.repository.updateOffset(appId, offset + committedBytes)
    }).immediate
    commit()
    for (const sampleId of sampleIds) await onSample?.(sampleId)
    return {
      inserted,
      nextOffset: offset + committedBytes,
      sampleIds,
      alertIds,
      hadWarnings,
      warningRanges
    }
  }

  private getMatchingExperimentRunId(deploymentId: number, tsVps: string): number | null {
    const run = this.database
      .prepare(
        `SELECT id, baseline_start_ts, run_end_ts
         FROM experiment_run
         WHERE status = 'running'
           AND deployment_id = ?
         ORDER BY id DESC
         LIMIT 1`
      )
      .get(deploymentId) as
      { id: number; baseline_start_ts: string | null; run_end_ts: string | null } | undefined
    if (!run) return null

    if (!isSampleInRunWindow(tsVps, run.baseline_start_ts, run.run_end_ts)) {
      return null
    }
    return run.id
  }
}
