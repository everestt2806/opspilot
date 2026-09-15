import { join as posixJoin } from 'node:path/posix'

import type Database from 'better-sqlite3'
import type { App, MigrateEvent, MigrateInput, MigrateJobView, MigrateStep } from '@shared/ipc'

import { AppRepository } from '../db/appRepository'
import { ActionLogRepository } from '../db/actionLogRepository'
import { DeploymentRepository } from '../db/deploymentRepository'
import { VpsRepository } from '../db/vpsRepository'
import { AppError } from '../errors'
import { withAppLock } from '../monitor/appLock'
import { DeployPipeline } from '../deploy/pipeline'
import { allocatePort } from '../deploy/portPolicy'
import { listListeningPorts, runPrecheck } from '../deploy/precheck'
import { parseEnvFile } from '../deploy/templates'
import type { SshManager } from '../ssh/manager'
import { shellQuote } from '../ssh/shellQuote'
import { MigrationRepository, type MigrationJob } from './repository'

const WORK_ROOT = '/opt/opspilot'

/** Map status đang chạy về tên bước để ghi log đúng ngữ cảnh khi lỗi. */
const STATUS_TO_STEP: Record<string, MigrateStep> = {
  preparing: 'PREPARE',
  backing_up: 'BACKUP',
  transferring: 'TRANSFER',
  restoring: 'RESTORE',
  verifying: 'VERIFY',
  awaiting_confirm: 'AWAITING_CONFIRM'
}

type Artifact = { name: string; size: number; sha256: string; target_sha256?: string }
type Verify = {
  checksums: Artifact[]
  source_files: { count: number; bytes: number }
  target_files: { count: number; bytes: number }
  table_counts: Array<{ table: string; source: number; target: number; ok: boolean }>
  health: boolean
  marker: { source: boolean; target: boolean } | null
  ok: boolean
}

export class MigrateService {
  private readonly jobs = new Map<number, AbortController>()
  private readonly migrations: MigrationRepository
  private readonly apps: AppRepository
  private readonly deployments: DeploymentRepository
  private readonly vps: VpsRepository
  private readonly actions: ActionLogRepository
  private readonly terminalizing = new Set<number>()

  constructor(
    private readonly database: Database.Database,
    private readonly ssh: SshManager,
    private readonly emit: (event: MigrateEvent) => void,
    private readonly deployFactory: (emit: (event: never) => void) => DeployPipeline = () =>
      new DeployPipeline({ ssh: this.ssh, db: this.database, emit: () => undefined })
  ) {
    this.migrations = new MigrationRepository(database)
    this.apps = new AppRepository(database)
    this.deployments = new DeploymentRepository(database)
    this.vps = new VpsRepository(database)
    this.actions = new ActionLogRepository(database)
  }

  start(input: MigrateInput): { job_id: number } {
    const source = this.validateInput(input)
    const job = this.migrations.create(source.id, source.vps_id, input.target_vps_id)
    this.actions.insert({
      action: 'migrate_start',
      status: 'success',
      vps_id: source.vps_id,
      app_id: source.id,
      detail_json: JSON.stringify({ job_id: job.id, target_vps_id: input.target_vps_id })
    })
    const controller = new AbortController()
    this.jobs.set(job.id, controller)
    void withAppLock(source.id, () => this.run(job, source, controller.signal)).catch(
      () => undefined
    )
    return { job_id: job.id }
  }

  list(): MigrateJobView[] {
    return this.migrations.list()
  }

  /** Ghi một dòng log migrate: vừa stream sang UI vừa in ra console main process. */
  private log(jobId: number, step: MigrateStep, message: string): void {
    console.log(`[migrate:${jobId}] [${step}] ${message}`)
    this.emit({ type: 'log', job_id: jobId, step, chunk: `${message}\n` })
  }

  async confirm(jobId: number, keepSource: boolean): Promise<void> {
    const job = this.migrations.get(jobId)
    if (job.status !== 'awaiting_confirm') {
      throw new AppError('VALIDATION', 'Chỉ có thể xác nhận lượt migrate đang chờ xác nhận.')
    }
    const target = this.findTargetApp(job)
    if (this.terminalizing.has(jobId)) return
    this.terminalizing.add(jobId)
    try {
      if (keepSource) {
        await this.startSourceAndVerify(job)
      } else {
        const result = await this.ssh.exec(
          job.source_vps_id,
          `cd ${shellQuote(this.appDir(job.app_id))} && docker compose down`,
          { retryOnReconnect: false, timeoutMs: 120_000 }
        )
        if (result.code !== 0) {
          throw new AppError('UNKNOWN', 'Không dọn được app nguồn sau khi xác nhận migrate.', {
            cause: new Error(result.stderr.trim() || result.stdout.trim())
          })
        }
      }
      this.database.transaction(() => {
        this.migrations.update(job.id, { status: 'completed', source_kept: keepSource ? 1 : 0 })
        this.actions.insert({
          action: 'migrate_confirm',
          status: 'success',
          vps_id: job.target_vps_id,
          app_id: job.app_id,
          detail_json: JSON.stringify({
            job_id: job.id,
            target_app_id: target.id,
            source_kept: keepSource
          })
        })
        this.emit({
          type: 'finished',
          job_id: job.id,
          status: 'completed',
          downtime_ms: job.downtime_ms ?? 0
        })
      })()
      await this.cleanupArtifacts(job)
    } finally {
      this.terminalizing.delete(jobId)
    }
  }

