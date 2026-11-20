/* eslint-disable @typescript-eslint/explicit-function-return-type -- Unit tests for auto-rollback. */
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { closeDatabase, initializeDatabase } from '../db'
import { DeployService } from '../deploy/service'
import {
  countConsecutiveTriggeredScores,
  isDesktopAutoRollbackAllowed,
  shouldAutoRollback
} from './auto-rollback'
import { MonitorService } from './service'

function baseSetting() {
  return {
    app_id: 1,
    collector_interval_s: 10,
    poll_interval_s: 30,
    rule_cpu_pct: 90,
    rule_mem_pct: 90,
    rule_latency_ms: 2000,
    rule_error_rate: 0.5,
    rule_consecutive: 3,
    ml_score_threshold: 0.7,
    ml_consecutive: 2,
    auto_rollback: 1 as const,
    trusted_method: 'ensemble' as const,
    rollback_consecutive: 3,
    cooldown_minutes: 10
  }
}

function metricJsonLines(lines: Array<{ seq: number; ts: string; memMb?: number }>): string {
  return (
    lines
      .map((line) =>
        JSON.stringify({
          collector_version: '0.1.0',
          seq: line.seq,
          ts: line.ts,
          app: 'demo',
          cpu_pct: 12,
          mem_mb: line.memMb ?? 120,
          mem_pct: 25,
          mem_limit_mb: 512,
          latency_ms: 35,
          http_error_rate: 0,
          db_response_ms: null,
          container_up: 1,
          host_cpu_pct: 15,
          host_mem_pct: 40
        })
      )
      .join('\n') + '\n'
  )
}

function createFixture(options?: {
  versions?: Array<{ version: number; status?: string }>
  autoRollback?: 0 | 1
  productMode?: boolean
}) {
  const dir = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-autorollback-'))
  const db = initializeDatabase(dir)
  db.exec(
    "INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('v1','203.0.113.10','root','password','enc');"
  )
  db.exec(
    "INSERT INTO app (vps_id,name,framework,host_port,container_port) VALUES (1,'demo','express',30000,3000);"
  )
  const versions = options?.versions ?? [
    { version: 1, status: 'running' },
    { version: 2, status: 'running' }
  ]
  let currentId = 1
  for (const v of versions) {
    const res = db
      .prepare('INSERT INTO deployment (app_id,version,image_tag,status) VALUES (1,?,?,?)')
      .run(v.version, `demo:v${v.version}`, v.status ?? 'running')
    currentId = Number(res.lastInsertRowid)
  }
  db.prepare('UPDATE app SET current_deployment_id=? WHERE id=1').run(currentId)
  db.prepare(
    "INSERT INTO monitor_setting (app_id, auto_rollback, trusted_method, rollback_consecutive, cooldown_minutes) VALUES (1, ?, 'ensemble', 3, 10)"
  ).run(options?.autoRollback ?? 1)
  if (options?.productMode) {
    db.exec(`
      INSERT INTO product_controller VALUES ('ctrl-1', '2026-11-20T00:00:00Z', 'active');
      INSERT INTO product_source_config VALUES (1,1,'https://example.test/r.git','main','.','{}','${'a'.repeat(64)}','2026-11-20T00:00:00Z');
      INSERT INTO product_app_control (app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at)
        VALUES (1,'product','ctrl-1',2,1,'${'a'.repeat(64)}','2026-11-20T00:00:00Z');
    `)
  }
  return { dir, db, currentId }
}

function makeSshWithLines(content: string) {
  let offset = 1
  return {
    metricSnapshot: async () => ({
      generation: '1:1',
      device: 1,
      inode: 1,
      size: Buffer.byteLength(content)
    }),
    fileIdentity: async () => ({ generation: '1:1', device: 1, inode: 1 }),
    fileSize: async () => Buffer.byteLength(content),
    readFileTail: async (_vps: number, _path: string, fromByte: number) => {
      if (fromByte > Buffer.byteLength(content)) return { content: '', nextOffset: fromByte }
      const slice = content.slice(fromByte - 1)
      offset = Buffer.byteLength(content) + 1
      return { content: slice, nextOffset: offset }
    }
  } as never
}

