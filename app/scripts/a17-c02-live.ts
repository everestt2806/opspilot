import { app } from 'electron'

import { createCredentialCipher } from '../src/main/crypto/masterKey'
import { loadSecret } from '../src/main/crypto/credentials'
import { closeDatabase, initializeDatabase } from '../src/main/db'
import { VpsRepository } from '../src/main/db/vpsRepository'
import { MonitorPoller } from '../src/main/monitor/poller'
import { MonitorScheduler } from '../src/main/monitor/scheduler'
import { MonitorService } from '../src/main/monitor/service'
import { SshMetricSource, type MetricSource } from '../src/main/monitor/metricSource'
import { SshManager } from '../src/main/ssh/manager'

const VPS_ID = 2
const APP_ID = 1
const DEPLOYMENT_ID = 12
const APP_NAME = 'a17-notes-0911'
const METRICS_PATH = `/opt/opspilot/${APP_NAME}/metrics/metrics.jsonl`

type Counts = { metrics: number; scores: number; offset: number; deploymentRows: number }
type SchedulerTick = { start: string; end: string; insertedMetrics: number; offset: number }

function counts(database: ReturnType<typeof initializeDatabase>): Counts {
  const appRow = database.prepare('SELECT metrics_offset FROM app WHERE id=?').get(APP_ID) as {
    metrics_offset: number
  }
  const metrics = database.prepare('SELECT COUNT(*) n FROM metric_sample').get() as { n: number }
  const scores = database.prepare('SELECT COUNT(*) n FROM score_sample').get() as { n: number }
  const deploymentRows = database
    .prepare('SELECT COUNT(*) n FROM metric_sample WHERE deployment_id=?')
    .get(DEPLOYMENT_ID) as { n: number }
  return {
    metrics: metrics.n,
    scores: scores.n,
    offset: appRow.metrics_offset,
    deploymentRows: deploymentRows.n
  }
}

async function run(): Promise<void> {
  app.setName('OpsPilot')
  await app.whenReady()
  const userDataPath = app.getPath('userData')
  const database = initializeDatabase(userDataPath)
  const cipher = createCredentialCipher(userDataPath)
  const vpsRepository = new VpsRepository(database)
  const ssh = new SshManager((vpsId) => {
    const vps = vpsRepository.getById(vpsId)
    return {
      host: vps.host,
      port: vps.port,
      username: vps.username,
      authType: vps.auth_type,
      secret: loadSecret(database, cipher, vpsId)
    }
  })

  try {
    const target = database
      .prepare(
        'SELECT id, name, current_deployment_id FROM app WHERE id=? AND name=? AND current_deployment_id=?'
      )
      .get(APP_ID, APP_NAME, DEPLOYMENT_ID) as
      { id: number; name: string; current_deployment_id: number } | undefined
    if (!target) throw new Error('C02 target boundary mismatch')

    const before = counts(database)
    const source = new SshMetricSource(ssh, VPS_ID, METRICS_PATH)
    const poller = new MonitorPoller(database)
    const sourceIdentity = await source.identity?.()
    const first = await poller.poll(APP_ID, DEPLOYMENT_ID, source)
    const afterFirst = counts(database)
    const frozen: MetricSource = {
      size: async () => afterFirst.offset - 1,
      tail: async () => '',
      identity: async () => sourceIdentity ?? { generation: 'legacy' }
    }
    const retry = await poller.poll(APP_ID, DEPLOYMENT_ID, frozen)
    const afterRetry = counts(database)

    await ssh.disconnect(VPS_ID)
    const reconnect = await poller.poll(APP_ID, DEPLOYMENT_ID, source)
    const afterReconnect = counts(database)

    let concurrent = 0
    let maxConcurrent = 0
    const schedulerTicks: SchedulerTick[] = []
    const service = new MonitorService(database, { autoTrain: false })
    const scheduler = new MonitorScheduler(async () => {
      const start = new Date().toISOString()
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      const beforeTick = counts(database)
      try {
        await service.pollAll(ssh)
      } finally {
        const afterTick = counts(database)
        schedulerTicks.push({
          start,
          end: new Date().toISOString(),
          insertedMetrics: afterTick.metrics - beforeTick.metrics,
          offset: afterTick.offset
        })
        concurrent -= 1
      }
    })
    scheduler.start()
    await scheduler.tick()
    await new Promise((resolve) => setTimeout(resolve, 31_000))
    await scheduler.stop()
    if (scheduler.active || concurrent !== 0 || maxConcurrent > 1 || schedulerTicks.length < 2) {
      throw new Error('C02 scheduler live gate failed')
    }

    const newMetrics = afterFirst.metrics - before.metrics
    const newScores = afterFirst.scores - before.scores
    const deploymentCounts = database
      .prepare(
        'SELECT deployment_id, COUNT(*) n FROM metric_sample GROUP BY deployment_id ORDER BY deployment_id'
      )
      .all() as Array<{ deployment_id: number; n: number }>
    const duplicateRows = database
      .prepare(
        'SELECT COUNT(*) n FROM (SELECT deployment_id, seq, COUNT(*) c FROM metric_sample GROUP BY deployment_id, seq HAVING c > 1)'
      )
      .get() as { n: number }

    if (newScores !== newMetrics * 5) throw new Error('C02 score cardinality invariant failed')
    if (afterRetry.metrics !== afterFirst.metrics || afterRetry.offset !== afterFirst.offset) {
      throw new Error('C02 retry changed SQLite state')
    }
    if (afterReconnect.metrics < afterRetry.metrics)
      throw new Error('C02 reconnect regressed counts')
    if (duplicateRows.n !== 0) throw new Error('C02 duplicate deployment/seq rows found')

    console.log(
      JSON.stringify({
        target,
        before,
        first,
        after_first: afterFirst,
        retry,
        after_retry: afterRetry,
        reconnect,
        after_reconnect: afterReconnect,
        new_metrics: newMetrics,
        new_scores: newScores,
        score_rows_per_new_metric: newMetrics ? newScores / newMetrics : null,
        duplicate_rows: duplicateRows.n,
        deployment_counts: deploymentCounts,
        scheduler: {
          ticks: schedulerTicks,
          max_concurrent: maxConcurrent,
          active_after_stop: scheduler.active
        }
      })
    )
  } finally {
    await ssh.disconnectAll()
    closeDatabase()
    app.quit()
  }
}

run().catch((error) => {
  console.error(`C02_LIVE_FAIL ${error instanceof Error ? error.message : String(error)}`)
  app.exit(1)
})