  abort(jobId: number): void {
    const job = this.migrations.get(jobId)
    if (job.status === 'completed' || job.status === 'rolled_back') return
    this.jobs.get(jobId)?.abort()
    if (this.terminalizing.has(jobId)) return
    if (job.status === 'awaiting_confirm') {
      this.terminalizing.add(jobId)
      void this.rollbackAwaiting(job).finally(() => this.terminalizing.delete(jobId))
      return
    }
  }

  private async rollbackAwaiting(job: MigrationJob): Promise<void> {
    const target = this.findTargetApp(job)
    this.log(
      job.id,
      'AWAITING_CONFIRM',
      'Người dùng huỷ migrate — dọn app đích và khôi phục nguồn…'
    )
    await this.cleanupTarget(job, target)
    await this.startSourceAndVerify(job)
    if (this.migrations.get(job.id).status === 'rolled_back') return
    this.migrations.update(job.id, {
      status: 'rolled_back',
      source_kept: 1,
      error_message: 'Người dùng huỷ migrate (abort) sau khi verify đạt.'
    })
    this.actions.insert({
      action: 'migrate_abort',
      status: 'cancelled',
      vps_id: job.source_vps_id,
      app_id: job.app_id,
      detail_json: JSON.stringify({ job_id: job.id, target_app_id: target.id })
    })
    this.log(job.id, 'AWAITING_CONFIRM', 'Đã rollback về app nguồn, giữ nguyên dữ liệu nguồn.')
    this.emit({
      type: 'finished',
      job_id: job.id,
      status: 'rolled_back',
      downtime_ms: job.downtime_ms ?? 0
    })
    await this.cleanupArtifacts(job)
  }

  private async startSourceAndVerify(job: MigrationJob): Promise<void> {
    const result = await this.ssh.exec(
      job.source_vps_id,
      `cd ${shellQuote(this.appDir(job.app_id))} && docker compose start app`,
      { retryOnReconnect: false, timeoutMs: 120_000 }
    )
    if (result.code !== 0)
      throw new AppError('UNKNOWN', 'Không khởi động lại được app nguồn.', {
        cause: new Error(result.stderr.trim() || result.stdout.trim())
      })
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const health = await this.ssh.exec(
        job.source_vps_id,
        `curl -fsS -m 5 -o /dev/null ${shellQuote(`http://127.0.0.1:${this.apps.getById(job.app_id).host_port}${this.apps.getById(job.app_id).healthcheck_path}`)}`,
        { retryOnReconnect: true, timeoutMs: 10_000 }
      )
      if (health.code === 0) return
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
    throw new AppError('UNKNOWN', 'App nguồn chưa healthy sau khi khởi động lại.')
  }

  private validateInput(input: MigrateInput): App {
    const source = this.apps.getById(input.app_id)
    if (source.vps_id === input.target_vps_id) {
      throw new AppError('VALIDATION', 'VPS nguồn và đích phải khác nhau.')
    }
    this.vps.getById(input.target_vps_id)
    const current = source.current_deployment_id
      ? this.deployments.getById(source.current_deployment_id)
      : null
    if (!current || current.status !== 'running') {
      throw new AppError('VALIDATION', 'App nguồn phải có deployment running để migrate.')
    }
    const active = this.migrations.activeForApp(source.id)
    if (active) throw new AppError('VALIDATION', 'App đang có lượt migrate khác.')
    return source
  }

