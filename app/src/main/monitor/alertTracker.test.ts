import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { AlertTracker } from './alertTracker'

describe('AlertTracker', () => {
  it('mở một alert, cập nhật peak và resolve sau ba mẫu thấp', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE score_sample (id INTEGER PRIMARY KEY, deployment_id INTEGER, method TEXT, above_threshold INTEGER, metric_sample_id INTEGER, score REAL, ts_vps TEXT); CREATE TABLE alert (id INTEGER PRIMARY KEY, deployment_id INTEGER, metric_sample_id INTEGER, method TEXT, ts_vps TEXT, ts_resolved TEXT, peak_score REAL, detail_json TEXT)')
    const tracker = new AlertTracker(db)
    for (let i = 1; i <= 3; i += 1) { db.prepare('INSERT INTO score_sample VALUES (?,?,?,?,?,?,?)').run(i, 1, 'rule', 1, i, i / 10, `2026-01-01T00:00:0${i}Z`); tracker.update({ deploymentId: 1, metricSampleId: i, ts: `2026-01-01T00:00:0${i}Z`, method: 'rule', score: i / 10, above: true, threshold: 0, consecutive: 3 }) }
    expect(db.prepare('SELECT COUNT(*) n FROM alert').get()).toEqual({ n: 1 })
    for (let i = 4; i <= 6; i += 1) { db.prepare('INSERT INTO score_sample VALUES (?,?,?,?,?,?,?)').run(i, 1, 'rule', 0, i, 0, `2026-01-01T00:00:0${i}Z`); tracker.update({ deploymentId: 1, metricSampleId: i, ts: `2026-01-01T00:00:0${i}Z`, method: 'rule', score: 0, above: false, threshold: 0, consecutive: 3 }) }
    expect((db.prepare('SELECT ts_resolved FROM alert').get() as { ts_resolved: string | null }).ts_resolved).not.toBeNull()
  })
})