function highMlScorer(score = 0.92, deploymentId = 2) {
  return {
    status: async () => ({
      deployment_id: deploymentId,
      trained: true,
      sample_count: 180,
      min_samples_required: 150
    }),
    train: async () => ({
      deployment_id: deploymentId,
      trained: true,
      train_sample_count: 180,
      feature_vector_count: 161
    }),
    ingest: async () => ({
      ready: true,
      sample_count: 181,
      scores: { zscore_ewma: score, iforest: score, ocsvm: score, ensemble: score },
      above_threshold: {
        zscore_ewma: score > 0.7,
        iforest: score > 0.7,
        ocsvm: score > 0.7,
        ensemble: score > 0.7
      }
    })
  }
}

describe('shouldAutoRollback pure policy', () => {
  it('enforces enable flag, consecutive count, and cooldown window', () => {
    expect(
      shouldAutoRollback({
        setting: { ...baseSetting(), auto_rollback: 0 },
        consecutiveTriggered: 3,
        lastRollbackAt: null,
        now: '2026-11-20T12:00:00Z'
      })
    ).toEqual({ rollback: false, reason: 'disabled' })

    expect(
      shouldAutoRollback({
        setting: baseSetting(),
        consecutiveTriggered: 2,
        lastRollbackAt: null,
        now: '2026-11-20T12:00:00Z'
      })
    ).toEqual({ rollback: false, reason: 'not_enough' })

    expect(
      shouldAutoRollback({
        setting: baseSetting(),
        consecutiveTriggered: 3,
        lastRollbackAt: '2026-11-20T11:55:00Z',
        now: '2026-11-20T12:00:00Z'
      })
    ).toEqual({ rollback: false, reason: 'cooldown' })

    expect(
      shouldAutoRollback({
        setting: baseSetting(),
        consecutiveTriggered: 3,
        lastRollbackAt: '2026-11-20T11:49:59Z',
        now: '2026-11-20T12:00:00Z'
      })
    ).toEqual({ rollback: true, reason: 'ok' })
  })
})

