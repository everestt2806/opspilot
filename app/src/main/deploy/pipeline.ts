import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { join as posixJoin } from 'node:path/posix'

import type { Database as SqliteDatabase } from 'better-sqlite3'
import type { App, DeployEvent, DeployInput, DeployStep, Deployment, IpcError } from '@shared/ipc'

import { ActionLogRepository } from '../db/actionLogRepository'
import { AppRepository } from '../db/appRepository'
import { DeploymentRepository } from '../db/deploymentRepository'
import { VpsRepository } from '../db/vpsRepository'
import { detectFramework } from '../detectors'
import { buildSourceTree } from '../detectors/sourceTree'
import type { BuildPlan } from '../detectors/types'
import { AppError, toIpcError } from '../errors'
import { logger } from '../logger'
import { SshAbortedError, SshManager } from '../ssh/manager'
import { shellQuote } from '../ssh/shellQuote'
import { allocatePort } from './portPolicy'
import { runPrecheck } from './precheck'
import {
  buildEnvFile,
  readEnvValue,
  renderCompose,
  renderDockerfile,
  type ComposeVars
} from './templates'

const WORK_ROOT = '/opt/opspilot'
const HEALTHCHECK_ATTEMPTS = 10
const HEALTHCHECK_INTERVAL_MS = 3_000
const RENDER_COLLECT_INTERVAL_S = '10'

type FinalStatus = 'running' | 'failed' | 'rolled_back'

function nowIso(): string {
  return new Date().toISOString()
}

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new SshAbortedError())
      return
    }
    const timer = setTimeout(resolve, milliseconds)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new SshAbortedError())
      },
      { once: true }
    )
  })
}

export interface RunContext {
  /** null ở pipeline rollback thủ công — các bước cần input/plan chỉ chạy ở run() đầy đủ. */
  input: DeployInput | null
  plan: BuildPlan | null
  signal: AbortSignal
  app: App
  deployment: Deployment
  newApp: boolean
  startedAt: number
  currentStep: DeployStep | null
  stepLines: string[]
  failedStep: DeployStep | null
  cancelled: boolean
  durations: Partial<Record<DeployStep, number>>
}

/**
 * Pipeline M4: PRECHECK → UPLOAD → RENDER → BUILD → DEPLOY → HEALTHCHECK → RECORD.
 * Thứ tự bước, bất biến và nhánh lỗi theo đúng docs/contracts/deploy-events.md mục 1.
 */
export class DeployPipeline {
  private readonly ssh: SshManager
  private readonly emit: (event: DeployEvent) => void
  private readonly vpsRepository: VpsRepository
  private readonly appRepository: AppRepository
  private readonly deploymentRepository: DeploymentRepository
  private readonly actionLog: ActionLogRepository

  /** Khoá chống 2 pipeline chạy đồng thời trên cùng một app (deploy-events mục 3). */
  private activeByApp = new Map<number, number>()
  private controllers = new Map<number, AbortController>()

  constructor(deps: { ssh: SshManager; db: SqliteDatabase; emit: (event: DeployEvent) => void }) {
    this.ssh = deps.ssh
    this.emit = deps.emit
    this.vpsRepository = new VpsRepository(deps.db)
    this.appRepository = new AppRepository(deps.db)
    this.deploymentRepository = new DeploymentRepository(deps.db)
    this.actionLog = new ActionLogRepository(deps.db)
  }

  /** Khởi động pipeline. Phần setup (detect + tạo bản ghi + khoá) chạy đồng bộ để
   * `deploy:start` trả được deployment_id ngay; các bước sau chạy nền, tiến độ qua
   * kênh `deploy:event`. Luôn kết thúc bằng đúng một event `finished`. */
  run(input: DeployInput, signal?: AbortSignal): { deploymentId: number } {
    const ctx = this.setup(input, signal)
    void this.execute(ctx).catch((error: unknown) => {
      logger.error('deploy', 'Pipeline dừng bất thường ngoài vòng bắt lỗi', {
        deployment_id: ctx.deployment.id,
        error: error instanceof Error ? error.message : String(error)
      })
    })
    return { deploymentId: ctx.deployment.id }
  }

