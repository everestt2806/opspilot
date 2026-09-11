import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { closeDatabase, initializeDatabase } from '../db'
import { ActivationRepository } from './activation'
import { MonitorPoller } from './poller'
import type { MetricSource } from './metricSource'

const metric = (seq: number): string =>
  JSON.stringify({
    seq,
    ts: `2026-09-11T00:00:${String(seq % 60).padStart(2, '0')}Z`,
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

const source = (content: string, generation = '1:1'): MetricSource => ({
  size: async () => Buffer.byteLength(content),
  tail: async (offset) =>
    Buffer.from(content)
      .subarray(offset - 1)
      .toString('utf8'),
  identity: async () => ({ generation })
})

let directory = ''
afterEach(() => {
  closeDatabase()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

function seed(): ReturnType<typeof initializeDatabase> {
  directory = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-activation-'))
  const db = initializeDatabase(directory)
  db.exec(`
    INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('v','127.0.0.1','u','password','x');
    INSERT INTO app (vps_id,name,framework,host_port,container_port) VALUES (1,'app','express',30000,3000);
    INSERT INTO deployment (app_id,version,image_tag,status) VALUES (1,1,'app:v1','running');
    UPDATE app SET current_deployment_id=1 WHERE id=1;
  `)
  return db
}

function addDeployment(db: ReturnType<typeof initializeDatabase>, version: number): void {
  db.prepare(
    "INSERT INTO deployment (app_id,version,image_tag,status) VALUES (1,?,?, 'running')"
  ).run(version, `app:v${version}`)
  db.prepare('UPDATE app SET current_deployment_id=? WHERE id=1').run(version)
}

describe('C02 activation episodes', () => {
  it('lazily initializes legacy and routes backlog across two forward cutovers', async () => {
    const db = seed()
    const poller = new MonitorPoller(db)
    const activation = new ActivationRepository(db)
    await poller.poll(1, 1, source(`${metric(1)}\n`))

    addDeployment(db, 2)
    const boundary2 = Buffer.byteLength(`${metric(1)}\n`) + 1
    activation.prepare(1, 2, { generation: '1:1' }, boundary2, 'deploy')
    activation.activate(2, activation.active(1)?.id ?? null)
    await poller.poll(1, 2, source(`${metric(1)}\n${metric(2)}\n`))

    addDeployment(db, 3)
    const boundary3 = Buffer.byteLength(`${metric(1)}\n${metric(2)}\n`) + 1
    activation.prepare(1, 3, { generation: '1:1' }, boundary3, 'deploy')
    activation.activate(3, activation.active(1)?.id ?? null)
    await poller.poll(1, 3, source(`${metric(1)}\n${metric(2)}\n${metric(3)}\n`))
    expect(db.prepare('SELECT deployment_id,seq FROM metric_sample ORDER BY seq').all()).toEqual([
      { deployment_id: 1, seq: 1 },
      { deployment_id: 2, seq: 2 },
      { deployment_id: 3, seq: 3 }
    ])
  })

  it('fails closed for prepared activation and supports repeated reactivation', async () => {
    const db = seed()
    const activation = new ActivationRepository(db)
    activation.ensureLegacy(1, 1, 1, { generation: '1:1' })
    db.prepare(
      "INSERT INTO deployment (app_id,version,image_tag,status) VALUES (1,2,'app:v2','running')"
    ).run()
    db.prepare('UPDATE app SET current_deployment_id=2 WHERE id=1').run()
    activation.prepare(1, 2, { generation: '1:1' }, 1, 'deploy')
    await expect(new MonitorPoller(db).poll(1, 2, source(`${metric(1)}\n`))).rejects.toThrow(
      'fail-closed'
    )
    expect(
      db.prepare("SELECT state FROM deployment_activation WHERE state='prepared'").get()
    ).toEqual({
      state: 'prepared'
    })
    activation.abort(2)
    activation.closeActive(1, 20)
    const prepared = activation.prepare(1, 1, { generation: '1:1' }, 20, 'auto_rollback')
    activation.activate(prepared, null)
    expect(
      db.prepare('SELECT COUNT(*) n FROM deployment_activation WHERE deployment_id=1').get()
    ).toEqual({ n: 2 })
  })

  it('rotates when replacement size is smaller or larger than the old cursor', async () => {
    const db = seed()
    const poller = new MonitorPoller(db)
    await poller.poll(1, 1, source(`${metric(1)}\n${metric(2)}\n`, '1:1'))
    await poller.poll(1, 1, source(`${metric(3)}\n`, '1:2'))
    await poller.poll(1, 1, source(`${metric(4)}\n${metric(5)}\n${metric(6)}\n`, '1:3'))
    expect(db.prepare('SELECT seq FROM metric_sample ORDER BY id').all()).toEqual([
      { seq: 1 },
      { seq: 2 },
      { seq: 3 },
      { seq: 4 },
      { seq: 5 },
      { seq: 6 }
    ])
    expect(
      db.prepare("SELECT COUNT(*) n FROM deployment_activation WHERE reason='rotation'").get()
    ).toEqual({ n: 2 })
  })

  it('drains a matching metrics.jsonl.1 suffix before switching generation', async () => {
    const db = seed()
    const poller = new MonitorPoller(db)
    const old = `${metric(1)}\n`
    await poller.poll(1, 1, source(old, 'old'))
    const rotatedContent = `${metric(1)}\n${metric(2)}\n`
    const rotated: MetricSource = {
      size: async () => Buffer.byteLength(rotatedContent),
      tail: async (offset) =>
        Buffer.from(rotatedContent)
          .subarray(offset - 1)
          .toString(),
      identity: async () => ({ generation: 'old' })
    }
    const next: MetricSource = {
      size: async () => Buffer.byteLength(`${metric(3)}\n`),
      tail: async (offset) =>
        Buffer.from(`${metric(3)}\n`)
          .subarray(offset - 1)
          .toString(),
      identity: async () => ({ generation: 'new' }),
      rotated: async () => rotated
    }
    expect(await poller.poll(1, 1, next)).toMatchObject({ inserted: 1 })
    expect(db.prepare('SELECT deployment_id,seq FROM metric_sample ORDER BY seq').all()).toEqual([
      { deployment_id: 1, seq: 1 },
      { deployment_id: 1, seq: 2 },
      { deployment_id: 1, seq: 3 }
    ])
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM action_log WHERE message LIKE '%data-gap%'").get()
    ).toEqual({ count: 0 })
    expect(db.prepare('SELECT metrics_offset FROM app WHERE id=1').get()).toEqual({
      metrics_offset: Buffer.byteLength(`${metric(3)}\n`) + 1
    })
  })

  it.each([
    ['missing', async () => null],
    [
      'mismatched',
      async () => ({
        size: async () => Buffer.byteLength(`${metric(99)}\n`),
        tail: async () => `${metric(99)}\n`,
        identity: async () => ({ generation: 'other' })
      })
    ]
  ])('logs an explicit gap when rotated file is %s', async (_label, rotated) => {
    const db = seed()
    const poller = new MonitorPoller(db)
    await poller.poll(1, 1, source(`${metric(1)}\n`, 'old'))
    const next = source(`${metric(2)}\n`, 'new')
    next.rotated = rotated
    await poller.poll(1, 1, next)
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM action_log WHERE message LIKE '%data-gap%'").get()
    ).toEqual({ count: 1 })
    expect(db.prepare('SELECT seq FROM metric_sample ORDER BY id').all()).toEqual([
      { seq: 1 },
      { seq: 2 }
    ])
  })

  it('adopts the first real generation without opening a false gap', async () => {
    const db = seed()
    const activation = new ActivationRepository(db)
    const prepared = activation.prepare(
      1,
      1,
      { generation: 'pending-first-generation' },
      1,
      'deploy'
    )
    activation.activate(prepared, null)
    db.prepare('UPDATE app SET metrics_stream_generation=? WHERE id=1').run(
      'pending-first-generation'
    )

    await new MonitorPoller(db).poll(1, 1, source(`${metric(1)}\n`, 'device:inode'))

    expect(activation.active(1)?.generation).toBe('device:inode')
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM action_log WHERE message LIKE '%data-gap%'").get()
    ).toEqual({ count: 0 })
    expect(db.prepare('SELECT deployment_id, seq FROM metric_sample').all()).toEqual([
      { deployment_id: 1, seq: 1 }
    ])
    expect(db.prepare('SELECT COUNT(*) AS count FROM score_sample').get()).toEqual({ count: 5 })
  })

  it('closes matching rotation only through committed bytes for a partial tail', async () => {
    const db = seed()
    const poller = new MonitorPoller(db)
    const old = `${metric(1)}\n`
    await poller.poll(1, 1, source(old, 'old'))
    const rotatedContent = `${old}{"seq":`
    const rotated: MetricSource = {
      size: async () => Buffer.byteLength(rotatedContent),
      tail: async (offset) =>
        Buffer.from(rotatedContent)
          .subarray(offset - 1)
          .toString(),
      identity: async () => ({ generation: 'old' })
    }
    const next = source(`${metric(2)}\n`, 'new')
    next.rotated = async () => rotated

    await poller.poll(1, 1, next)

    expect(db.prepare('SELECT seq FROM metric_sample ORDER BY seq').all()).toEqual([
      { seq: 1 },
      { seq: 2 }
    ])
    expect(db.prepare('SELECT metrics_offset FROM app WHERE id=1').get()).toEqual({
      metrics_offset: Buffer.byteLength(`${metric(2)}\n`) + 1
    })
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM action_log WHERE message LIKE '%data-gap%old=old%new=new%'"
        )
        .get()
    ).toEqual({ count: 1 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM score_sample').get()).toEqual({ count: 10 })
  })

  it('treats a fully consumed matching rotated file as lossless', async () => {
    const db = seed()
    const poller = new MonitorPoller(db)
    const old = `${metric(1)}\n`
    await poller.poll(1, 1, source(old, 'old'))
    const rotated: MetricSource = {
      size: async () => Buffer.byteLength(old),
      tail: async () => '',
      identity: async () => ({ generation: 'old' })
    }
    const next = source(`${metric(2)}\n`, 'new')
    next.rotated = async () => rotated

    await poller.poll(1, 1, next)

    expect(
      db.prepare("SELECT COUNT(*) AS count FROM action_log WHERE message LIKE '%data-gap%'").get()
    ).toEqual({ count: 0 })
    expect(db.prepare('SELECT seq FROM metric_sample ORDER BY seq').all()).toEqual([
      { seq: 1 },
      { seq: 2 }
    ])
    expect(db.prepare('SELECT COUNT(*) AS count FROM score_sample').get()).toEqual({ count: 10 })
  })

  it('keeps the old cursor and retries a matching rotated read failure', async () => {
    const db = seed()
    const poller = new MonitorPoller(db)
    const old = `${metric(1)}\n`
    const unread = `${metric(2)}\n`
    await poller.poll(1, 1, source(old, 'old'))
    const cursor = Buffer.byteLength(old) + 1
    let fail = true
    const rotated: MetricSource = {
      size: async () => Buffer.byteLength(old + unread),
      tail: async () => {
        if (fail) throw new Error('rotated tail unavailable')
        return unread
      },
      identity: async () => ({ generation: 'old' })
    }
    const next = source(`${metric(3)}\n`, 'new')
    next.rotated = async () => rotated

    await expect(poller.poll(1, 1, next)).rejects.toThrow('metrics.jsonl')
    expect(db.prepare('SELECT metrics_offset FROM app WHERE id=1').get()).toEqual({
      metrics_offset: cursor
    })
    expect(
      db
        .prepare("SELECT COUNT(*) AS count FROM deployment_activation WHERE reason='rotation'")
        .get()
    ).toEqual({ count: 0 })

    fail = false
    await poller.poll(1, 1, next)
    expect(db.prepare('SELECT seq FROM metric_sample ORDER BY seq').all()).toEqual([
      { seq: 1 },
      { seq: 2 },
      { seq: 3 }
    ])
    expect(db.prepare('SELECT COUNT(*) AS count FROM score_sample').get()).toEqual({ count: 15 })
  })

  it('records a gap for a complete invalid rotated line without routing valid rows incorrectly', async () => {
    const db = seed()
    const poller = new MonitorPoller(db)
    const old = `${metric(1)}\n`
    await poller.poll(1, 1, source(old, 'old'))
    const invalid = `${old}{not-json}\n`
    const rotated: MetricSource = {
      size: async () => Buffer.byteLength(invalid),
      tail: async (offset) =>
        Buffer.from(invalid)
          .subarray(offset - 1)
          .toString(),
      identity: async () => ({ generation: 'old' })
    }
    const next = source(`${metric(2)}\n`, 'new')
    next.rotated = async () => rotated

    await poller.poll(1, 1, next)

    expect(db.prepare('SELECT seq, deployment_id FROM metric_sample ORDER BY seq').all()).toEqual([
      { seq: 1, deployment_id: 1 },
      { seq: 2, deployment_id: 1 }
    ])
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM action_log WHERE message LIKE '%data-gap%'").get()
    ).toEqual({ count: 1 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM score_sample').get()).toEqual({ count: 10 })
  })
})
