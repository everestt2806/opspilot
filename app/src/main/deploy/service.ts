import type { Database as SqliteDatabase } from 'better-sqlite3'

import type {
  App,
  DeployEvent,
  DeployInput,
  Deployment,
  DetectionResultDto,
  FrameworkId,
  PrecheckResult
} from '@shared/ipc'

import { AppRepository } from '../db/appRepository'
import { DeploymentRepository } from '../db/deploymentRepository'
import { VpsRepository } from '../db/vpsRepository'
import { detectFramework } from '../detectors'
import { buildSourceTree } from '../detectors/sourceTree'
import type { SshManager } from '../ssh/manager'
import { DeployPipeline } from './pipeline'
import { allocatePort } from './portPolicy'
import { runPrecheck, toPrecheckResult } from './precheck'

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

  constructor(deps: { ssh: SshManager; db: SqliteDatabase; emit: (event: DeployEvent) => void }) {
    this.ssh = deps.ssh
    this.pipeline = new DeployPipeline(deps)
    this.vpsRepository = new VpsRepository(deps.db)
    this.appRepository = new AppRepository(deps.db)
    this.deploymentRepository = new DeploymentRepository(deps.db)
  }

  /** UC-02 bước 2: nhận diện framework, map sang DTO cho wizard. */
  detect(sourcePath: string): DetectionResultDto {
    const tree = buildSourceTree(sourcePath)
    const result = detectFramework(tree)

    if (result.matched) {
      return {
        matched: true,
        framework: result.detector,
        display_name: result.displayName,
        build_command: result.plan.buildCommand,
        container_port: result.plan.containerPort,
        healthcheck_path: result.plan.healthcheckPath,
        dockerfile_template: result.plan.dockerfileTemplate,
        required_env: result.plan.requiredEnv,
        optional_env: result.plan.optionalEnv,
        needs_db: result.plan.needsDb,
        manual_steps: result.plan.manualSteps,
        detected_version: result.plan.detectedVersion,
        file_tree_preview: tree.files.slice(0, 50)
      }
    }

    const signals = Object.entries(result.signals).flatMap(([framework, list]) =>
      list.map((signal) => ({
        framework: framework as FrameworkId,
        description: signal.description,
        passed: signal.passed,
        found: signal.found
      }))
    )
    return { matched: false, hint: result.hint, signals }
  }

  /** UC-02 bước 3: precheck VPS kèm cổng dự kiến (app mới: cổng dự kiến, chưa ghi DB). */
  async precheck(input: DeployInput): Promise<PrecheckResult> {
    const vps = this.vpsRepository.getById(input.vps_id)
    const port =
      input.app_id !== undefined
        ? this.appRepository.getById(input.app_id).host_port
        : allocatePort(this.appRepository.usedPorts(vps.id))
    const detail = await runPrecheck(this.ssh, vps.id, { port })
    return toPrecheckResult(detail, port, vps.host)
  }

  start(input: DeployInput): { deployment_id: number } {
    const { deploymentId } = this.pipeline.run(input)
    return { deployment_id: deploymentId }
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