  /** Rollback thủ công (UC-04): compose up image cũ (không build lại), healthcheck, ghi bản ghi mới. */
  rollback(appId: number, targetDeploymentId: number): { deploymentId: number } {
    if (this.activeByApp.has(appId)) {
      throw new AppError(
        'VALIDATION',
        'App đang có pipeline đang chạy. Hãy chờ xong hoặc huỷ rồi thử lại.'
      )
    }
    const app = this.appRepository.getById(appId)
    const target = this.deploymentRepository.getById(targetDeploymentId)
    if (target.app_id !== appId) {
      throw new AppError('VALIDATION', 'Deployment không thuộc app này. Hãy tải lại rồi thử lại.')
    }
    if (target.status !== 'running') {
      throw new AppError(
        'VALIDATION',
        'Chỉ có thể rollback về deployment đã chạy thành công. Hãy chọn một phiên bản running.'
      )
    }

    const controller = new AbortController()
    const deployment = this.deploymentRepository.createNextVersion(app.id, app.name, null, null)
    this.activeByApp.set(app.id, deployment.id)
    this.controllers.set(deployment.id, controller)

    const ctx: RunContext = {
      input: null,
      plan: null,
      signal: controller.signal,
      app,
      deployment,
      newApp: false,
      startedAt: Date.now(),
      currentStep: null,
      stepLines: [],
      failedStep: null,
      cancelled: false,
      durations: {}
    }
    void this.executeRollback(ctx, target.image_tag, target.version, target.id).catch(
      (error: unknown) => {
        logger.error('deploy', 'Rollback thủ công dừng bất thường ngoài vòng bắt lỗi', {
          deployment_id: deployment.id,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    )
    return { deploymentId: deployment.id }
  }

  /** Chuỗi event rút gọn DEPLOY → HEALTHCHECK, luôn kết thúc bằng đúng một `finished`. */
  private async executeRollback(
    ctx: RunContext,
    targetImageTag: string,
    toVersion: number,
    targetDeploymentId: number
  ): Promise<void> {
    try {
      await this.inStep(ctx, 'DEPLOY', async () => {
        await this.restoreComposeTo(ctx.app, targetImageTag)
        this.log(ctx, 'DEPLOY', `Khôi phục compose với ảnh v${toVersion}...\n`, 'stdout')
        const result = await this.execStream(
          ctx,
          'DEPLOY',
          `cd ${shellQuote(posixJoin(WORK_ROOT, ctx.app.name))} && docker compose up -d`,
          180_000
        )
        if (result.code !== 0) {
          throw new AppError(
            'UNKNOWN',
            'Khởi động lại app với ảnh cũ không thành công. Hãy xem log trên VPS.',
            { step: 'DEPLOY', cause: new Error(result.stderr.trim() || result.stdout.trim()) }
          )
        }
        await this.waitContainerRunning(ctx.app, ctx.signal, ctx.deployment.id)
        this.log(ctx, 'DEPLOY', `App đã chạy lại với ảnh v${toVersion}.\n`, 'stdout')
      })

      await this.inStep(ctx, 'HEALTHCHECK', async () => {
        const ok = await this.healthcheckOnce(ctx.app, ctx.signal)
        this.log(
          ctx,
          'HEALTHCHECK',
          ok ? 'Phiên bản cũ trả lời HTTP OK.\n' : 'Phiên bản cũ không trả lời healthcheck.\n',
          ok ? 'stdout' : 'stderr'
        )
        if (!ok) {
          throw new AppError(
            'UNKNOWN',
            'Phiên bản rollback đã khởi động nhưng healthcheck không đạt. Hãy xem log container trên VPS.',
            { step: 'HEALTHCHECK' }
          )
        }
      })

      await this.recordManualRollbackSuccess(ctx, targetImageTag, targetDeploymentId)
    } catch (error) {
      await this.recordFailure(ctx, error)
      try {
        const ipcError = toStepIpcError(error)
        this.actionLog.insert({
          action: 'rollback_manual',
          status: ctx.cancelled ? 'cancelled' : 'failed',
          vps_id: ctx.app.vps_id,
          app_id: ctx.app.id,
          deployment_id: ctx.deployment.id,
          message: `Rollback thủ công app ${ctx.app.name} thất bại: ${ipcError.message}`
        })
      } catch (recordError) {
        logger.warn('deploy', 'Không ghi được action_log rollback thủ công thất bại', {
          deployment_id: ctx.deployment.id,
          error: recordError instanceof Error ? recordError.message : String(recordError)
        })
      }
      this.emit({
        type: 'finished',
        deployment_id: ctx.deployment.id,
        status: 'failed',
        total_duration_ms: Date.now() - ctx.startedAt
      })
    } finally {
      this.release(ctx.app.id, ctx.deployment.id)
    }
  }

  private async recordManualRollbackSuccess(
    ctx: RunContext,
    targetImageTag: string,
    targetDeploymentId: number
  ): Promise<void> {
    this.deploymentRepository.update(ctx.deployment.id, {
      status: 'running',
      is_rollback_of: targetDeploymentId,
      finished_at: nowIso(),
      total_duration_ms: Date.now() - ctx.startedAt
    })
    this.appRepository.setCurrentDeployment(ctx.app.id, ctx.deployment.id)
    this.actionLog.insert({
      action: 'rollback_manual',
      status: 'success',
      vps_id: ctx.app.vps_id,
      app_id: ctx.app.id,
      deployment_id: ctx.deployment.id,
      message: `Rollback thủ công app ${ctx.app.name} về ${targetImageTag} — app đã chạy lại và healthcheck đạt.`
    })
    this.emit({
      type: 'finished',
      deployment_id: ctx.deployment.id,
      status: 'running',
      total_duration_ms: Date.now() - ctx.startedAt,
      app_url: ctx.app.url
    })
  }

  cancel(deploymentId: number): boolean {
    const controller = this.controllers.get(deploymentId)
    if (!controller) {
      return false
    }
    controller.abort()
    return true
  }

  // ── Setup (đồng bộ, chạy trước mọi event) ─────────────────────────────────────

  private setup(input: DeployInput, signal?: AbortSignal): RunContext {
    if (!Number.isInteger(input.vps_id) || input.vps_id <= 0) {
      throw new AppError('VALIDATION', 'VPS không hợp lệ. Hãy chọn lại VPS rồi thử.')
    }
    const name = input.app_name.trim()
    if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(name)) {
      throw new AppError(
        'VALIDATION',
        'Tên app phải là chữ thường, số hoặc dấu gạch ngang, dài 2-31 ký tự (vd: express-api).'
      )
    }
    if (!existsSync(input.source_path)) {
      throw new AppError('VALIDATION', 'Thư mục source không tồn tại. Hãy chọn lại thư mục.')
    }

    const detection = detectFramework(buildSourceTree(input.source_path))
    if (!detection.matched) {
      throw new AppError('DETECT_FAILED', detection.hint)
    }
    const plan = detection.plan

    const vps = this.vpsRepository.getById(input.vps_id)
    let app: App
    let newApp = false

    if (input.app_id !== undefined) {
      app = this.appRepository.getById(input.app_id)
      if (app.vps_id !== vps.id) {
        throw new AppError('VALIDATION', 'App không thuộc VPS đã chọn. Hãy chọn lại.')
      }
    } else {
      const existing = this.appRepository.getByVpsAndName(vps.id, name)
      if (existing) {
        app = existing
      } else {
        newApp = true
        app = this.appRepository.create({
          vps_id: vps.id,
          name,
          framework: detection.detector,
          source_path: input.source_path,
          host_port: allocatePort(this.appRepository.usedPorts(vps.id)),
          container_port: plan.containerPort,
          healthcheck_path: plan.healthcheckPath,
          needs_db: plan.needsDb ? 1 : 0
        })
      }
    }

    if (this.activeByApp.has(app.id)) {
      throw new AppError(
        'VALIDATION',
        'App này đang có một lượt deploy đang chạy. Hãy chờ xong hoặc huỷ rồi thử lại.'
      )
    }

    const deployment = this.deploymentRepository.createNextVersion(
      app.id,
      app.name,
      JSON.stringify(plan),
      null
    )
    const controller = new AbortController()
    signal?.addEventListener('abort', () => controller.abort(), { once: true })
    this.activeByApp.set(app.id, deployment.id)
    this.controllers.set(deployment.id, controller)

    return {
      input,
      signal: controller.signal,
      app,
      deployment,
      plan,
      newApp,
      startedAt: Date.now(),
      currentStep: null,
      stepLines: [],
      failedStep: null,
      cancelled: false,
      durations: {}
    }
  }

  // ── Vòng đời các bước ─────────────────────────────────────────────────────────

  private async execute(ctx: RunContext): Promise<void> {
    let finalStatus: FinalStatus = 'failed'
    const logStream = this.openLogStream(ctx.deployment.id)

    try {
      await this.stepPrecheck(ctx)
      await this.stepUpload(ctx)
      await this.stepRender(ctx)
      await this.stepBuild(ctx)
      await this.stepDeploy(ctx)
      const healthOk = await this.stepHealthcheck(ctx)

      if (healthOk) {
        await this.recordSuccess(ctx)
        finalStatus = 'running'
      } else {
        finalStatus = await this.handleHealthcheckFail(ctx)
      }
    } catch (error) {
      await this.recordFailure(ctx, error)
      finalStatus = 'failed'
    } finally {
      this.emit({
        type: 'finished',
        deployment_id: ctx.deployment.id,
        status: finalStatus,
        total_duration_ms: Date.now() - ctx.startedAt,
        app_url: finalStatus === 'running' ? ctx.app.url : undefined
      })
      this.release(ctx.app.id, ctx.deployment.id)
      logStream.end()
    }
  }

  private openLogStream(deploymentId: number): import('node:fs').WriteStream {
    const dir = join(homedir(), '.opspilot', 'logs')
    mkdirSync(dir, { recursive: true })
    return createWriteStream(join(dir, `deploy-${deploymentId}.log`), { flags: 'a' })
  }

  /** Wrapper phát đúng chuỗi event của một bước: step-start → log* → step-done/step-failed. */
  private async inStep<T>(ctx: RunContext, step: DeployStep, fn: () => Promise<T>): Promise<T> {
    ctx.currentStep = step
    ctx.stepLines = []
    this.emit({
      type: 'step-start',
      deployment_id: ctx.deployment.id,
      step,
      ts: nowIso()
    })
    const started = Date.now()

    try {
      this.throwIfAborted(ctx)
      const value = await fn()
      const durationMs = Date.now() - started
      ctx.durations[step] = durationMs
      this.emit({
        type: 'step-done',
        deployment_id: ctx.deployment.id,
        step,
        duration_ms: durationMs
      })
      this.actionLog.insert({
        action: 'deploy',
        vps_id: ctx.app.vps_id,
        app_id: ctx.app.id,
        deployment_id: ctx.deployment.id,
        message: `Bước ${step} xong (${formatDuration(durationMs)}).`,
        detail_json: JSON.stringify({ step, duration_ms: durationMs })
      })
      return value
    } catch (error) {
      if (error instanceof SshAbortedError) {
        ctx.cancelled = true
      }
      const ipcError = toStepIpcError(error)
      this.emit({
        type: 'step-failed',
        deployment_id: ctx.deployment.id,
        step,
        error: ipcError,
        last_log_lines: ctx.stepLines.slice(-200)
      })
      ctx.failedStep = step
      this.actionLog.insert({
        action: 'deploy',
        status: ctx.cancelled ? 'cancelled' : 'failed',
        vps_id: ctx.app.vps_id,
        app_id: ctx.app.id,
        deployment_id: ctx.deployment.id,
        message: `Bước ${step} lỗi: ${ipcError.message}`
      })
      throw error
    }
  }

  private throwIfAborted(ctx: RunContext): void {
    if (ctx.signal.aborted) {
      ctx.cancelled = true
      throw new SshAbortedError()
    }
  }

  /** input/plan luôn có trong run() đầy đủ — null duy nhất ở pipeline rollback thủ công. */
  private requireInput(ctx: RunContext): DeployInput {
    if (!ctx.input) {
      throw new AppError('UNKNOWN', 'Pipeline đang chạy thiếu thông tin deploy.')
    }
    return ctx.input
  }

  private requirePlan(ctx: RunContext): BuildPlan {
    if (!ctx.plan) {
      throw new AppError('UNKNOWN', 'Pipeline đang chạy thiếu build plan.')
    }
    return ctx.plan
  }

  private log(ctx: RunContext, step: DeployStep, chunk: string, stream: 'stdout' | 'stderr'): void {
    this.emit({
      type: 'log',
      deployment_id: ctx.deployment.id,
      step,
      chunk,
      stream
    })
    for (const line of chunk.split('\n')) {
      if (line.length > 0) {
        ctx.stepLines.push(line)
      }
    }
  }

  private execStream(
    ctx: RunContext,
    step: DeployStep,
    command: string,
    timeoutMs: number
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return this.ssh.exec(ctx.app.vps_id, command, {
      timeoutMs,
      signal: ctx.signal,
      onStdout: (chunk) => this.log(ctx, step, chunk, 'stdout'),
      onStderr: (chunk) => this.log(ctx, step, chunk, 'stderr')
    })
  }

  // ── Bước 1-6 ──────────────────────────────────────────────────────────────────

  private async stepPrecheck(ctx: RunContext): Promise<void> {
    await this.inStep(ctx, 'PRECHECK', async () => {
      const detail = await runPrecheck(this.ssh, ctx.app.vps_id, {
        port: ctx.newApp ? ctx.app.host_port : null,
        signal: ctx.signal
      })
      this.log(ctx, 'PRECHECK', `${detail.command}\n`, 'stdout')
      for (const check of detail.checks) {
        this.log(
          ctx,
          'PRECHECK',
          `  ${check.ok ? '[OK]' : '[FAIL]'} ${check.label}: ${check.actual} (cần ${check.required})\n`,
          check.ok ? 'stdout' : 'stderr'
        )
      }

      if (!detail.passed) {
        const failed = detail.checks.filter((check) => !check.ok)
        throw new AppError(
          'PRECHECK_FAILED',
          `VPS không đạt điều kiện: ${failed
            .map((check) => `${check.label} ${check.actual} (cần ${check.required})`)
            .join('; ')}.`,
          { step: 'PRECHECK' }
        )
      }

      if (detail.dockerVersion) {
        this.vpsRepository.update(ctx.app.vps_id, {
          docker_version: detail.dockerVersion,
          last_status: 'online',
          last_seen_at: nowIso()
        })
      }
    })
  }

  private async stepUpload(ctx: RunContext): Promise<void> {
    await this.inStep(ctx, 'UPLOAD', async () => {
      const srcDir = posixJoin(WORK_ROOT, ctx.app.name, 'src')
      this.log(ctx, 'UPLOAD', `Tải lên ${srcDir} (loại node_modules/.git/dist)\n`, 'stdout')
      try {
        const result = await this.ssh.uploadDir(
          ctx.app.vps_id,
          this.requireInput(ctx).source_path,
          srcDir,
          {
            signal: ctx.signal
          }
        )
        this.log(ctx, 'UPLOAD', `Xong: ${formatBytes(result.bytes)}\n`, 'stdout')
      } catch (error) {
        if (ctx.newApp) {
          await this.ignoreError(
            this.ssh.exec(
              ctx.app.vps_id,
              `rm -rf ${shellQuote(posixJoin(WORK_ROOT, ctx.app.name))}`
            )
          )
        }
        throw error
      }
    })
  }

  private async stepRender(ctx: RunContext): Promise<void> {
    await this.inStep(ctx, 'RENDER', async () => {
      const plan = this.requirePlan(ctx)
      const input = this.requireInput(ctx)
      const appDir = posixJoin(WORK_ROOT, ctx.app.name)
      const vars: ComposeVars = {
        APP_NAME: ctx.app.name,
        IMAGE_TAG: ctx.deployment.image_tag,
        HOST_PORT: String(ctx.app.host_port),
        CONTAINER_PORT: String(ctx.app.container_port),
        HEALTHCHECK_PATH: ctx.app.healthcheck_path,
        START_COMMAND: plan.startCommand,
        COLLECT_INTERVAL_S: RENDER_COLLECT_INTERVAL_S
      }
      let renderEnv = input.env
      if (plan.needsDb && !ctx.newApp) {
        const existingEnv = await this.ssh.readFile(ctx.app.vps_id, posixJoin(appDir, '.env'))
        const existingPassword = readEnvValue(existingEnv, 'POSTGRES_PASSWORD')
        const existingDatabaseUrl = readEnvValue(existingEnv, 'DATABASE_URL')

        if (existingPassword) {
          renderEnv = {
            ...input.env,
            POSTGRES_PASSWORD: existingPassword,
            ...(existingDatabaseUrl ? { DATABASE_URL: existingDatabaseUrl } : {})
          }
          this.log(
            ctx,
            'RENDER',
            'Giữ nguyên credential PostgreSQL hiện có để volume tiếp tục truy cập được.\n',
            'stdout'
          )
        } else if (ctx.app.current_deployment_id !== null) {
          throw new AppError(
            'UNKNOWN',
            'Không đọc được credential PostgreSQL hiện có. Đã dừng trước khi ghi .env để tránh làm mất kết nối database.',
            { step: 'RENDER' }
          )
        }
      }
      const env = buildEnvFile(renderEnv, plan.needsDb)
      const files: Array<{ name: string; content: string; mode?: number }> = [
        {
          name: 'Dockerfile',
          content: renderDockerfile(plan.dockerfileTemplate, {
            ...vars,
            BUILD_COMMAND: plan.buildCommand
          })
        },
        { name: 'docker-compose.yml', content: renderCompose(vars, plan.needsDb) },
        { name: '.env', content: env.content, mode: 0o600 }
      ]

      try {
        for (const file of files) {
          await this.ssh.writeFile(ctx.app.vps_id, posixJoin(appDir, file.name), file.content, {
            mode: file.mode,
            silent: file.name === '.env'
          })
          this.log(
            ctx,
            'RENDER',
            file.name === '.env'
              ? 'Đã ghi .env (chmod 600) — nội dung không hiện trong log\n'
              : `Đã ghi ${file.name} (${Buffer.byteLength(file.content)} bytes)\n`,
            'stdout'
          )
        }
        await this.ssh.fileSize(ctx.app.vps_id, posixJoin(appDir, 'Dockerfile'))
        await this.ssh.fileSize(ctx.app.vps_id, posixJoin(appDir, 'docker-compose.yml'))
        await this.ssh.fileSize(ctx.app.vps_id, posixJoin(appDir, '.env'))
      } catch (error) {
        for (const file of files) {
          await this.ignoreError(
            this.ssh.exec(ctx.app.vps_id, `rm -f ${shellQuote(posixJoin(appDir, file.name))}`)
          )
        }
        throw error
      }
    })
  }

  private async stepBuild(ctx: RunContext): Promise<void> {
    await this.inStep(ctx, 'BUILD', async () => {
      const tag = shellQuote(ctx.deployment.image_tag)
      const command = `cd ${shellQuote(posixJoin(WORK_ROOT, ctx.app.name))} && docker build -t ${tag} .`
      this.log(ctx, 'BUILD', `$ ${command}\n`, 'stdout')
      try {
        const result = await this.execStream(ctx, 'BUILD', command, 900_000)
        if (result.code !== 0) {
          throw new AppError(
            'DOCKER_BUILD_FAILED',
            'Bước build image Docker thất bại. Xem log bước BUILD để tìm lỗi.',
            { step: 'BUILD', cause: new Error(result.stderr.trim() || `exit ${result.code}`) }
          )
        }
      } catch (error) {
        await this.ignoreError(
          this.ssh.exec(ctx.app.vps_id, `docker image rm ${tag} >/dev/null 2>&1 || true`)
        )
        throw error
      }
    })
  }

  private async stepDeploy(ctx: RunContext): Promise<void> {
    await this.inStep(ctx, 'DEPLOY', async () => {
      const command = `cd ${shellQuote(posixJoin(WORK_ROOT, ctx.app.name))} && docker compose up -d`
      this.log(ctx, 'DEPLOY', `$ ${command}\n`, 'stdout')
      try {
        const result = await this.execStream(ctx, 'DEPLOY', command, 180_000)
        if (result.code !== 0) {
          throw new AppError('UNKNOWN', 'Bước chạy container thất bại. Xem log bước DEPLOY.', {
            step: 'DEPLOY',
            cause: new Error(result.stderr.trim() || result.stdout.trim())
          })
        }
        await this.waitContainerRunning(ctx.app, ctx.signal, ctx.deployment.id)
      } catch (error) {
        await this.restorePreviousOrDown(ctx)
        throw error
      }
    })
  }

  private async stepHealthcheck(ctx: RunContext): Promise<boolean> {
    return this.inStep(ctx, 'HEALTHCHECK', async () => {
      const url = `http://127.0.0.1:${ctx.app.host_port}${ctx.app.healthcheck_path}`
      for (let attempt = 1; attempt <= HEALTHCHECK_ATTEMPTS; attempt += 1) {
        if (ctx.signal.aborted) {
          throw new SshAbortedError()
        }
        const result = await this.ssh.exec(
          ctx.app.vps_id,
          `curl -fsS -m 5 -o /dev/null ${shellQuote(url)}`,
          {
            timeoutMs: 10_000,
            signal: ctx.signal
          }
        )
        this.log(
          ctx,
          'HEALTHCHECK',
          `[${attempt}/${HEALTHCHECK_ATTEMPTS}] ${url} -> ${result.code === 0 ? 'HTTP OK' : 'chưa trả lời'}\n`,
          result.code === 0 ? 'stdout' : 'stderr'
        )
        if (result.code === 0) {
          this.log(ctx, 'HEALTHCHECK', 'Healthcheck đạt.\n', 'stdout')
          return true
        }
        if (attempt < HEALTHCHECK_ATTEMPTS) {
          await sleep(HEALTHCHECK_INTERVAL_MS, ctx.signal)
        }
      }
      this.log(ctx, 'HEALTHCHECK', 'Healthcheck thất bại cả 10 lần thử.\n', 'stderr')
      return false
    })
  }

  // ── Nhánh lỗi & hồi phục ─────────────────────────────────────────────────────

  private async restorePreviousOrDown(ctx: RunContext): Promise<void> {
    const previous = this.deploymentRepository.previousCompleted(ctx.app.id, ctx.deployment.version)
    try {
      if (previous) {
        this.log(ctx, 'DEPLOY', `Khôi phục phiên bản cũ v${previous.version}...\n`, 'stdout')
        await this.restoreComposeTo(ctx.app, previous.image_tag)
        await this.execStream(
          ctx,
          'DEPLOY',
          `cd ${shellQuote(posixJoin(WORK_ROOT, ctx.app.name))} && docker compose up -d`,
          180_000
        )
        this.log(ctx, 'DEPLOY', `App đã quay lại v${previous.version}.\n`, 'stdout')
      } else {
        this.log(ctx, 'DEPLOY', 'Chưa có phiên bản cũ — dừng container (giữ volume).\n', 'stdout')
        await this.execStream(
          ctx,
          'DEPLOY',
          `cd ${shellQuote(posixJoin(WORK_ROOT, ctx.app.name))} && docker compose down`,
          180_000
        )
      }
    } catch (error) {
      this.log(
        ctx,
        'DEPLOY',
        `Cảnh báo: không hồi phục được phiên bản cũ (${error instanceof Error ? error.message : String(error)})\n`,
        'stderr'
      )
      logger.warn('deploy', 'Nhánh hồi phục của bước DEPLOY thất bại', {
        deployment_id: ctx.deployment.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async restoreComposeTo(app: App, imageTag: string): Promise<void> {
    const vars: ComposeVars = {
      APP_NAME: app.name,
      IMAGE_TAG: imageTag,
      HOST_PORT: String(app.host_port),
      CONTAINER_PORT: String(app.container_port),
      HEALTHCHECK_PATH: app.healthcheck_path,
      START_COMMAND: '',
      COLLECT_INTERVAL_S: RENDER_COLLECT_INTERVAL_S
    }
    await this.ssh.writeFile(
      app.vps_id,
      posixJoin(WORK_ROOT, app.name, 'docker-compose.yml'),
      renderCompose(vars, app.needs_db === 1)
    )
  }

  /** HEALTHCHECK thất bại -> tự rollback v(N-1) kèm chuỗi event DEPLOY phụ (bất biến 6). */
  private async handleHealthcheckFail(ctx: RunContext): Promise<FinalStatus> {
    const previous = this.deploymentRepository.previousCompleted(ctx.app.id, ctx.deployment.version)
    if (!previous) {
      this.log(
        ctx,
        'HEALTHCHECK',
        'Không có phiên bản cũ để rollback — giữ nguyên container để xem log.\n',
        'stderr'
      )
      this.finalizeFailed(ctx)
      return 'failed'
    }

    try {
      await this.inStep(ctx, 'DEPLOY', async () => {
        this.log(
          ctx,
          'DEPLOY',
          `Tự rollback về v${previous.version} (healthcheck thất bại)...\n`,
          'stdout'
        )
        await this.restoreComposeTo(ctx.app, previous.image_tag)
        const result = await this.execStream(
          ctx,
          'DEPLOY',
          `cd ${shellQuote(posixJoin(WORK_ROOT, ctx.app.name))} && docker compose up -d`,
          180_000
        )
        if (result.code !== 0) {
          throw new AppError(
            'UNKNOWN',
            'Tự rollback không khởi động được phiên bản cũ. Hãy xem log container trên VPS.',
            {
              step: 'DEPLOY',
              cause: new Error(result.stderr.trim() || `compose up exit ${result.code}`)
            }
          )
        }
        await this.waitContainerRunning(ctx.app, ctx.signal, ctx.deployment.id)
        const healthOk = await this.healthcheckOnce(ctx.app, ctx.signal)
        this.log(
          ctx,
          'DEPLOY',
          healthOk
            ? `Rollback về v${previous.version} xong; healthcheck đạt.\n`
            : `Rollback về v${previous.version} đã chạy nhưng healthcheck không đạt.\n`,
          healthOk ? 'stdout' : 'stderr'
        )
        if (!healthOk) {
          throw new AppError(
            'UNKNOWN',
            'Tự rollback đã khởi động phiên bản cũ nhưng healthcheck không đạt. Hãy xem log container trên VPS.',
            { step: 'DEPLOY' }
          )
        }
      })
      await this.pruneImages(ctx, null)
    } catch (error) {
      const ipcError = toStepIpcError(error)
      this.finalizeFailed(ctx)
      try {
        this.actionLog.insert({
          action: 'rollback_auto',
          status: ctx.cancelled ? 'cancelled' : 'failed',
          vps_id: ctx.app.vps_id,
          app_id: ctx.app.id,
          deployment_id: ctx.deployment.id,
          message: `Tự rollback app ${ctx.app.name} về v${previous.version} thất bại: ${ipcError.message}`
        })
      } catch (recordError) {
        logger.warn('deploy', 'Không ghi được action_log auto rollback thất bại', {
          deployment_id: ctx.deployment.id,
          error: recordError instanceof Error ? recordError.message : String(recordError)
        })
      }
      return 'failed'
    }

    this.deploymentRepository.update(ctx.deployment.id, {
      status: 'rolled_back',
      failed_step: 'HEALTHCHECK',
      finished_at: nowIso(),
      build_duration_ms: ctx.durations.BUILD ?? null,
      total_duration_ms: Date.now() - ctx.startedAt
    })
    this.appRepository.setCurrentDeployment(ctx.app.id, previous.id)
    this.actionLog.insert({
      action: 'rollback_auto',
      status: 'success',
      vps_id: ctx.app.vps_id,
      app_id: ctx.app.id,
      deployment_id: ctx.deployment.id,
      message: `Tự rollback app ${ctx.app.name} về v${previous.version} vì healthcheck thất bại.`
    })
    return 'rolled_back'
  }

  private async waitContainerRunning(
    app: App,
    signal: AbortSignal,
    deploymentId: number
  ): Promise<void> {
    const deadline = Date.now() + 180_000
    const container = `${app.name}-app`
    while (Date.now() < deadline) {
      const result = await this.ssh.exec(
        app.vps_id,
        `docker inspect -f '{{.State.Status}}' ${shellQuote(container)} 2>/dev/null || echo missing`,
        { timeoutMs: 15_000, signal }
      )
      if (result.stdout.trim() === 'running') {
        return
      }
      await sleep(2_000, signal)
    }
    throw new AppError(
      'SSH_TIMEOUT',
      `Container ${container} không vào trạng thái running đúng hạn. Hãy xem log container trên VPS.`,
      { step: 'DEPLOY', cause: new Error(`deployment ${deploymentId}`) }
    )
  }

  private async healthcheckOnce(app: App, signal: AbortSignal): Promise<boolean> {
    const url = `http://127.0.0.1:${app.host_port}${app.healthcheck_path}`
    const result = await this.ssh.exec(
      app.vps_id,
      `curl -fsS -m 5 -o /dev/null ${shellQuote(url)}`,
      {
        timeoutMs: 10_000,
        signal
      }
    )
    return result.code === 0
  }

  // ── Bước 7: RECORD — luôn "qua" (lỗi chỉ warn, không làm fail cả deploy) ─────

  private async recordSuccess(ctx: RunContext): Promise<void> {
    const step: DeployStep = 'RECORD'
    ctx.currentStep = step
    ctx.stepLines = []
    this.emit({ type: 'step-start', deployment_id: ctx.deployment.id, step, ts: nowIso() })
    const started = Date.now()

    try {
      this.deploymentRepository.update(ctx.deployment.id, {
        status: 'running',
        finished_at: nowIso(),
        build_duration_ms: ctx.durations.BUILD ?? null,
        total_duration_ms: Date.now() - ctx.startedAt
      })
      this.appRepository.setCurrentDeployment(ctx.app.id, ctx.deployment.id)
    } catch (error) {
      logger.warn('deploy', 'Bước RECORD không ghi được kết quả vào DB', {
        deployment_id: ctx.deployment.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    try {
      this.actionLog.insert({
        action: 'deploy',
        status: 'success',
        vps_id: ctx.app.vps_id,
        app_id: ctx.app.id,
        deployment_id: ctx.deployment.id,
        message: `Deploy v${ctx.deployment.version} app ${ctx.app.name}: thành công — ${ctx.app.url}`,
        detail_json: JSON.stringify({ url: ctx.app.url, version: ctx.deployment.version })
      })
    } catch (error) {
      logger.warn('deploy', 'Bước RECORD không ghi được action_log', {
        deployment_id: ctx.deployment.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    await this.pruneImages(ctx, 'RECORD')

    const durationMs = Date.now() - started
    ctx.durations[step] = durationMs
    this.emit({
      type: 'step-done',
      deployment_id: ctx.deployment.id,
      step,
      duration_ms: durationMs
    })
  }

  private async recordFailure(ctx: RunContext, error: unknown): Promise<void> {
    const ipcError = toStepIpcError(error)
    try {
      this.deploymentRepository.update(ctx.deployment.id, {
        status: 'failed',
        failed_step: ctx.failedStep,
        finished_at: nowIso(),
        build_duration_ms: ctx.durations.BUILD ?? null,
        total_duration_ms: Date.now() - ctx.startedAt
      })
      this.actionLog.insert({
        action: 'deploy',
        status: ctx.cancelled ? 'cancelled' : 'failed',
        vps_id: ctx.app.vps_id,
        app_id: ctx.app.id,
        deployment_id: ctx.deployment.id,
        message: `Deploy v${ctx.deployment.version} app ${ctx.app.name}: ${
          ctx.cancelled ? 'đã huỷ' : 'thất bại'
        }${ctx.failedStep ? ` ở bước ${ctx.failedStep}` : ''}: ${ipcError.message}`
      })
      await this.pruneImages(ctx, null)
    } catch (recordError) {
      logger.warn('deploy', 'Không ghi được kết quả lỗi vào DB', {
        deployment_id: ctx.deployment.id,
        error: recordError instanceof Error ? recordError.message : String(recordError)
      })
    }
  }

  private finalizeFailed(ctx: RunContext): void {
    this.deploymentRepository.update(ctx.deployment.id, {
      status: 'failed',
      failed_step: 'HEALTHCHECK',
      finished_at: nowIso(),
      build_duration_ms: ctx.durations.BUILD ?? null,
      total_duration_ms: Date.now() - ctx.startedAt
    })
  }

  /** Giữ tối đa 3 image của một app (ADR-004). Lỗi chỉ warn, không làm fail deploy. */
  private async pruneImages(ctx: RunContext, logStep: DeployStep | null): Promise<void> {
    try {
      const list = await this.ssh.exec(
        ctx.app.vps_id,
        `docker images --format '{{.Repository}}:{{.Tag}}'`,
        { timeoutMs: 30_000, signal: ctx.signal }
      )
      const prefix = `${ctx.app.name}:v`
      const versions = list.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith(prefix))
        .map((line) => Number.parseInt(line.slice(prefix.length), 10))
        .filter((version) => !Number.isNaN(version))
        .sort((left, right) => right - left)

      for (const version of versions.slice(3)) {
        const tag = `${ctx.app.name}:v${version}`
        if (logStep) {
          this.log(ctx, logStep, `Dọn image cũ ${tag} (giữ tối đa 3 bản).\n`, 'stdout')
        }
        await this.ssh.exec(
          ctx.app.vps_id,
          `docker image rm -f ${shellQuote(tag)} >/dev/null 2>&1 || true`,
          {
            timeoutMs: 60_000,
            signal: ctx.signal
          }
        )
      }
    } catch (error) {
      logger.warn('deploy', 'Không dọn được image cũ', {
        deployment_id: ctx.deployment.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async ignoreError(promise: Promise<unknown>): Promise<void> {
    try {
      await promise
    } catch {
      // Nhánh dọn dẹp: bỏ qua lỗi, không được che lỗi gốc.
    }
  }

  private release(appId: number, deploymentId: number): void {
    this.activeByApp.delete(appId)
    this.controllers.delete(deploymentId)
  }
}

function toStepIpcError(error: unknown): IpcError {
  if (error instanceof SshAbortedError) {
    return {
      code: 'UNKNOWN',
      message: 'Đã huỷ lượt deploy theo yêu cầu của người dùng.',
      step: undefined
    }
  }
  return toIpcError(error)
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) {
    return `${milliseconds} ms`
  }
  return `${(milliseconds / 1_000).toFixed(1)} s`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