describe('MonitorService auto-rollback integration (R6 / M08)', () => {
  it('triggers auto-rollback after 3 consecutive trusted alerts, updates cooldown, and emits system:auto-rollback', async () => {
    const fixture = createFixture({ autoRollback: 1 })
    try {
      const content = metricJsonLines([
        { seq: 1, ts: '2026-11-20T12:00:00Z', memMb: 350 },
        { seq: 2, ts: '2026-11-20T12:00:10Z', memMb: 390 },
        { seq: 3, ts: '2026-11-20T12:00:20Z', memMb: 440 }
      ])
      const executor = vi.fn(async () => ({ ok: true, deploymentId: 99 }))
      const events: unknown[] = []
      const service = new MonitorService(fixture.db, {
        autoTrain: false,
        autoRollback: executor
      })
      await service.pollAll(
        makeSshWithLines(content),
        highMlScorer(0.91),
        undefined,
        undefined,
        (evt) => events.push(evt)
      )

      expect(executor).toHaveBeenCalledTimes(1)
      expect(executor).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: 1,
          currentDeploymentId: 2,
          targetDeploymentId: 1,
          fromVersion: 2,
          toVersion: 1,
          method: 'ensemble',
          consecutive: 3
        })
      )
      expect(events).toEqual([
        expect.objectContaining({
          app_id: 1,
          from_version: 2,
          to_version: 1,
          method: 'ensemble'
        })
      ])
      const alertRow = fixture.db
        .prepare("SELECT acted FROM alert WHERE method='ensemble' ORDER BY id DESC LIMIT 1")
        .get() as { acted: string }
      expect(alertRow.acted).toBe('rollback_auto')
      const settingRow = fixture.db
        .prepare('SELECT last_rollback_at FROM monitor_setting WHERE app_id=1')
        .get() as { last_rollback_at: string | null }
      expect(settingRow.last_rollback_at).toBeTruthy()
    } finally {
      closeDatabase()
      rmSync(fixture.dir, { recursive: true, force: true })
    }
  })

  it('suppresses a second fault inside the cooldown window and records rollback_suppressed_cooldown', async () => {
    const fixture = createFixture({ autoRollback: 1 })
    try {
      fixture.db
        .prepare('UPDATE monitor_setting SET last_rollback_at=? WHERE app_id=1')
        .run(new Date().toISOString())
      const content = metricJsonLines([
        { seq: 1, ts: '2026-11-20T12:00:00Z' },
        { seq: 2, ts: '2026-11-20T12:00:10Z' },
        { seq: 3, ts: '2026-11-20T12:00:20Z' }
      ])
      const executor = vi.fn(async () => ({ ok: true, deploymentId: 99 }))
      const service = new MonitorService(fixture.db, {
        autoTrain: false,
        autoRollback: executor
      })
      await service.pollAll(makeSshWithLines(content), highMlScorer(0.95))

      expect(executor).not.toHaveBeenCalled()
      const alertRow = fixture.db
        .prepare("SELECT acted FROM alert WHERE method='ensemble' ORDER BY id DESC LIMIT 1")
        .get() as { acted: string }
      expect(alertRow.acted).toBe('rollback_suppressed_cooldown')
    } finally {
      closeDatabase()
      rmSync(fixture.dir, { recursive: true, force: true })
    }
  })

  it('does not trigger rollback when auto_rollback is disabled, leaving alert open', async () => {
    const fixture = createFixture({ autoRollback: 0 })
    try {
      const content = metricJsonLines([
        { seq: 1, ts: '2026-11-20T12:00:00Z' },
        { seq: 2, ts: '2026-11-20T12:00:10Z' },
        { seq: 3, ts: '2026-11-20T12:00:20Z' }
      ])
      const executor = vi.fn(async () => ({ ok: true, deploymentId: 99 }))
      await new MonitorService(fixture.db, {
        autoTrain: false,
        autoRollback: executor
      }).pollAll(makeSshWithLines(content), highMlScorer(0.95, 1))

      expect(executor).not.toHaveBeenCalled()
      const alertRow = fixture.db
        .prepare("SELECT acted FROM alert WHERE method='ensemble' ORDER BY id DESC LIMIT 1")
        .get() as { acted: string }
      expect(alertRow.acted).toBe('none')
    } finally {
      closeDatabase()
      rmSync(fixture.dir, { recursive: true, force: true })
    }
  })

  it('skips safely and logs reason when app is at v1 with no previous deployment', async () => {
    const fixture = createFixture({
      versions: [{ version: 1, status: 'running' }],
      autoRollback: 1
    })
    try {
      const content = metricJsonLines([
        { seq: 1, ts: '2026-11-20T12:00:00Z' },
        { seq: 2, ts: '2026-11-20T12:00:10Z' },
        { seq: 3, ts: '2026-11-20T12:00:20Z' }
      ])
      const executor = vi.fn(async () => ({ ok: true, deploymentId: 99 }))
      await new MonitorService(fixture.db, {
        autoTrain: false,
        autoRollback: executor
      }).pollAll(makeSshWithLines(content), highMlScorer(0.95, 1))

      expect(executor).not.toHaveBeenCalled()
      const log = fixture.db
        .prepare(
          "SELECT status, message FROM action_log WHERE action='rollback_auto' ORDER BY id DESC LIMIT 1"
        )
        .get() as { status: string; message: string }
      expect(log.status).toBe('failed')
      expect(log.message).toContain('chưa có phiên bản trước đó')
    } finally {
      closeDatabase()
      rmSync(fixture.dir, { recursive: true, force: true })
    }
  })

  it('blocks Desktop auto-rollback for Product-owned apps and never retries failed rollbacks', async () => {
    const prodFixture = createFixture({ autoRollback: 1, productMode: true })
    try {
      expect(isDesktopAutoRollbackAllowed(prodFixture.db, 1)).toBe(false)
      const content = metricJsonLines([
        { seq: 1, ts: '2026-11-20T12:00:00Z' },
        { seq: 2, ts: '2026-11-20T12:00:10Z' },
        { seq: 3, ts: '2026-11-20T12:00:20Z' }
      ])
      const executor = vi.fn(async () => ({ ok: true, deploymentId: 99 }))
      await new MonitorService(prodFixture.db, {
        autoTrain: false,
        autoRollback: executor
      }).pollAll(makeSshWithLines(content), highMlScorer(0.95))
      expect(executor).not.toHaveBeenCalled()
    } finally {
      closeDatabase()
      rmSync(prodFixture.dir, { recursive: true, force: true })
    }

    const failFixture = createFixture({ autoRollback: 1 })
    try {
      const part1 = metricJsonLines([
        { seq: 1, ts: '2026-11-20T12:00:00Z' },
        { seq: 2, ts: '2026-11-20T12:00:10Z' },
        { seq: 3, ts: '2026-11-20T12:00:20Z' }
      ])
      const part2 = part1 + metricJsonLines([{ seq: 4, ts: '2026-11-20T12:00:30Z' }])
      const executor = vi.fn(async () => ({ ok: false, error: 'compose failed' }))
      let currentContent = part1
      const ssh = {
        metricSnapshot: async () => ({
          generation: '1:1',
          device: 1,
          inode: 1,
          size: Buffer.byteLength(currentContent)
        }),
        fileIdentity: async () => ({ generation: '1:1', device: 1, inode: 1 }),
        fileSize: async () => Buffer.byteLength(currentContent),
        readFileTail: async (_vps: number, _path: string, fromByte: number) => ({
          content: currentContent.slice(fromByte - 1),
          nextOffset: Buffer.byteLength(currentContent) + 1
        })
      } as never
      const service = new MonitorService(failFixture.db, {
        autoTrain: false,
        autoRollback: executor
      })
      await service.pollAll(ssh, highMlScorer(0.95))
      currentContent = part2
      await service.pollAll(ssh, highMlScorer(0.95))

      expect(executor).toHaveBeenCalledTimes(1)
      const settingRow = failFixture.db
        .prepare('SELECT last_rollback_at FROM monitor_setting WHERE app_id=1')
        .get() as { last_rollback_at: string | null }
      expect(settingRow.last_rollback_at).toBeNull()
    } finally {
      closeDatabase()
      rmSync(failFixture.dir, { recursive: true, force: true })
    }
  })

  it('breaks consecutive streak when ML scores are missing (null)', () => {
    const fixture = createFixture({ autoRollback: 1 })
    try {
      fixture.db.exec(`
        INSERT INTO metric_sample (id,deployment_id,seq,ts_vps,ts_local,raw_json,container_up) VALUES
          (1,2,1,'2026-11-20T12:00:00Z','2026-11-20T12:00:00Z','{}',1),
          (2,2,2,'2026-11-20T12:00:10Z','2026-11-20T12:00:10Z','{}',1),
          (3,2,3,'2026-11-20T12:00:20Z','2026-11-20T12:00:20Z','{}',1);
        INSERT INTO score_sample (deployment_id,metric_sample_id,ts_vps,method,score,above_threshold) VALUES
          (2,1,'2026-11-20T12:00:00Z','ensemble',0.9,1),
          (2,2,'2026-11-20T12:00:10Z','ensemble',0.9,1),
          (2,3,'2026-11-20T12:00:20Z','ensemble',NULL,0);
      `)
      const streak = countConsecutiveTriggeredScores(fixture.db, 2, 'ensemble', 3)
      expect(streak.count).toBe(0)
    } finally {
      closeDatabase()
      rmSync(fixture.dir, { recursive: true, force: true })
    }
  })
})

