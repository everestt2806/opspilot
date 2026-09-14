import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { closeDatabase, initializeDatabase } from '../db'
import type { MetricSource } from './metricSource'
import { MonitorPoller } from './poller'

const metric = (seq: number): string =>
  JSON.stringify({
    seq,
    ts: `2026-08-30T00:00:${String(seq).padStart(2, '0')}Z`,
    cpu_pct: 1,
    mem_mb: 2,
    mem_pct: 3,
    mem_limit_mb: 4,
    latency_ms: null,
    http_error_rate: 0,
    db_response_ms: null,
    container_up: 1,
    host_cpu_pct: null,
    host_mem_pct: null,
    collector_version: '1.0.0'
  })
const source = (content: string): MetricSource => ({
  size: async () => Buffer.byteLength(content),
  tail: async (offset) => content.slice(Buffer.byteLength(content.slice(0, offset - 1), 'utf8'))
})

let dir: string
afterEach(() => {
  closeDatabase()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

function seed(): ReturnType<typeof initializeDatabase> {
  dir = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-monitor-'))
  const db = initializeDatabase(dir)
  db.exec(
    "INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('v','127.0.0.1','u','password','x'); INSERT INTO app (vps_id,name,framework,host_port,container_port) VALUES (1,'app','express',30000,3000); INSERT INTO deployment (app_id,version,image_tag,status) VALUES (1,1,'app:v1','running'); UPDATE app SET current_deployment_id=1 WHERE id=1;"
  )
  return db
}

describe('MonitorPoller ingest', () => {
  it('idempotent duplicate, không tiến offset với partial và reset khi shrink', async () => {
    const db = seed()
    const poller = new MonitorPoller(db)
    const content = `${metric(1)}\n${metric(2)}\n${metric(3)}`
    expect(await poller.poll(1, 1, source(content))).toMatchObject({ inserted: 2 })
    expect(
      (
        db.prepare('SELECT COUNT(*) n FROM score_sample WHERE metric_sample_id=1').get() as {
          n: number
        }
      ).n
    ).toBe(5)
    expect(
      (db.prepare('SELECT metrics_offset FROM app WHERE id=1').get() as { metrics_offset: number })
        .metrics_offset
    ).toBe(Buffer.byteLength(`${metric(1)}\n${metric(2)}\n`) + 1)
    expect(await poller.poll(1, 1, source(`${metric(1)}\n${metric(2)}\n`))).toMatchObject({
      inserted: 0
    })
    expect(await poller.poll(1, 1, source(metric(3) + '\n'))).toMatchObject({ inserted: 1 })
  })

  it('rollback transaction giữ nguyên offset khi insert lỗi', async () => {
    const db = seed()
    const poller = new MonitorPoller(db)
    const original = db.prepare.bind(db)
    let calls = 0
    db.prepare = ((...args: Parameters<typeof original>) => {
      calls += 1
      if (calls > 4) throw new Error('forced')
      return original(...args)
    }) as typeof db.prepare
    await expect(poller.poll(1, 1, source(`${metric(1)}\n`))).rejects.toThrow('forced')
    db.prepare = original as typeof db.prepare
    expect(
      (db.prepare('SELECT metrics_offset FROM app WHERE id=1').get() as { metrics_offset: number })
        .metrics_offset
    ).toBe(1)
  })

  it('EOF bình thường không reset offset và target cũ không được poll', async () => {
    const db = seed()
    const poller = new MonitorPoller(db)
    await poller.poll(1, 1, source(`${metric(1)}\n`))
    const before = (
      db.prepare('SELECT metrics_offset FROM app WHERE id=1').get() as { metrics_offset: number }
    ).metrics_offset
    expect(await poller.poll(1, 1, source(`${metric(1)}\n`))).toMatchObject({
      inserted: 0,
      nextOffset: before
    })
    db.prepare('UPDATE app SET current_deployment_id=NULL').run()
    expect(await poller.poll(1, 1, source(`${metric(2)}\n`))).toEqual({
      inserted: 0,
      nextOffset: 1,
      sampleIds: [],
      alertIds: []
    })
  })

  it('mất SSH giữ offset, reconnect nạp bù và không tạo mẫu giả', async () => {
    const db = seed()
    const poller = new MonitorPoller(db)
    let disconnected = true
    const reconnecting: MetricSource = {
      size: async () => {
        if (disconnected) throw new Error('ssh down')
        return Buffer.byteLength(`${metric(1)}\n${metric(2)}\n`)
      },
      tail: async (offset) => {
        if (disconnected) throw new Error('ssh down')
        const content = `${metric(1)}\n${metric(2)}\n`
        return content.slice(Buffer.byteLength(content.slice(0, offset - 1), 'utf8'))
      }
    }
    await expect(poller.poll(1, 1, reconnecting)).rejects.toThrow()
    expect(
      (db.prepare('SELECT metrics_offset FROM app WHERE id=1').get() as { metrics_offset: number })
        .metrics_offset
    ).toBe(1)
    disconnected = false
    expect(await poller.poll(1, 1, reconnecting)).toMatchObject({ inserted: 2 })
    expect((db.prepare('SELECT COUNT(*) n FROM metric_sample').get() as { n: number }).n).toBe(2)
  })

  it('deployment boundary không nhập lại backlog vào deployment mới', async () => {
    const db = seed()
    const poller = new MonitorPoller(db)
    await poller.poll(1, 1, source(`${metric(1)}\n`))
    db.exec(
      "INSERT INTO deployment (app_id,version,image_tag,status) VALUES (1,2,'app:v2','running'); UPDATE deployment SET status='stopped' WHERE id=1; UPDATE app SET current_deployment_id=2 WHERE id=1;"
    )
    const result = await poller.poll(1, 2, source(`${metric(1)}\n${metric(2)}\n`))
    expect(result.inserted).toBe(1)
    expect(db.prepare('SELECT deployment_id, seq FROM metric_sample ORDER BY id').all()).toEqual([
      { deployment_id: 1, seq: 1 },
      { deployment_id: 2, seq: 2 }
    ])
  })

  it('gọi ML tuần tự, ghi score động và fallback NULL khi service lỗi', async () => {
    const db = seed()
    const order: number[] = []
    const poller = new MonitorPoller(db, undefined, undefined, {
      ingest: async (_deploymentId, sample) => {
        order.push(sample.seq)
        if (sample.seq === 2) throw new Error('timeout')
        return {
          ready: true,
          sample_count: 150,
          scores: { zscore_ewma: 0.8, iforest: 0.1, ocsvm: 0.2, ensemble: 0.1 },
          above_threshold: { zscore_ewma: true, iforest: false, ocsvm: false, ensemble: false },
          detail: {}
        }
      }
    })
    await poller.poll(1, 1, source(`${metric(1)}\n${metric(2)}\n`))
    expect(order).toEqual([1, 2])
    expect(
      db
        .prepare("SELECT score FROM score_sample WHERE metric_sample_id=1 AND method='zscore_ewma'")
        .get()
    ).toEqual({ score: 0.8 })
    expect(
      db
        .prepare("SELECT score FROM score_sample WHERE metric_sample_id=2 AND method='zscore_ewma'")
        .get()
    ).toEqual({ score: null })
  })
})
