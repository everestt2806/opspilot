import type Database from 'better-sqlite3'

import { logger } from '../logger'
import { completeByteLength, parseMetricContent } from './metricParser'
import type { MetricSource } from './metricSource'
import { MonitorRepository } from './repository'

export class MonitorPoller {
  constructor(
    private readonly database: Database.Database,
    private readonly repository: MonitorRepository = new MonitorRepository(database)
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
    if (size < offset) {
      offset = 1
      logger.info('monitor', 'File metric nhỏ hơn offset, reset về đầu file', { app_id: appId })
    }
    const content = await source.tail(offset)
    const committedBytes = completeByteLength(content)
    if (committedBytes === 0) return { inserted: 0, nextOffset: offset }
    const completeContent = content.slice(0, content.lastIndexOf('\n') + 1)
    const parsed = parseMetricContent(completeContent)
    let inserted = 0
    const commit = this.database.transaction(() => {
      for (const item of parsed) {
        if (item.warning) logger.warn('monitor', item.warning, { app_id: appId, consumed_bytes: item.byteLength })
        if (!item.metric) continue
        const id = this.repository.insertSample({
          deploymentId,
          line: item.metric,
          rawJson: item.raw,
          tsLocal: new Date().toISOString()
        })
        if (id !== 0) {
          inserted += 1
          void onSample?.(id)
        }
      }
      this.repository.updateOffset(appId, offset + committedBytes)
    })
    commit()
    return { inserted, nextOffset: offset + committedBytes }
  }
}
