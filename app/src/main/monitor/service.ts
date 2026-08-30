import type Database from 'better-sqlite3'
import type { Alert, MetricSample, MonitorSetting, ScoreSet } from '@shared/ipc'
import { MonitorRepository } from './repository'

export class MonitorService {
  private readonly repository: MonitorRepository
  constructor(db: Database.Database) {
    this.repository = new MonitorRepository(db)
  }
  samples(deploymentId: number, fromTs: string): MetricSample[] {
    return this.repository.listSamples(deploymentId, fromTs)
  }
  scores(deploymentId: number, fromTs: string): Array<{ ts_vps: string } & ScoreSet> {
    return this.repository.listScores(deploymentId, fromTs)
  }
  alerts(deploymentId: number, limit: number): Alert[] {
    return this.repository.listAlerts(deploymentId, Math.min(Math.max(limit, 1), 500))
  }
  getSetting(appId: number): MonitorSetting {
    return this.repository.getOrCreateSetting(appId)
  }
}