  private async run(job: MigrationJob, source: App, signal: AbortSignal): Promise<void> {
    let target: App | null = null
    let sourceProbe: string
    try {
      target = await this.createTargetApp(source, job.target_vps_id, signal)
      sourceProbe = await this.readProbe(job.source_vps_id, source, signal)
    } catch (error) {
      await this.finishFailed(job, source, target, 'PREPARE', 'PREPARE', error)
      return
    }
    if (!target) return
    this.log(
      job.id,
      'PREPARE',
      `Migrate app "${source.name}" từ VPS nguồn (id ${job.source_vps_id}) sang VPS đích (id ${job.target_vps_id}).`
    )
    this.log(
      job.id,
      'PREPARE',
      `App đích "${target.name}" nhận port ${target.host_port} (đã né port đang listen trên VPS đích).`
    )
    this.migrations.update(job.id, {
      verify_json: JSON.stringify({ target_app_id: target.id, source_probe: sourceProbe })
    })
    const sourceDir = this.appDir(source.id)
    const targetDir = this.appDir(target.id)
    let freezeAt = 0
    let lastVerify: Verify | null = null
    try {
      await this.step(job, 'PREPARE', signal, async () => {
        const detail = await runPrecheck(this.ssh, job.target_vps_id, {
          port: target.host_port,
          signal
        })
        for (const check of detail.checks) {
          this.log(
            job.id,
            'PREPARE',
            `${check.ok ? 'PASS' : 'FAIL'} · ${check.label}: ${check.actual} (cần ${check.required})`
          )
        }
        if (!detail.passed) {
          const failed = detail.checks
            .filter((check) => !check.ok)
            .map((check) => `${check.label}: ${check.actual} (cần ${check.required})`)
            .join('; ')
          throw new AppError('PRECHECK_FAILED', `VPS đích không đạt precheck: ${failed}.`, {
            step: 'PREPARE'
          })
        }
        await this.execOk(job.target_vps_id, `mkdir -p ${shellQuote(targetDir)}`, signal)
      })
      await this.step(job, 'FREEZE', signal, async () => {
        const now = await this.ssh.exec(job.source_vps_id, 'date +%s%3N', { signal })
        freezeAt = Number(now.stdout.trim()) || Date.now()
        this.log(
          job.id,
          'FREEZE',
          `Dừng app nguồn để tạo điểm nhất quán (freeze tại ${new Date(freezeAt).toISOString()}).`
        )
        await this.execOk(
          job.source_vps_id,
          `cd ${shellQuote(sourceDir)} && docker compose stop app`,
          signal
        )
      })
      const artifacts = await this.step(job, 'BACKUP', signal, async () =>
        this.backup(job, source, sourceDir, signal)
      )
      await this.step(job, 'TRANSFER', signal, async () => {
        this.migrations.update(job.id, {
          status: 'transferring',
          bytes_transferred: artifacts.bytes
        })
        await this.transfer(job, targetDir, signal, artifacts.bytes)
        return undefined
      })
      await this.step(job, 'RESTORE', signal, async () => {
        const deploymentId = await this.startRestoreDeployment(job, source, target, targetDir, signal)
        await this.waitDeployment(deploymentId, signal)
        this.log(job.id, 'RESTORE', 'App đích đã running.')
        if (source.needs_db === 1) {
          this.log(job.id, 'RESTORE', 'pg_restore dữ liệu PostgreSQL vào app đích…')
          await this.execOk(
            job.target_vps_id,
            `cd ${shellQuote(targetDir)} && docker compose stop app && docker compose exec -T postgres pg_isready -U opspilot -d opspilot && cat ${shellQuote(`opspilot-migrate-${job.id}.dump`)} | docker compose exec -T postgres sh -c 'cat > /tmp/opspilot-migrate-${job.id}.dump' && docker compose exec -T postgres pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error -U opspilot -d opspilot /tmp/opspilot-migrate-${job.id}.dump && docker compose exec -T postgres rm -f /tmp/opspilot-migrate-${job.id}.dump && docker compose up -d app collector`,
            signal
          )
          this.log(job.id, 'RESTORE', 'pg_restore xong, khởi động lại app đích.')
        }
      })
      const verify = await this.step(job, 'VERIFY', signal, async () =>
        this.verify(job, source, target, artifacts, signal)
      )
      lastVerify = verify
      for (const row of this.verifyRows(verify)) {
        this.log(
          job.id,
          'VERIFY',
          `${row.ok ? 'PASS' : 'FAIL'} · ${row.label}: nguồn ${row.source} | đích ${row.target}`
        )
      }
      this.emit({ type: 'verify-result', job_id: job.id, rows: this.verifyRows(verify) })
      if (!verify.ok) {
        throw new AppError('UNKNOWN', 'Đối chiếu migrate không đạt; không cho xác nhận.', {
          step: 'VERIFY'
        })
      }
      const downtime = Math.max(0, Date.now() - freezeAt)
      this.migrations.update(job.id, {
        status: 'awaiting_confirm',
        downtime_ms: downtime,
        verify_json: JSON.stringify({ ...verify, target_app_id: target.id })
      })
      this.log(
        job.id,
        'AWAITING_CONFIRM',
        `Mọi hạng mục verify đạt. Downtime nguồn ${downtime} ms. Chờ xác nhận giữ/dọn nguồn.`
      )
      this.emit({
        type: 'awaiting-confirm',
        job_id: job.id,
        downtime_ms: downtime
      })
    } catch (error) {
      const failedStatus = this.migrations.get(job.id).status
      if (lastVerify) {
        this.migrations.update(job.id, {
          verify_json: JSON.stringify({ ...lastVerify, target_app_id: target.id })
        })
      }
      await this.finishFailed(
        job,
        source,
        target,
        STATUS_TO_STEP[failedStatus] ?? 'VERIFY',
        failedStatus,
        error
      )
    } finally {
      this.jobs.delete(job.id)
    }
  }

