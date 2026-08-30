import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MonitorService } from './service'
import { closeDatabase, initializeDatabase } from '../db'

describe('MonitorService mutations', () => {
  it('whitelist setting và label null/non-null', () => {
    const db = new Database(':memory:')
    db.exec(
      "CREATE TABLE monitor_setting (app_id INTEGER PRIMARY KEY, collector_interval_s INTEGER DEFAULT 10, poll_interval_s INTEGER DEFAULT 30, rule_cpu_pct REAL DEFAULT 90, rule_mem_pct REAL DEFAULT 90, rule_latency_ms REAL DEFAULT 2000, rule_error_rate REAL DEFAULT .5, rule_consecutive INTEGER DEFAULT 3, ml_score_threshold REAL DEFAULT .7, ml_consecutive INTEGER DEFAULT 2, auto_rollback INTEGER DEFAULT 0, trusted_method TEXT DEFAULT 'ensemble', rollback_consecutive INTEGER DEFAULT 3, cooldown_minutes INTEGER DEFAULT 10, updated_at TEXT); CREATE TABLE action_log (id INTEGER PRIMARY KEY, action TEXT, status TEXT, message TEXT, app_id INTEGER); CREATE TABLE alert (id INTEGER PRIMARY KEY, label TEXT, labeled_at TEXT)"
    )
    db.prepare('INSERT INTO monitor_setting (app_id) VALUES (1)').run()
    const service = new MonitorService(db)
    expect(service.setSetting(1, { rule_cpu_pct: 80 }).rule_cpu_pct).toBe(80)
    expect(service.setSetting(1, {}).rule_cpu_pct).toBe(80)
    expect(() => service.setSetting(1, { auto_rollback: 2 } as never)).toThrow()
    expect(() => service.setSetting(1, { rule_mem_pct: 101 } as never)).toThrow()
    expect(() => service.setSetting(1, { app_id: 2 } as never)).toThrow()
    db.prepare('INSERT INTO alert (id) VALUES (1)').run()
    service.labelAlert(1, 'true_positive')
    service.labelAlert(1, null)
    expect(db.prepare('SELECT id FROM alert WHERE id=99').get()).toBeUndefined()
    expect(() => service.labelAlert(99, 'true_positive')).toThrow()
    expect(
      (db.prepare('SELECT label FROM alert WHERE id=1').get() as { label: string | null }).label
    ).toBeNull()
  })

  it('pollAll trains from SQLite after ingesting sample 150', async () => {
    const dir = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-auto-train-'))
    const db = initializeDatabase(dir)
    try {
      db.exec(
        "INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('v','127.0.0.1','u','password','x'); INSERT INTO app (vps_id,name,framework,host_port,container_port) VALUES (1,'app','express',30000,3000); INSERT INTO deployment (app_id,version,image_tag,status) VALUES (1,1,'app:v1','running'); UPDATE app SET current_deployment_id=1 WHERE id=1;"
      )
      const raw = (seq: number): string =>
        JSON.stringify({
          seq,
          ts: `2026-08-30T00:00:${String(seq % 60).padStart(2, '0')}Z`,
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
      for (let i = 1; i <= 149; i += 1) {
        const value = raw(i)
        const parsed = JSON.parse(value)
        db.prepare(
          'INSERT INTO metric_sample (deployment_id,seq,ts_vps,ts_local,raw_json) VALUES (?,?,?,?,?)'
        ).run(1, i, parsed.ts, parsed.ts, value)
      }
      let content = `${raw(150)}\n`
      let statusCalls = 0
      let trainCalls = 0
      let statusDown = false
      const scorer = {
        status: async () => {
          statusCalls += 1
          if (statusDown) throw new Error('status unavailable')
          return {
            deployment_id: 1,
            trained: trainCalls > 0,
            sample_count: 0,
            min_samples_required: 150
          }
        },
        train: async (_id: number, samples: unknown[]) => {
          trainCalls += 1
          expect(samples).toHaveLength(150)
          return {
            deployment_id: 1,
            trained: true,
            train_sample_count: 150,
            feature_vector_count: 150
          }
        },
        ingest: async () => ({
          ready: false,
          sample_count: 0,
          scores: { zscore_ewma: null, iforest: null, ocsvm: null, ensemble: null },
          above_threshold: { zscore_ewma: false, iforest: false, ocsvm: false, ensemble: false },
          detail: {}
        })
      }
      const ssh = {
        fileSize: async () => Buffer.byteLength(content),
        readFileTail: async (_id: number, _path: string, offset: number) => ({
          content: content.slice(offset - 1),
          nextOffset: Buffer.byteLength(content) + 1
        })
      } as never
      const events: unknown[] = []
      const mlEvents: Array<{ running: boolean; reason?: string }> = []
      const service = new MonitorService(db)
      await service.pollAll(
        ssh,
        scorer,
        (event) => events.push(event),
        (status) => mlEvents.push(status)
      )
      expect(db.prepare('SELECT COUNT(*) n FROM metric_sample').get()).toEqual({ n: 150 })
      expect((events[0] as { samples: unknown[]; scores: unknown[] }).samples).toHaveLength(1)
      expect((events[0] as { samples: unknown[]; scores: unknown[] }).scores).toHaveLength(1)
      expect(trainCalls).toBe(1)
      expect(statusCalls).toBe(1)
      expect(mlEvents).toEqual([{ running: true }])
      expect(
        (
          db
            .prepare("SELECT COUNT(*) n FROM action_log WHERE action='ml_service_restart'")
            .get() as { n: number }
        ).n
      ).toBe(0)
      const backfill = JSON.parse(raw(152))
      backfill.ts = '2026-08-29T23:59:59Z'
      content += `${raw(151)}\n${JSON.stringify(backfill)}\n`
      await service.pollAll(
        ssh,
        scorer,
        (event) => events.push(event),
        (status) => mlEvents.push(status)
      )
      expect(
        (events[1] as { samples: Array<{ seq: number }>; scores: Array<{ ts_vps: string }> })
          .samples
      ).toEqual([expect.objectContaining({ seq: 151 }), expect.objectContaining({ seq: 152 })])
      expect(
        (events[1] as { samples: Array<{ seq: number }>; scores: Array<{ ts_vps: string }> }).scores
      ).toEqual([
        expect.objectContaining({ ts_vps: '2026-08-30T00:00:31Z' }),
        expect.objectContaining({ ts_vps: '2026-08-29T23:59:59Z' })
      ])
      const eventCount = events.length
      await service.pollAll(
        ssh,
        scorer,
        (event) => events.push(event),
        (status) => mlEvents.push(status)
      )
      expect(events).toHaveLength(eventCount)
      expect(trainCalls).toBe(1)
      statusDown = true
      await service.pollAll(
        ssh,
        scorer,
        (event) => events.push(event),
        (status) => mlEvents.push(status)
      )
      statusDown = false
      await service.pollAll(
        ssh,
        scorer,
        (event) => events.push(event),
        (status) => mlEvents.push(status)
      )
      expect(trainCalls).toBe(1)
      expect(statusCalls).toBe(5)
      expect(mlEvents).toEqual([
        { running: true },
        { running: false, reason: 'ML status/train không khả dụng' },
        { running: true }
      ])
      expect(
        (
          db
            .prepare("SELECT COUNT(*) n FROM action_log WHERE action='ml_service_restart'")
            .get() as { n: number }
        ).n
      ).toBe(1)
    } finally {
      closeDatabase()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('recovers ML status when auto-train is disabled without training', async () => {
    const dir = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-auto-train-disabled-'))
    const db = initializeDatabase(dir)
    try {
      db.exec(
        "INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('v','127.0.0.1','u','password','x'); INSERT INTO app (vps_id,name,framework,host_port,container_port) VALUES (1,'app','express',30000,3000); INSERT INTO deployment (app_id,version,image_tag,status) VALUES (1,1,'app:v1','running'); UPDATE app SET current_deployment_id=1 WHERE id=1;"
      )
      const raw = (seq: number): string =>
        JSON.stringify({
          seq,
          ts: `2026-08-30T00:00:0${seq}Z`,
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
      let content = `${raw(1)}\n`
      let fail = true
      let trainCalls = 0
      const scorer = {
        status: async () => ({
          deployment_id: 1,
          trained: false,
          sample_count: 1,
          min_samples_required: 150
        }),
        train: async () => {
          trainCalls += 1
          throw new Error('train must be disabled')
        },
        ingest: async () => {
          if (fail) {
            fail = false
            throw new Error('ingest unavailable')
          }
          return {
            ready: false,
            sample_count: 0,
            scores: { zscore_ewma: null, iforest: null, ocsvm: null, ensemble: null },
            above_threshold: { zscore_ewma: false, iforest: false, ocsvm: false, ensemble: false },
            detail: {}
          }
        }
      }
      const ssh = {
        fileSize: async () => Buffer.byteLength(content),
        readFileTail: async (_id: number, _path: string, offset: number) => ({
          content: content.slice(offset - 1),
          nextOffset: Buffer.byteLength(content) + 1
        })
      } as never
      const statuses: Array<{ running: boolean; reason?: string }> = []
      const service = new MonitorService(db, { autoTrain: false })
      await service.pollAll(ssh, scorer, undefined, (status) => statuses.push(status))
      content += `${raw(2)}\n`
      await service.pollAll(ssh, scorer, undefined, (status) => statuses.push(status))
      expect(statuses).toEqual([
        { running: false, reason: 'ML ingest không phản hồi' },
        { running: true }
      ])
      expect(trainCalls).toBe(0)
      expect(
        (
          db
            .prepare("SELECT COUNT(*) n FROM action_log WHERE action='ml_service_restart'")
            .get() as { n: number }
        ).n
      ).toBe(1)
    } finally {
      closeDatabase()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('validates trainNow at 149 samples and trains exactly at 150', async () => {
    const dir = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-train-now-'))
    const db = initializeDatabase(dir)
    try {
      db.exec(
        "INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('v','127.0.0.1','u','password','x'); INSERT INTO app (vps_id,name,framework,host_port,container_port) VALUES (1,'app','express',30000,3000); INSERT INTO deployment (app_id,version,image_tag,status) VALUES (1,1,'app:v1','running');"
      )
      const raw = (seq: number): string =>
        JSON.stringify({
          seq,
          ts: `2026-08-30T00:${String(Math.floor(seq / 60)).padStart(2, '0')}:${String(seq % 60).padStart(2, '0')}Z`,
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
      const insert = db.prepare(
        'INSERT INTO metric_sample (deployment_id,seq,ts_vps,ts_local,raw_json) VALUES (?,?,?,?,?)'
      )
      for (let seq = 1; seq <= 149; seq += 1) {
        const value = raw(seq)
        insert.run(1, seq, JSON.parse(value).ts, JSON.parse(value).ts, value)
      }
      const service = new MonitorService(db)
      const client = {
        train: async (deploymentId: number, samples: unknown[]) => {
          expect(deploymentId).toBe(1)
          expect(samples).toHaveLength(150)
          return {
            deployment_id: 1,
            trained: true,
            train_sample_count: 150,
            feature_vector_count: 150
          }
        }
      } as never
      await expect(service.trainNow(1, client)).rejects.toMatchObject({ code: 'VALIDATION' })
      expect(db.prepare('SELECT COUNT(*) n FROM metric_sample').get()).toEqual({ n: 149 })
      const value = raw(150)
      insert.run(1, 150, JSON.parse(value).ts, JSON.parse(value).ts, value)
      await expect(service.trainNow(1, client)).resolves.toEqual({ train_sample_count: 150 })
    } finally {
      closeDatabase()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('polls two applications sequentially and emits only their exact batches', async () => {
    const dir = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-two-apps-'))
    const db = initializeDatabase(dir)
    try {
      db.exec(
        "INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('v','127.0.0.1','u','password','x'); INSERT INTO app (vps_id,name,framework,host_port,container_port) VALUES (1,'app-one','express',30000,3000); INSERT INTO app (vps_id,name,framework,host_port,container_port) VALUES (1,'app-two','express',30001,3000); INSERT INTO deployment (app_id,version,image_tag,status) VALUES (1,1,'one:v1','running'); INSERT INTO deployment (app_id,version,image_tag,status) VALUES (2,1,'two:v1','running'); UPDATE app SET current_deployment_id=id WHERE id IN (1,2);"
      )
      const raw = (seq: number): string =>
        JSON.stringify({
          seq,
          ts: `2026-08-30T00:00:0${seq}Z`,
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
      const files = {
        'app-one': `${raw(1)}\n`,
        'app-two': `${raw(2)}\n`
      }
      const ingestOrder: number[] = []
      const scorer = {
        ingest: async (deploymentId: number) => {
          ingestOrder.push(deploymentId)
          return {
            ready: false,
            sample_count: 0,
            scores: { zscore_ewma: null, iforest: null, ocsvm: null, ensemble: null },
            above_threshold: { zscore_ewma: false, iforest: false, ocsvm: false, ensemble: false },
            detail: {}
          }
        },
        status: async () => ({
          deployment_id: 1,
          trained: true,
          sample_count: 0,
          min_samples_required: 150
        }),
        train: async () => ({
          deployment_id: 1,
          trained: true,
          train_sample_count: 0,
          feature_vector_count: 0
        })
      }
      const pathContent = (path: string): string =>
        path.includes('app-one') ? files['app-one'] : files['app-two']
      const ssh = {
        fileSize: async (_vpsId: number, path: string) => Buffer.byteLength(pathContent(path)),
        readFileTail: async (_vpsId: number, path: string, offset: number) => ({
          content: pathContent(path).slice(offset - 1),
          nextOffset: Buffer.byteLength(pathContent(path)) + 1
        })
      } as never
      const events: Array<{ deployment_id: number; samples: Array<{ seq: number }> }> = []
      const service = new MonitorService(db, { autoTrain: false })
      await service.pollAll(ssh, scorer, (event) => events.push(event), undefined)
      expect(ingestOrder).toEqual([1, 2])
      expect(events.map((event) => event.deployment_id)).toEqual([1, 2])
      expect(events.map((event) => event.samples.map((sample) => sample.seq))).toEqual([[1], [2]])
    } finally {
      closeDatabase()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
