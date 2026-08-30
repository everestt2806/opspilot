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
      const content = `${raw(150)}\n`
      let statusCalls = 0
      let trainCalls = 0
      const scorer = {
        status: async () => {
          statusCalls += 1
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
        readFileTail: async () => ({ content, nextOffset: 1 })
      } as never
      const events: unknown[] = []
      await new MonitorService(db).pollAll(ssh, scorer, (event) => events.push(event))
      expect(db.prepare('SELECT COUNT(*) n FROM metric_sample').get()).toEqual({ n: 150 })
      expect((events[0] as { samples: unknown[]; scores: unknown[] }).samples).toHaveLength(1)
      expect((events[0] as { samples: unknown[]; scores: unknown[] }).scores).toHaveLength(1)
      expect(trainCalls).toBe(1)
      expect(statusCalls).toBe(1)
      await new MonitorService(db).pollAll(ssh, scorer)
      expect(trainCalls).toBe(1)
      expect(statusCalls).toBe(2)
    } finally {
      closeDatabase()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