  /**
   * Đường về khi migrate lỗi: log lý do + gợi ý xử lý, dọn app đích, khôi phục
   * nguồn, ghi lại status và error_message để UI hiện lại sau khi mở lại app.
   */
  private async finishFailed(
    job: MigrationJob,
    source: App,
    target: App | null,
    step: MigrateStep,
    failedStep: string,
    error: unknown
  ): Promise<void> {
    const reason = describeMigrationError(error)
    this.log(job.id, step, `LỖI ở bước ${failedStep}: ${reason}`)
    this.log(job.id, step, `Gợi ý xử lý: ${migrationHint(error)}`)
    if (target) await this.cleanupTarget(job, target)
    let recovered = true
    try {
      await this.startSourceAndVerify(job)
      this.log(job.id, step, 'App nguồn đã khởi động lại và healthy — rollback an toàn.')
    } catch (recoveryError) {
      recovered = false
      this.log(
        job.id,
        step,
        `Không khôi phục được app nguồn: ${describeMigrationError(recoveryError)} — hãy SSH vào VPS nguồn, vào thư mục app và chạy "docker compose ps app", "docker compose logs app" để xem nguyên nhân.`
      )
    }
    const status = recovered ? 'rolled_back' : 'failed'
    this.migrations.update(job.id, { status, failed_step: failedStep, error_message: reason })
    this.emit({ type: 'finished', job_id: job.id, status, downtime_ms: 0, error: reason })
    await this.cleanupArtifacts(job)
    this.actions.insert({
      action: 'migrate_start',
      status: 'failed',
      vps_id: job.source_vps_id,
      app_id: source.id,
      detail_json: JSON.stringify({
        job_id: job.id,
        error: `${reason}; source_recovered=${recovered}`
      })
    })
  }

  private async step<T>(
    job: MigrationJob,
    step: Parameters<typeof this.emit>[0] extends never
      ? never
      : 'PREPARE' | 'FREEZE' | 'BACKUP' | 'TRANSFER' | 'RESTORE' | 'VERIFY',
    signal: AbortSignal,
    action: () => Promise<T>
  ): Promise<T> {
    const status = (
      {
        PREPARE: 'preparing',
        FREEZE: 'preparing',
        BACKUP: 'backing_up',
        TRANSFER: 'transferring',
        RESTORE: 'restoring',
        VERIFY: 'verifying'
      } as const
    )[step]
    this.migrations.update(job.id, { status })
    const started = Date.now()
    this.emit({ type: 'step-start', job_id: job.id, step, ts: new Date().toISOString() })
    if (signal.aborted) throw new AppError('UNKNOWN', 'Migration đã bị huỷ.', { step })
    const value = await action()
    this.emit({ type: 'step-done', job_id: job.id, step, duration_ms: Date.now() - started })
    return value
  }

  /**
   * Deploy lại app đích bằng pipeline. Truyền env đọc từ `.env` đã migrate vì
   * biến build-time (VITE_*, NEXT_PUBLIC_*) bị đóng vào bundle lúc `docker build`
   * trên VPS đích — nếu để rỗng, image mới rơi về default trong `.env.example`
   * của source (ví dụ VITE_API_URL=http://localhost:3000) và app gọi nhầm API.
   */
  private async startRestoreDeployment(
    job: MigrationJob,
    source: App,
    target: App,
    targetDir: string,
    signal: AbortSignal
  ): Promise<number> {
    const env = await this.readRestoredEnv(job, targetDir)
    const pipeline = this.deployFactory(() => undefined as never)
    const started = pipeline.run(
      {
        vps_id: job.target_vps_id,
        app_name: target.name,
        app_id: target.id,
        source_path: this.sourcePath(source.id),
        remote_source_path: targetDir,
        env
      } as Parameters<DeployPipeline['run']>[0],
      signal
    )
    this.log(
      job.id,
      'RESTORE',
      `Deploy lại app đích "${target.name}" (deployment ${started.deploymentId})…`
    )
    return started.deploymentId
  }

  /** Đọc `.env` đã migrate trên VPS đích; lỗi thì rơi về env rỗng (hành vi cũ)
   *  thay vì làm hỏng cả lượt migrate. */
  private async readRestoredEnv(
    job: MigrationJob,
    targetDir: string
  ): Promise<Record<string, string>> {
    try {
      const content = await this.ssh.readFile(job.target_vps_id, posixJoin(targetDir, '.env'))
      return parseEnvFile(content)
    } catch {
      this.log(job.id, 'RESTORE', 'Không đọc được .env đã migrate — dùng default build args.')
      return {}
    }
  }

  private async createTargetApp(
    source: App,
    targetVpsId: number,
    signal: AbortSignal
  ): Promise<App> {
    const name = `${source.name.slice(0, 21)}-m${Date.now().toString().slice(-7)}`
    const remotePorts = await listListeningPorts(this.ssh, targetVpsId, signal)
    return this.apps.create({
      vps_id: targetVpsId,
      name,
      framework: source.framework,
      source_path: this.sourcePath(source.id),
      host_port: allocatePort([...this.apps.usedPorts(targetVpsId), ...remotePorts]),
      container_port: source.container_port,
      healthcheck_path: source.healthcheck_path,
      needs_db: source.needs_db
    })
  }

