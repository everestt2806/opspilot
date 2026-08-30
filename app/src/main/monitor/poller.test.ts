import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { closeDatabase, initializeDatabase } from '../db'
import type { MetricSource } from './metricSource'
import { MonitorPoller } from './poller'

const metric = (seq: number): string => JSON.stringify({ seq, ts: `2026-08-30T00:00:${String(seq).padStart(2, '0')}Z`, cpu_pct: 1, mem_mb: 2, mem_pct: 3, mem_limit_mb: 4, latency_ms: null, http_error_rate: 0, db_response_ms: null, container_up: 1, host_cpu_pct: null, host_mem_pct: null, collector_version: '1.0.0' })
const source = (content: string): MetricSource => ({ size: async () => Buffer.byteLength(content), tail: async (offset) => content.slice(Buffer.byteLength(content.slice(0, offset - 1), 'utf8')) })

let dir: string
afterEach(() => { closeDatabase(); if (dir) rmSync(dir, { recursive: true, force: true }) })

function seed(): ReturnType<typeof initializeDatabase> {
  dir = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-monitor-'))
  const db = initializeDatabase(dir)
  db.exec("INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('v','127.0.0.1','u','password','x'); INSERT INTO app (vps_id,name,framework,host_port,container_port) VALUES (1,'app','express',30000,3000); INSERT INTO deployment (app_id,version,image_tag,status) VALUES (1,1,'app:v1','running');")
  return db
}

describe('MonitorPoller ingest', () => {
  it('idempotent duplicate, không tiến offset với partial và reset khi shrink', async () => {
    const db = seed(); const poller = new MonitorPoller(db)
    const content = `${metric(1)}\n${metric(2)}\n${metric(3)}`
    expect(await poller.poll(1, 1, source(content))).toMatchObject({ inserted: 2 })
    expect((db.prepare('SELECT COUNT(*) n FROM score_sample WHERE metric_sample_id=1').get() as { n: number }).n).toBe(5)
    expect((db.prepare('SELECT metrics_offset FROM app WHERE id=1').get() as { metrics_offset: number }).metrics_offset).toBe(Buffer.byteLength(`${metric(1)}\n${metric(2)}\n`)+1)
    expect(await poller.poll(1, 1, source(`${metric(1)}\n${metric(2)}\n`))).toMatchObject({ inserted: 0 })
    expect(await poller.poll(1, 1, source(metric(3) + '\n'))).toMatchObject({ inserted: 1 })
  })

  it('rollback transaction giữ nguyên offset khi insert lỗi', async () => {
    const db = seed(); const poller = new MonitorPoller(db)
    const original = db.prepare.bind(db)
    let calls = 0
    db.prepare = ((...args: Parameters<typeof original>) => { calls += 1; if (calls > 4) throw new Error('forced') ; return original(...args) }) as typeof db.prepare
    await expect(poller.poll(1, 1, source(`${metric(1)}\n`))).rejects.toThrow('forced')
    db.prepare = original as typeof db.prepare
    expect((db.prepare('SELECT metrics_offset FROM app WHERE id=1').get() as { metrics_offset: number }).metrics_offset).toBe(1)
  })
})
