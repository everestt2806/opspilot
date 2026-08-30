import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { MonitorService } from './service'

describe('MonitorService mutations', () => {
  it('whitelist setting và label null/non-null', () => {
    const db = new Database(':memory:')
    db.exec(
      "CREATE TABLE monitor_setting (app_id INTEGER PRIMARY KEY, collector_interval_s INTEGER DEFAULT 10, poll_interval_s INTEGER DEFAULT 30, rule_cpu_pct REAL DEFAULT 90, rule_mem_pct REAL DEFAULT 90, rule_latency_ms REAL DEFAULT 2000, rule_error_rate REAL DEFAULT .5, rule_consecutive INTEGER DEFAULT 3, ml_score_threshold REAL DEFAULT .7, ml_consecutive INTEGER DEFAULT 2, auto_rollback INTEGER DEFAULT 0, trusted_method TEXT DEFAULT 'ensemble', rollback_consecutive INTEGER DEFAULT 3, cooldown_minutes INTEGER DEFAULT 10); CREATE TABLE action_log (id INTEGER PRIMARY KEY, action TEXT, status TEXT, message TEXT, app_id INTEGER); CREATE TABLE alert (id INTEGER PRIMARY KEY, label TEXT, labeled_at TEXT)"
    )
    db.prepare('INSERT INTO monitor_setting (app_id) VALUES (1)').run()
    const service = new MonitorService(db)
    expect(service.setSetting(1, { rule_cpu_pct: 80 }).rule_cpu_pct).toBe(80)
    expect(() => service.setSetting(1, { app_id: 2 } as never)).toThrow()
    db.prepare('INSERT INTO alert (id) VALUES (1)').run()
    service.labelAlert(1, 'true_positive')
    service.labelAlert(1, null)
    expect(
      (db.prepare('SELECT label FROM alert WHERE id=1').get() as { label: string | null }).label
    ).toBeNull()
  })
})