  private findTargetApp(job: MigrationJob): App {
    let targetId: number | undefined
    try {
      targetId = JSON.parse(job.verify_json ?? '{}').target_app_id as number | undefined
    } catch {
      targetId = undefined
    }
    const app = targetId
      ? this.apps.listByVps(job.target_vps_id).find((candidate) => candidate.id === targetId)
      : this.apps
          .listByVps(job.target_vps_id)
          .find((candidate) =>
            candidate.name.startsWith(`${this.apps.getById(job.app_id).name.slice(0, 21)}-m`)
          )
    if (!app) throw new AppError('VALIDATION', 'Không tìm thấy app đích của migration.')
    return app
  }

  private appDir(appId: number): string {
    return posixJoin(WORK_ROOT, this.apps.getById(appId).name)
  }

  private async backup(
    job: MigrationJob,
    source: App,
    sourceDir: string,
    signal: AbortSignal
  ): Promise<{ bytes: number; artifacts: Artifact[] }> {
    const archive = `/tmp/opspilot-migrate-${job.id}.tar.gz`
    const dump = `/tmp/opspilot-migrate-${job.id}.dump`
    // fs.protected_regular=2 (mặc định Ubuntu mới) chặn ghi đè file /tmp cũ thuộc
    // user khác — artifact của lượt migrate trước (job id trùng sau khi reset DB)
    // có thể thuộc user SSH cũ. Xoá sẵn trước khi tạo để không bị "Permission denied".
    await this.execOk(
      job.source_vps_id,
      `rm -f ${shellQuote(archive)} ${shellQuote(dump)}`,
      signal,
      true
    )
    if (source.needs_db === 1) {
      this.log(job.id, 'BACKUP', 'pg_dump PostgreSQL trên VPS nguồn…')
      await this.execOk(
        job.source_vps_id,
        `cd ${shellQuote(sourceDir)} && docker compose exec -T postgres pg_dump -Fc -U opspilot opspilot > ${shellQuote(dump)}`,
        signal,
        true
      )
    }
    const dumpEntry =
      source.needs_db === 1 ? ` -C /tmp ${shellQuote(dump.slice('/tmp/'.length))}` : ''
    this.log(job.id, 'BACKUP', `Đóng gói artifact ${archive}…`)
    await this.execOk(
      job.source_vps_id,
      `tar czf ${shellQuote(archive)} --exclude='data/pg' -C ${shellQuote(sourceDir)} src collector Dockerfile docker-compose.yml .env $(test -d ${shellQuote(`${sourceDir}/data`)} && printf data)${dumpEntry}`,
      signal,
      true
    )
    const metadata = await this.ssh.exec(
      job.source_vps_id,
      `sha256sum ${shellQuote(archive)}; stat -c %s ${shellQuote(archive)}`,
      { signal }
    )
    const lines = metadata.stdout.trim().split(/\s+/)
    const artifact: Artifact = {
      name: 'source.tar.gz',
      sha256: lines[0] ?? '',
      size: Number(lines.at(-1) ?? 0)
    }
    this.log(
      job.id,
      'BACKUP',
      `Artifact ${(artifact.size / 1_048_576).toFixed(2)} MB, sha256 ${artifact.sha256.slice(0, 16)}…`
    )
    return { bytes: artifact.size, artifacts: [artifact] }
  }

  private async transfer(
    job: MigrationJob,
    targetDir: string,
    signal: AbortSignal,
    expectedBytes: number
  ): Promise<void> {
    const archive = `/tmp/opspilot-migrate-${job.id}.tar.gz`
    const stagedArchive = `/tmp/opspilot-migrate-${job.id}.staged.tar.gz`
    const relay = this.ssh.relayFile
    if (typeof relay !== 'function') {
      throw new AppError(
        'UNKNOWN',
        'SSH relay stream chưa sẵn sàng; không dùng transfer toàn bộ RAM.',
        {
          step: 'TRANSFER'
        }
      )
    }
    // Cùng lý do xoá artifact cũ ở backup: "cat >" vào file /tmp cũ thuộc user
    // khác trên VPS đích cũng bị fs.protected_regular=2 chặn.
    await this.execOk(job.target_vps_id, `rm -f ${shellQuote(stagedArchive)}`, signal, true)
    const transfer = await relay.call(
      this.ssh,
      job.source_vps_id,
      archive,
      job.target_vps_id,
      stagedArchive,
      {
        signal,
        onProgress: (bytes) => {
          this.emit({
            type: 'progress',
            job_id: job.id,
            step: 'TRANSFER',
            percent: Math.min(99, Math.round((bytes / Math.max(1, expectedBytes)) * 100)),
            detail: `${bytes} bytes`
          })
        }
      }
    )
    this.log(
      job.id,
      'TRANSFER',
      `Relay xong: ${transfer.bytes} bytes (kỳ vọng ${expectedBytes}) từ VPS nguồn sang VPS đích.`
    )
    if (transfer.bytes !== expectedBytes) {
      throw new AppError('UNKNOWN', 'Artifact truyền chưa đủ byte; không giải nén file partial.', {
        step: 'TRANSFER',
        cause: new Error(`expected=${expectedBytes}, actual=${transfer.bytes}`)
      })
    }
    this.migrations.update(job.id, { bytes_transferred: transfer.bytes })
    const checksum = await this.ssh.exec(
      job.target_vps_id,
      `sha256sum ${shellQuote(stagedArchive)}`,
      { signal, timeoutMs: 900_000, retryOnReconnect: false }
    )
    const expected = await this.ssh.exec(job.source_vps_id, `sha256sum ${shellQuote(archive)}`, {
      signal,
      timeoutMs: 30_000
    })
    if (
      checksum.code !== 0 ||
      expected.code !== 0 ||
      checksum.stdout.trim().split(/\s+/)[0] !== expected.stdout.trim().split(/\s+/)[0]
    )
      throw new AppError(
        'UNKNOWN',
        'Checksum artifact đích không khớp; không giải nén file partial.',
        { step: 'TRANSFER' }
      )
    this.log(
      job.id,
      'TRANSFER',
      `Checksum SHA-256 đích khớp nguồn (${checksum.stdout.trim().split(/\s+/)[0].slice(0, 16)}…).`
    )
    this.log(job.id, 'TRANSFER', 'Giải nén artifact vào thư mục app đích…')
    await this.execOk(
      job.target_vps_id,
      `mv ${shellQuote(stagedArchive)} ${shellQuote(archive)} && tar xzf ${shellQuote(archive)} -C ${shellQuote(targetDir)}`,
      signal,
      true
    )
  }

