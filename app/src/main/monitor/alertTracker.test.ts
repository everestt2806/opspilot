import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { AlertTracker } from './alertTracker'

describe('AlertTracker', () => {
  it('mở một alert, cập nhật peak và resolve sau ba mẫu thấp', () => {
    const db = new Database(':memory:')
    db.exec(
      'CREATE TABLE score_sample (id INTEGER PRIMARY KEY, deployment_id INTEGER, method TEXT, above_threshold INTEGER, metric_sample_id INTEGER, score REAL, ts_vps TEXT); CREATE TABLE alert (id INTEGER PRIMARY KEY, deployment_id INTEGER, metric_sample_id INTEGER, method TEXT, ts_vps TEXT, ts_resolved TEXT, peak_score REAL, detail_json TEXT); CREATE TABLE action_log (id INTEGER PRIMARY KEY, action TEXT, status TEXT, message TEXT, deployment_id INTEGER)'
    )
    const tracker = new AlertTracker(db)
    for (let i = 1; i <= 3; i += 1) {
      db.prepare('INSERT INTO score_sample VALUES (?,?,?,?,?,?,?)').run(
        i,
        1,
        'rule',
        1,
        i,
        i / 10,
        `2026-01-01T00:00:0${i}Z`
      )
      tracker.update({
        deploymentId: 1,
        metricSampleId: i,
        ts: `2026-01-01T00:00:0${i}Z`,
        method: 'rule',
        score: i / 10,
        above: true,
        threshold: 0,
        consecutive: 3
      })
    }
    expect(db.prepare('SELECT COUNT(*) n FROM alert').get()).toEqual({ n: 1 })
    for (let i = 4; i <= 6; i += 1) {
      db.prepare('INSERT INTO score_sample VALUES (?,?,?,?,?,?,?)').run(
        i,
        1,
        'rule',
        0,
        i,
        0,
        `2026-01-01T00:00:0${i}Z`
      )
      tracker.update({
        deploymentId: 1,
        metricSampleId: i,
        ts: `2026-01-01T00:00:0${i}Z`,
        method: 'rule',
        score: 0,
        above: false,
        threshold: 0,
        consecutive: 3
      })
    }
    expect(
      (db.prepare('SELECT ts_resolved FROM alert').get() as { ts_resolved: string | null })
        .ts_resolved
    ).not.toBeNull()
  })

  it('khôi phục chuỗi high/low sau restart và theo dõi độc lập năm method', () => {
    const db = new Database(':memory:')
    db.exec(
      'CREATE TABLE score_sample (id INTEGER PRIMARY KEY, deployment_id INTEGER, method TEXT, above_threshold INTEGER, metric_sample_id INTEGER, score REAL, ts_vps TEXT); CREATE TABLE alert (id INTEGER PRIMARY KEY, deployment_id INTEGER, metric_sample_id INTEGER, method TEXT, ts_vps TEXT, ts_resolved TEXT, peak_score REAL, detail_json TEXT); CREATE TABLE action_log (id INTEGER PRIMARY KEY, action TEXT, status TEXT, message TEXT, deployment_id INTEGER)'
    )
    const methods = ['rule', 'zscore_ewma', 'iforest', 'ocsvm', 'ensemble'] as const
    let id = 1
    for (const method of methods) {
      for (let step = 0; step < 3; step += 1) {
        const ts = `2026-01-01T00:00:0${id}Z`
        db.prepare('INSERT INTO score_sample VALUES (?,?,?,?,?,?,?)').run(
          id,
          1,
          method,
          1,
          id,
          0.8 + step / 10,
          ts
        )
        new AlertTracker(db).update({
          deploymentId: 1,
          metricSampleId: id,
          ts,
          method,
          score: 0.8 + step / 10,
          above: true,
          threshold: 0.7,
          consecutive: 3
        })
        id += 1
      }
    }
    expect((db.prepare('SELECT COUNT(*) n FROM alert').get() as { n: number }).n).toBe(5)
    const beforeRestart = db.prepare('SELECT id FROM alert WHERE method=?').get('rule') as {
      id: number
    }
    for (let step = 0; step < 3; step += 1) {
      const ts = `2026-01-01T00:01:0${step}Z`
      db.prepare('INSERT INTO score_sample VALUES (?,?,?,?,?,?,?)').run(id, 1, 'rule', 0, id, 0, ts)
      new AlertTracker(db).update({
        deploymentId: 1,
        metricSampleId: id,
        ts,
        method: 'rule',
        score: 0,
        above: false,
        threshold: 0.7,
        consecutive: 3
      })
      id += 1
    }
    expect(
      (
        db.prepare('SELECT ts_resolved FROM alert WHERE id=?').get(beforeRestart.id) as {
          ts_resolved: string | null
        }
      ).ts_resolved
    ).not.toBeNull()
  })
})
