import type { Database as SqliteDatabase } from 'better-sqlite3'

import type {
  App,
  DeployEvent,
  DeployInput,
  DeployStartInput,
  DeploySourceInput,
  Deployment,
  DetectionResultDto,
  GitDeployInput,
  GitSourceInput,
  PrecheckResult,
  PreparedGitSource
} from '@shared/ipc'

import { AppRepository } from '../db/appRepository'
import { DeploymentRepository } from '../db/deploymentRepository'
import { VpsRepository } from '../db/vpsRepository'
import type { SshManager } from '../ssh/manager'
import { DeployPipeline } from './pipeline'
import { SshExposureManager, type ExposureManager } from './exposure'
import { allocatePort } from './portPolicy'
import {
  listListeningPorts,
  readExistingEnvFile,
  runPrecheck,
  toPrecheckResult
} from './precheck'
import { detectSource } from './detectionDto'
import { PreparedGitSources, type PreparedGitLease } from './preparedGitSources'
import { AppError } from '../errors'
import { resolveExistingEnv } from './templates'
import { join as posixJoin } from 'node:path/posix'

/**
 * Lớp dịch vụ cho các kênh detect/deploy/app — mọi handler IPC đi qua đây,
 * không gọi trực tiếp repo/ssh (giữ ipc.ts mỏng như VpsService đã làm).
 */
export class DeployService {
  readonly pipeline: DeployPipeline
  private readonly ssh: SshManager
  private readonly vpsRepository: VpsRepository
  private readonly appRepository: AppRepository
  private readonly deploymentRepository: DeploymentRepository
  private readonly preparedGitSources: PreparedGitSources

  constructor(deps: {
    ssh: SshManager
    db: SqliteDatabase
    emit: (event: DeployEvent) => void
    gitSnapshotFactory?: ConstructorParameters<typeof PreparedGitSources>[0]
    exposure?: ExposureManager
  }) {
    this.ssh = deps.ssh
    this.pipeline = new DeployPipeline({
      ...deps,
      exposure: deps.exposure ?? new SshExposureManager(deps.ssh)
    })
    this.vpsRepository = new VpsRepository(deps.db)
    this.appRepository = new AppRepository(deps.db)
    this.deploymentRepository = new DeploymentRepository(deps.db)
    this.preparedGitSources = new PreparedGitSources(deps.gitSnapshotFactory)
  }

  /** UC-02 bước 2: nhận diện framework, map sang DTO cho wizard. */
  detect(sourcePath: string): DetectionResultDto {
    return detectSource(sourcePath).dto
  }

  prepareGit(requestId: string, input: GitSourceInput): Promise<PreparedGitSource> {
    return this.preparedGitSources.prepare(requestId, input)
  }

  cancelGitPrepare(requestId: string): void {
    this.preparedGitSources.cancelPrepare(requestId)
  }

  releaseGitPrepare(handle: string): void {
    this.preparedGitSources.release(handle)
  }

  /** UC-02 bước 3: precheck VPS kèm cổng dự kiến (app mới: cổng dự kiến, chưa ghi DB). */
  async precheck(input: DeploySourceInput): Promise<PrecheckResult> {
    const vps = this.vpsRepository.getById(input.vps_id)
    const existingApp = this.findExistingApp(input, vps.id)
    if (existingApp && existingApp.vps_id !== vps.id) {
      throw new AppError('VALIDATION', 'App không thuộc VPS đã chọn. Hãy chọn lại.')
    }

    const prepared = this.isGitInput(input)
      ? this.preparedGitSources.get((input as GitDeployInput).prepared_source_handle)
      : null
    if (prepared) this.assertSourceCompatibility(input as GitDeployInput, existingApp, prepared)
    else if (existingApp?.source_type === 'git') this.assertLocalSourceAllowed(existingApp)

    const assignedPort =
      existingApp?.host_port ??
      input.host_port ??
      allocatePort([
        ...this.appRepository.usedPorts(vps.id),
        ...(await listListeningPorts(this.ssh, vps.id))
      ])

    // Khi redeploy, chính phiên bản hiện tại đang giữ cổng này. Pipeline sẽ thay container
    // bằng compose up nên chỉ kiểm tra cổng trống đối với app mới.
    let detail = await runPrecheck(this.ssh, vps.id, {
      port: existingApp === undefined ? assignedPort : null
    })

    const deployedExistingApp = existingApp?.current_deployment_id ? existingApp : null
    if (deployedExistingApp) {
      const sourcePlan = prepared?.plan ??
        (this.isGitInput(input)
          ? null
          : detectSource((input as DeployInput).source_path).plan)
      const checks: PrecheckResult['checks'] = [...detail.checks]
      if (!sourcePlan) {
        throw new AppError('VALIDATION', 'Không thể xác minh source đã chuẩn bị. Hãy chuẩn bị lại.')
      }
      try {
        const envContent = await readExistingEnvFile(
          this.ssh,
          vps.id,
          posixJoin('/opt/opspilot', deployedExistingApp.name, '.env')
        )
        const resolution = resolveExistingEnv(
          input.env,
          envContent,
          sourcePlan.requiredEnv,
          sourcePlan.needsDb || deployedExistingApp.needs_db === 1
        )
        checks.push({
          label: 'Required environment',
          required: 'detector-required keys are available',
          actual:
            resolution.missingKeys.length > 0
              ? `Missing key names: ${resolution.missingKeys.join(', ')}`
              : 'Required keys are available',
          ok: resolution.missingKeys.length === 0
        })
        if (resolution.protectedOverrides.length > 0) {
          checks.push({
            label: 'PostgreSQL credentials',
            required: 'keep the existing credential pair',
            actual: `Cannot override keys: ${resolution.protectedOverrides.join(', ')}`,
            ok: false
          })
        }
      } catch {
        checks.push({
          label: 'Required environment',
          required: 'existing .env is readable and required keys are available',
          actual: `Could not verify existing .env; required key names unverified: ${sourcePlan.requiredEnv.join(', ') || 'none'}`,
          ok: false
        })
      }
      detail = {
        ...detail,
        checks,
        passed: detail.passed && checks.every((check) => check.ok)
      }
    }
    const result = toPrecheckResult(detail, assignedPort, vps.host)
    if (this.isGitInput(input) && detail.passed) {
      const gitInput = input as GitDeployInput
      result.precheck_token = this.preparedGitSources.issuePrecheckToken(
        gitInput.prepared_source_handle,
        gitInput,
        assignedPort
      )
    }
    return result
  }