  /** VERIFY đợi app đích sẵn sàng: RESTORE vừa `compose up -d` lại app sau pg_restore
   *  nên container cần vài giây để listen — poll thay vì curl một lần. */
  private async waitTargetHealthy(
    job: MigrationJob,
    target: App,
    signal: AbortSignal
  ): Promise<boolean> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (signal.aborted) throw new AppError('UNKNOWN', 'Migration đã bị huỷ.')
      const health = await this.ssh.exec(
        job.target_vps_id,
        `curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:${target.host_port}${target.healthcheck_path}`,
        { signal }
      )
      if (health.code === 0 && health.stdout.trim().startsWith('2')) return true
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
    return false
  }

  private async verify(
    job: MigrationJob,
    source: App,
    target: App,
    artifacts: { artifacts: Artifact[] },
    signal: AbortSignal
  ): Promise<Verify> {
    const targetHealthy = await this.waitTargetHealthy(job, target, signal)
    const targetRuntime = await this.ssh.exec(
      job.target_vps_id,
      `docker inspect -f '{{.Config.Image}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' ${shellQuote(`${target.name}-app`)}`,
      { signal }
    )
    const sourceFiles = await this.fileStats(job.source_vps_id, this.appDir(source.id), signal)
    const targetFiles = await this.fileStats(job.target_vps_id, this.appDir(target.id), signal)
    const targetArchive = await this.ssh.exec(
      job.target_vps_id,
      `sha256sum /tmp/opspilot-migrate-${job.id}.tar.gz`,
      { signal }
    )
    const checksumOk =
      targetArchive.code === 0 &&
      targetArchive.stdout.trim().split(/\s+/)[0] === artifacts.artifacts[0]?.sha256
    const health =
      targetHealthy && targetRuntime.stdout.includes('|running|')
    const tableCounts =
      source.needs_db === 1 ? await this.tableCounts(job, source, target, signal) : []
    const marker =
      source.needs_db === 1
        ? await this.markerMatch(job, target, this.savedProbe(this.migrations.get(job.id)), signal)
        : null
    const filesOk =
      sourceFiles.count === targetFiles.count && sourceFiles.bytes === targetFiles.bytes
    const tablesOk = tableCounts.every((row) => row.ok)
    const result: Verify = {
      checksums: artifacts.artifacts.map((artifact) => ({
        ...artifact,
        target_sha256: targetArchive.stdout.trim().split(/\s+/)[0] ?? ''
      })),
      source_files: sourceFiles,
      target_files: targetFiles,
      table_counts: tableCounts,
      health,
      marker,
      ok:
        checksumOk &&
        filesOk &&
        tablesOk &&
        health &&
        (marker === null || (marker.source && marker.target))
    }
    return result
  }

  private async fileStats(
    vpsId: number,
    directory: string,
    signal: AbortSignal
  ): Promise<{ count: number; bytes: number }> {
    const result = await this.ssh.exec(
      vpsId,
      `for root in src collector data; do if test -d ${shellQuote(directory)}/$root; then find ${shellQuote(directory)}/$root -type f ! -path '*/pg/*' ! -path '*/node_modules/*' ! -path '*/.git/*' ! -path '*/dist/*' ! -name 'opspilot-migrate-*.dump' -printf '%s\\n'; fi; done | awk '{count+=1; bytes+=$1} END {printf "%d|%d", count+0, bytes+0}'`,
      { signal }
    )
    if (result.code !== 0)
      throw new AppError('UNKNOWN', 'Không đọc được thống kê file migrate.', { step: 'VERIFY' })
    const [count, bytes] = result.stdout.trim().split('|').map(Number)
    return { count: count || 0, bytes: bytes || 0 }
  }

  private async tableCounts(
    job: MigrationJob,
    source: App,
    target: App,
    signal: AbortSignal
  ): Promise<Array<{ table: string; source: number; target: number; ok: boolean }>> {
    const query = `for table in $(docker compose exec -T postgres psql -U opspilot -d opspilot -At -c "select tablename from pg_tables where schemaname='public' order by tablename"); do count=$(docker compose exec -T postgres psql -U opspilot -d opspilot -At -c "select count(*) from public.$table"); printf '%s|%s\\n' "$table" "$count"; done`
    const read = async (vpsId: number, app: App): Promise<Map<string, number>> => {
      const result = await this.ssh.exec(
        vpsId,
        `cd ${shellQuote(this.appDir(app.id))} && ${query}`,
        { signal }
      )
      if (result.code !== 0)
        throw new AppError('UNKNOWN', 'Không đọc được số dòng PostgreSQL.', { step: 'VERIFY' })
      return new Map(
        result.stdout
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => {
            const [name, count] = line.split('|')
            return [name, Number(count)] as [string, number]
          })
      )
    }
    const sourceCounts = await read(job.source_vps_id, source)
    const targetCounts = await read(job.target_vps_id, target)
    return [...new Set([...sourceCounts.keys(), ...targetCounts.keys()])].sort().map((table) => {
      const sourceCount = sourceCounts.get(table) ?? 0
      const targetCount = targetCounts.get(table) ?? 0
      return { table, source: sourceCount, target: targetCount, ok: sourceCount === targetCount }
    })
  }

  private savedProbe(job: MigrationJob): string {
    try {
      return String(
        (JSON.parse(job.verify_json ?? '{}') as { source_probe?: string }).source_probe ?? ''
      )
    } catch {
      return ''
    }
  }

  private async readProbe(vpsId: number, app: App, signal: AbortSignal): Promise<string> {
    const path = app.needs_db === 1 ? '/items?limit=10&offset=1000' : app.healthcheck_path
    const result = await this.ssh.exec(
      vpsId,
      `curl -m 10 -fsS http://127.0.0.1:${app.host_port}${path}`,
      { signal }
    )
    if (result.code !== 0)
      throw new AppError('UNKNOWN', 'Không đọc được business probe nguồn.', { step: 'PREPARE' })
    return result.stdout
  }

  private async markerMatch(
    job: MigrationJob,
    target: App,
    sourceBody: string,
    signal: AbortSignal
  ): Promise<{ source: boolean; target: boolean }> {
    const result = await this.ssh.exec(
      job.target_vps_id,
      `curl -fsS http://127.0.0.1:${target.host_port}${target.needs_db === 1 ? '/items?limit=10&offset=1000' : target.healthcheck_path}`,
      { signal }
    )
    return {
      source: sourceBody.length > 0,
      target: result.code === 0 && result.stdout === sourceBody
    }
  }

  private verifyRows(
    verify: Verify
  ): Array<{ label: string; source: string; target: string; ok: boolean }> {
    return [
      {
        label: 'Artifact checksum',
        source: verify.checksums.map((item) => item.sha256).join(','),
        target: verify.checksums.map((item) => item.target_sha256 ?? 'missing').join(','),
        ok: verify.checksums.length > 0
      },
      {
        label: 'Files',
        source: `${verify.source_files.count}/${verify.source_files.bytes}`,
        target: `${verify.target_files.count}/${verify.target_files.bytes}`,
        ok:
          verify.source_files.count === verify.target_files.count &&
          verify.source_files.bytes === verify.target_files.bytes
      },
      {
        label: 'HTTP and runtime',
        source: 'source running',
        target: verify.health ? 'target running/healthy' : 'target failed',
        ok: verify.health
      },
      {
        label: 'Overall verification',
        source: 'all required checks',
        target: verify.ok ? 'matched' : 'mismatch',
        ok: verify.ok
      }
    ]
  }

  /** Dọn artifact /tmp trên cả hai VPS sau khi job kết thúc: tránh /tmp đầy và tránh
   *  lần sau bị fs.protected_regular chặn vì file cũ thuộc user khác. Best-effort. */
  private async cleanupArtifacts(job: MigrationJob): Promise<void> {
    const remove = `rm -f ${[
      `/tmp/opspilot-migrate-${job.id}.tar.gz`,
      `/tmp/opspilot-migrate-${job.id}.staged.tar.gz`,
      `/tmp/opspilot-migrate-${job.id}.dump`
    ]
      .map(shellQuote)
      .join(' ')}`
    await Promise.allSettled([
      this.ssh.exec(job.source_vps_id, remove, { retryOnReconnect: false }),
      this.ssh.exec(job.target_vps_id, remove, { retryOnReconnect: false })
    ])
  }

  private async cleanupTarget(job: MigrationJob, target: App): Promise<boolean> {
    let remoteClean = false
    try {
      const result = await this.ssh.exec(
        job.target_vps_id,
        [
          `target_dir=${shellQuote(this.appDir(target.id))}`,
          'if [ -f "$target_dir/docker-compose.yml" ]; then cd "$target_dir" && docker compose down -v; fi',
          'rm -rf -- "$target_dir"'
        ].join('; '),
        { retryOnReconnect: false }
      )
      remoteClean = result.code === 0
    } catch {
      remoteClean = false
    }
    if (remoteClean) this.database.prepare('DELETE FROM app WHERE id=?').run(target.id)
    return remoteClean
  }

  private async execOk(
    vpsId: number,
    command: string,
    signal: AbortSignal,
    silent = false
  ): Promise<void> {
    const result = await this.ssh.exec(vpsId, command, {
      signal,
      timeoutMs: 900_000,
      retryOnReconnect: false,
      logCommand: silent ? false : undefined
    })
    if (result.code !== 0) {
      const output = result.stderr.trim() || result.stdout.trim() || 'không có output'
      throw new AppError(
        'UNKNOWN',
        `Lệnh remote thất bại (exit ${result.code}) — ${command.slice(0, 160)}${command.length > 160 ? '…' : ''}: ${output}`
      )
    }
  }

  private async waitDeployment(deploymentId: number, signal: AbortSignal): Promise<void> {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      if (signal.aborted) throw new AppError('UNKNOWN', 'Migration đã bị huỷ.')
      const deployment = this.deployments.getById(deploymentId)
      if (deployment.status === 'running') return
      if (deployment.status === 'failed' || deployment.status === 'rolled_back')
        throw new AppError('UNKNOWN', 'Deploy đích thất bại.')
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
    throw new AppError('SSH_TIMEOUT', 'Deploy đích không kết thúc trong thời gian cho phép.')
  }

  private sourcePath(appId: number): string {
    const row = this.database.prepare('SELECT source_path FROM app WHERE id=?').get(appId) as
      { source_path: string } | undefined
    if (!row?.source_path) throw new AppError('VALIDATION', 'Không tìm thấy source path của app.')
    return row.source_path
  }
}