describe('DeployService container lifecycle (R8a app:stop / app:start)', () => {
  it('stops and starts Desktop apps via compose and blocks imported or Product-owned apps', async () => {
    const fixture = createFixture({ autoRollback: 0 })
    try {
      const exec = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }))
      const service = new DeployService({
        ssh: { exec } as never,
        db: fixture.db,
        emit: () => {}
      })
      await service.stopApp(1)
      await service.startApp(1)
      expect(exec).toHaveBeenNthCalledWith(
        1,
        1,
        "cd '/opt/opspilot/demo' && docker compose stop app",
        expect.objectContaining({ retryOnReconnect: false })
      )
      expect(exec).toHaveBeenNthCalledWith(
        2,
        1,
        "cd '/opt/opspilot/demo' && docker compose up -d app",
        expect.objectContaining({ retryOnReconnect: false })
      )

      fixture.db.exec(
        `INSERT INTO product_controller VALUES ('c1','2026-11-20T00:00:00Z','active'); INSERT INTO product_source_config VALUES (1,1,'https://example.test/r.git','main','.','{}','${'a'.repeat(64)}','2026-11-20T00:00:00Z'); INSERT INTO product_app_control (app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at) VALUES (1,'product','c1',1,1,'${'a'.repeat(64)}','2026-11-20T00:00:00Z');`
      )
      await expect(service.stopApp(1)).rejects.toMatchObject({
        code: 'VALIDATION',
        userMessage: expect.stringMatching(/Product mode/)
      })
    } finally {
      closeDatabase()
      rmSync(fixture.dir, { recursive: true, force: true })
    }
  })
})
