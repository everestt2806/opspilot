import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import migration001 from '../db/migrations/001_init.sql?raw'
import migration002 from '../db/migrations/002_metric_activation.sql?raw'
import migration003 from '../db/migrations/003_migration_error_message.sql?raw'
import migration004 from '../db/migrations/004_publish_doctor_domain.sql?raw'
import migration005 from '../db/migrations/005_experiment_run_attempt.sql?raw'
import migration006 from '../db/migrations/006_vps_host_fingerprint.sql?raw'
import migration008 from '../db/migrations/008_vps_archive.sql?raw'
import { HeadlessPoller, type SshManagerLike } from './headlessPoller'
import type { MonitorRuntime } from './poller'

function createMemoryDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(migration001)
  db.exec(migration002)
  db.exec(migration003)
  db.exec(migration004)
  db.exec(migration005)
  db.exec(migration006)
  db.exec(migration008)
  return db
}

function seedDb(db: Database.Database): void {
  db.exec(`
    INSERT INTO vps (id, name, host, username, auth_type, encrypted_secret)
    VALUES (1, 'vps-test', '127.0.0.1', 'root', 'password', 'enc_secret');

    INSERT INTO app (id, vps_id, name, framework, host_port, container_port, current_deployment_id, metrics_stream_generation)
    VALUES (1, 1, 'test-app', 'express', 3000, 3000, 1, '1:1');

    INSERT INTO deployment (id, app_id, version, image_tag, status)
    VALUES (1, 1, 1, 'test-app:v1', 'running');

    INSERT INTO monitor_setting (app_id, rule_cpu_pct, rule_consecutive, ml_score_threshold, ml_consecutive)
    VALUES (1, 80, 2, 0.5, 2);

    INSERT INTO deployment_activation (app_id, deployment_id, state, stream_generation, start_offset, reason)
    VALUES (1, 1, 'active', '1:1', 1, 'deploy');
  `)
}

function makeMetric(seq: number, cpuPct: number, tsIso?: string): string {
  const ts = tsIso ?? `2026-08-30T00:00:${String(seq).padStart(2, '0')}Z`
  return JSON.stringify({
    seq,
    ts,
    cpu_pct: cpuPct,
    mem_mb: 128,
    mem_pct: 25.0,
    mem_limit_mb: 512,
    latency_ms: 15.0,
    http_error_rate: 0.0,
    db_response_ms: null,
    container_up: 1,
    host_cpu_pct: null,
    host_mem_pct: null,
    collector_version: '1.0.0'
  })
}

function createMockSshSource(initialContent = ''): {
  ssh: SshManagerLike
  append: (content: string) => void
  getContent: () => string
} {
  let content = initialContent
  return {
    append(more: string) {
      content += more
    },
    getContent() {
      return content
    },
    ssh: {
      exec: async (_vps: number, command: string) => ({
        code: 0,
        stdout: command.includes('collector') ? 'running\n' : 'test-app:v1|running\n',
        stderr: ''
      }),
      metricSnapshot: async () => ({
        generation: '1:1',
        device: 1,
        inode: 1,
        size: Buffer.byteLength(content, 'utf8')
      }),
      fileIdentity: async () => ({ generation: '1:1', device: 1, inode: 1 }),
      fileSize: async () => Buffer.byteLength(content, 'utf8'),
      readFileTail: async (_vpsId: number, _remotePath: string, fromByte: number) => {
        const slice = content.slice(Math.max(0, fromByte - 1))
        return {
          content: slice,
          nextOffset: fromByte + Buffer.byteLength(slice, 'utf8')
        }
      }
    }
  }
}