function describeMigrationError(error: unknown): string {
  if (error instanceof AppError) {
    const cause =
      error.context.cause instanceof Error
        ? error.context.cause.message
        : error.context.cause === undefined
          ? ''
          : String(error.context.cause)
    return `${error.code}: ${error.userMessage}${cause ? `; ${cause}` : ''}`
  }
  return error instanceof Error ? error.message : String(error)
}

/** Gợi ý khắc phục theo loại lỗi migrate — giúp người dùng biết bước tiếp theo thay vì chỉ thấy "rolled_back". */
function migrationHint(error: unknown): string {
  if (error instanceof AppError) {
    if (error.code === 'PRECHECK_FAILED')
      return 'VPS đích chưa đạt điều kiện. SSH vào VPS đích kiểm tra: "free -m" (RAM), "df -h /" (disk), "docker --version" (Docker), "ss -tlnp" (port đang dùng); port bị chiếm thường do container cũ — "docker ps" để xem. Sau đó chạy lại migrate.'
    if (error.code === 'PORT_EXHAUSTED')
      return 'Dải port 30000-30999 trên VPS đích đã hết. Gỡ bớt app/container cũ trên VPS đích rồi chạy lại migrate.'
    if (error.code === 'SSH_TIMEOUT')
      return 'Lệnh SSH vượt thời gian chờ. Kiểm tra mạng từ máy này tới VPS (và tình trạng overload của VPS), rồi chạy lại migrate.'
  }
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('Permission denied') && message.includes('/tmp/opspilot-migrate'))
    return 'VPS còn file artifact cũ của lượt migrate trước trong /tmp (có thể thuộc user khác; Linux chặn ghi đè qua fs.protected_regular). SSH vào VPS chạy "rm -f /tmp/opspilot-migrate-*" rồi chạy lại migrate.'
  if (message.includes('Checksum artifact đích không khớp') || message.includes('chưa đủ byte'))
    return 'Artifact truyền bị lệch giữa hai VPS. Kiểm tra dung lượng /tmp trên cả hai VPS ("df -h /tmp") và độ ổn định mạng, rồi chạy lại migrate.'
  if (message.includes('Deploy đích thất bại') || message.includes('Deploy đích không kết thúc'))
    return 'Deploy app đích lỗi. Vào Lịch sử và mở log deploy của app đích (bước BUILD/HEALTHCHECK) để xem nguyên nhân build/khởi động trên VPS đích.'
  if (message.includes('Đối chiếu migrate không đạt'))
    return 'Một hạng mục VERIFY không khớp (checksum / file / row count / health). Xem các dòng FAIL trong bảng verify phía trên để biết hạng mục cụ thể.'
  if (
    message.includes('Không khởi động lại được app nguồn') ||
    message.includes('chưa healthy sau khi khởi động lại')
  )
    return 'App nguồn chưa chạy lại được sau rollback. SSH vào VPS nguồn, vào thư mục app và chạy "docker compose ps app" cùng "docker compose logs app" để xem nguyên nhân rồi "docker compose start app".'
  return 'Xem dòng "LỖI ở bước …" phía trên để biết lệnh/thông báo lỗi cụ thể. Lỗi SSH thường do mạng hoặc credential; lỗi docker compose do trạng thái VPS.'
}
