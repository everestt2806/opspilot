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
})