  start(input: DeployStartInput): { deployment_id: number } {
    if (!this.isGitInput(input)) {
      const existingApp = this.findExistingApp(input, input.vps_id)
      if (existingApp?.source_type === 'git') this.assertLocalSourceAllowed(existingApp)
      const { deploymentId } = this.pipeline.run(input)
      return { deployment_id: deploymentId }
    }

    const reservation = this.preparedGitSources.reserveStart(input)
    try {
      const existingApp = this.findExistingApp(input, input.vps_id)
      this.assertSourceCompatibility(input, existingApp, reservation.lease)
      const localPipelineInput: DeployInput = {
        vps_id: input.vps_id,
        app_id: input.app_id,
        host_port: reservation.assignedHostPort,
        app_name: input.app_name,
        source_path: reservation.lease.sourcePath,
        env: input.env
      }
      const { deploymentId } = this.pipeline.run(localPipelineInput, undefined, reservation.lease)
      this.preparedGitSources.commitStart(reservation)
      return { deployment_id: deploymentId }
    } catch (error) {
      this.preparedGitSources.releaseStart(reservation)
      throw error
    }
  }

  async shutdown(): Promise<void> {
    this.preparedGitSources.close()
    await this.pipeline.shutdown()
  }

  private isGitInput(input: DeploySourceInput | DeployStartInput): input is GitDeployInput {
    return 'source_type' in input && input.source_type === 'git'
  }

  private findExistingApp(
    input: DeploySourceInput | DeployStartInput,
    vpsId: number
  ): App | undefined {
    return input.app_id === undefined
      ? this.appRepository.getByVpsAndName(vpsId, input.app_name.trim())
      : this.appRepository.getById(input.app_id)
  }

  private assertSourceCompatibility(
    input: GitDeployInput,
    app: ReturnType<AppRepository['getByVpsAndName']>,
    source: PreparedGitLease
  ): void {
    if (!app) return
    if (app.source_type !== 'git') {
      throw new AppError(
        'VALIDATION',
        'App hiện dùng nguồn local; không thể đổi sang Git trong lần redeploy này.'
      )
    }
    if (
      app.git_repo_url !== source.gitRepoUrl ||
      app.git_ref !== source.gitRef ||
      app.git_root !== source.gitRoot
    ) {
      throw new AppError(
        'VALIDATION',
        'Nguồn Git không khớp cấu hình app hiện tại; hãy tạo app mới hoặc dùng đúng repo/ref/root đã liên kết.'
      )
    }
    if (input.app_id !== undefined && app.id !== input.app_id) {
      throw new AppError('VALIDATION', 'App không khớp nguồn Git đã chuẩn bị.')
    }
  }

  private assertLocalSourceAllowed(
    app: NonNullable<ReturnType<AppRepository['getByVpsAndName']>>
  ): void {
    throw new AppError(
      'VALIDATION',
      `App ${app.name} đã liên kết với Git; hãy chuẩn bị lại nguồn Git để redeploy.`
    )
  }

  cancel(deploymentId: number): void {
    this.pipeline.cancel(deploymentId)
  }

  rollback(appId: number, targetDeploymentId: number): { deployment_id: number } {
    const { deploymentId } = this.pipeline.rollback(appId, targetDeploymentId)
    return { deployment_id: deploymentId }
  }

  listApps(vpsId?: number): App[] {
    return vpsId === undefined ? this.appRepository.listAll() : this.appRepository.listByVps(vpsId)
  }

  getApp(appId: number): App {
    return this.appRepository.getById(appId)
  }

  versions(appId: number): Deployment[] {
    return this.deploymentRepository.listByApp(appId)
  }
}