describe('HeadlessPoller (TypeScript / SQLite RAM)', () => {
  it('nạp metric, chấm điểm score và gắn đúng alert.experiment_run_id trên SQLite RAM', async () => {
    const db = createMemoryDb()
    seedDb(db)

    // Tạo experiment_run đang chạy
    db.prepare(
      `
      INSERT INTO experiment_run (id, scenario, repeat_index, attempt_index, deployment_id, baseline_start_ts, status)
      VALUES (42, 'cpu_spike', 1, 1, 1, '2026-08-30T00:00:00Z', 'running')
    `
    ).run()

    // Metric 1 & 2: vượt ngưỡng CPU 80% (consecutive = 2) -> sẽ kích hoạt Alert
    const lines = `${makeMetric(1, 90)}\n${makeMetric(2, 95)}\n`
    const { ssh } = createMockSshSource(lines)

    const mockScorer: MonitorRuntime = {
      ingest: vi.fn().mockResolvedValue({
        ready: true,
        sample_count: 2,
        scores: { zscore_ewma: 0.1, iforest: 0.2, ocsvm: 0.3, ensemble: 0.25 },
        above_threshold: { zscore_ewma: false, iforest: false, ocsvm: false, ensemble: false }
      }),
      status: vi.fn().mockResolvedValue({
        deployment_id: 1,
        trained: true,
        sample_count: 2,
        min_samples_required: 1
      }),
      train: vi.fn().mockResolvedValue({
        deployment_id: 1,
        trained: true,
        train_sample_count: 2,
        feature_vector_count: 2
      })
    }

    const poller = new HeadlessPoller({
      db,
      ssh,
      scorer: mockScorer,
      intervalMs: 1000,
      autoCloseDb: false
    })

    // Poll lần đầu
    await poller.pollOnce()

    // 1. Kiểm tra metric_sample đã được chèn
    const samples = db
      .prepare(
        'SELECT id, deployment_id, seq, cpu_pct FROM metric_sample WHERE deployment_id=1 ORDER BY seq'
      )
      .all() as Array<{ id: number; deployment_id: number; seq: number; cpu_pct: number }>
    expect(samples.length).toBe(2)
    expect(samples[0].seq).toBe(1)
    expect(samples[1].seq).toBe(2)

    // 2. Kiểm tra score_sample được tính toán (cả rule và ML)
    const scores = db
      .prepare('SELECT method, score, above_threshold FROM score_sample WHERE metric_sample_id=?')
      .all(samples[1].id) as Array<{
      method: string
      score: number | null
      above_threshold: number
    }>
    expect(scores.length).toBe(5) // rule, zscore_ewma, iforest, ocsvm, ensemble
    const ruleScore = scores.find((s) => s.method === 'rule')
    expect(ruleScore?.score).toBe(1)
    expect(ruleScore?.above_threshold).toBe(1)

    // 3. Kiểm tra alert được kích hoạt và gán đúng experiment_run_id = 42
    const alerts = db
      .prepare(
        'SELECT id, deployment_id, experiment_run_id, method FROM alert WHERE deployment_id=1'
      )
      .all() as Array<{
      id: number
      deployment_id: number
      experiment_run_id: number | null
      method: string
    }>
    expect(alerts.length).toBeGreaterThan(0)
    expect(alerts[0].experiment_run_id).toBe(42)

    // 4. Kiểm tra auto-train bị tắt: mockScorer.train KHÔNG bao giờ được gọi
    expect(mockScorer.train).not.toHaveBeenCalled()

    await poller.drain()
    db.close()
  })

  it('vận hành chu trình drain: dừng ticker, chờ in-flight, poll vét một lần và đóng DB', async () => {
    const db = createMemoryDb()
    seedDb(db)

    const initialContent = `${makeMetric(1, 10)}\n`
    const source = createMockSshSource(initialContent)

    const poller = new HeadlessPoller({
      db,
      ssh: source.ssh,
      intervalMs: 500,
      autoCloseDb: false
    })

    await poller.start()
    expect(poller.active).toBe(true)

    // Kiểm tra đã nạp metric 1
    const count1 = (
      db.prepare('SELECT COUNT(*) n FROM metric_sample WHERE deployment_id=1').get() as {
        n: number
      }
    ).n
    expect(count1).toBe(1)

    // Thêm metric 2 trong lúc poller đang chạy
    source.append(`${makeMetric(2, 15)}\n`)

    // Kích hoạt drain
    const drainResult = await poller.drain()
    expect(drainResult).toEqual({ status: 'drained' })
    expect(poller.active).toBe(false)
    expect(poller.closed).toBe(true)

    // Kiểm tra lượt poll vét cuối cùng đã nạp thành công metric 2
    const count2 = (
      db.prepare('SELECT COUNT(*) n FROM metric_sample WHERE deployment_id=1').get() as {
        n: number
      }
    ).n
    expect(count2).toBe(2)

    // Drain lần 2 an toàn (idempotent)
    const secondDrain = await poller.drain()
    expect(secondDrain).toEqual({ status: 'drained' })

    db.close()
  })

  it('đóng DB tự động khi autoCloseDb=true trong drain', async () => {
    const db = createMemoryDb()
    seedDb(db)

    const { ssh } = createMockSshSource(`${makeMetric(1, 10)}\n`)
    const poller = new HeadlessPoller({
      db,
      ssh,
      intervalMs: 1000,
      autoCloseDb: true
    })

    await poller.start()
    await poller.drain()

    expect(poller.closed).toBe(true)
    // Sau khi drain với autoCloseDb=true, DB đã đóng -> truy vấn sẽ ném lỗi
    expect(() => db.prepare('SELECT 1').get()).toThrow()
  })

  it('chế độ strict ném lỗi khi đọc metric thất bại lúc khởi động (không phát ready)', async () => {
    const db = createMemoryDb()
    seedDb(db)

    const failingSsh: SshManagerLike = {
      exec: async () => ({ code: 0, stdout: 'running\n', stderr: '' }),
      metricSnapshot: async () => ({ generation: '1:1', device: 1, inode: 1, size: 100 }),
      fileIdentity: async () => ({ generation: '1:1', device: 1, inode: 1 }),
      fileSize: async () => 100,
      readFileTail: async () => {
        throw new Error('Mất kết nối SSH khi đọc tail')
      }
    }

    const pollerStrict = new HeadlessPoller({
      db,
      ssh: failingSsh,
      strict: true,
      autoCloseDb: false
    })

    await expect(pollerStrict.start()).rejects.toThrow('Không đọc được metrics.jsonl')
    expect(pollerStrict.active).toBe(false)
    expect(pollerStrict.closed).toBe(false)

    // Đối chiếu: nếu strict=false thì nuốt lỗi MetricSourceError và vẫn chạy
    const pollerNonStrict = new HeadlessPoller({
      db,
      ssh: failingSsh,
      strict: false,
      autoCloseDb: false
    })
    await pollerNonStrict.start()
    expect(pollerNonStrict.active).toBe(true)
    await pollerNonStrict.drain()

    db.close()
  })

  it('chế độ strict ném lỗi khi poll vét cuối cùng thất bại trong drain (không báo drained giả)', async () => {
    const db = createMemoryDb()
    seedDb(db)

    let shouldFail = false
    const sshSource = {
      ssh: {
        exec: async () => ({ code: 0, stdout: 'running\n', stderr: '' }),
        metricSnapshot: async () => ({ generation: '1:1', device: 1, inode: 1, size: 100 }),
        fileIdentity: async () => ({ generation: '1:1', device: 1, inode: 1 }),
        fileSize: async () => 100,
        readFileTail: async () => {
          if (shouldFail) {
            throw new Error('Lỗi SSH trong poll vét cuối')
          }
          return { content: `${makeMetric(1, 10)}\n`, nextOffset: 100 }
        }
      } as SshManagerLike
    }

    const poller = new HeadlessPoller({
      db,
      ssh: sshSource.ssh,
      strict: true,
      autoCloseDb: true
    })

    await poller.start()
    expect(poller.active).toBe(true)

    // Kích hoạt lỗi trước khi drain
    shouldFail = true

    await expect(poller.drain()).rejects.toThrow('Không đọc được metrics.jsonl')
    // Không được đánh dấu closed/drained thành công
    expect(poller.closed).toBe(false)
    // DB không bị đóng nếu poll vét thất bại
    expect(() => db.prepare('SELECT 1').get()).not.toThrow()

    db.close()
  })
})
